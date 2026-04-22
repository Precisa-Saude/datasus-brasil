import { describe, expect, it } from 'vitest';

import { createProgressReporter, formatBytes } from '../src/progress.js';

interface FakeStream {
  chunks: string[];
  isTTY: boolean;
  write: (s: string) => boolean;
}

function makeStream(isTTY: boolean): FakeStream {
  const chunks: string[] = [];
  return {
    chunks,
    isTTY,
    write(s: string) {
      chunks.push(s);
      return true;
    },
  };
}

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('formats MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(27 * 1024 * 1024)).toBe('27.0 MB');
  });

  it('formats GB', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });

  it('handles invalid inputs', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(Infinity)).toBe('0 B');
  });
});

describe('createProgressReporter (cache hit)', () => {
  it('emite uma linha indicando cache e encerra', () => {
    const stream = makeStream(false);
    const report = createProgressReporter('CNES-ST AC/2024/01', { stream });

    report({ fromCache: true, path: '/p', total: 2048, transferred: 2048 });

    expect(stream.chunks.join('')).toBe('CNES-ST AC/2024/01 (cache, 2.0 KB)\n');
  });

  it('ignora eventos subsequentes após cache hit', () => {
    const stream = makeStream(false);
    const report = createProgressReporter('CNES-ST', { stream });

    report({ fromCache: true, path: '/p', total: 100, transferred: 100 });
    report({ fromCache: false, path: '/p', total: 100, transferred: 50 });

    expect(stream.chunks).toHaveLength(1);
  });
});

describe('createProgressReporter (TTY)', () => {
  it('renderiza barra in-place via \\r com %, bytes transferidos, total e velocidade', () => {
    const stream = makeStream(true);
    const report = createProgressReporter('CNES-ST SP/2024/03', { stream });
    const total = 1024 * 1024; // 1 MB

    report({ fromCache: false, path: '/p', total, transferred: 0 });
    report({ fromCache: false, path: '/p', total, transferred: total / 2 });
    report({ fromCache: false, path: '/p', total, transferred: total });

    const output = stream.chunks.join('');
    expect(output).toContain('\r');
    expect(output).toContain('CNES-ST SP/2024/03');
    expect(output).toContain('50%');
    expect(output).toContain('100%');
    expect(output).toContain('1.0 MB');
    expect(output).toContain('█');
    expect(output).toContain('░');
    // barra termina com newline ao completar
    expect(output.endsWith('\n')).toBe(true);
  });

  it('mostra só bytes e velocidade quando total é desconhecido', () => {
    const stream = makeStream(true);
    const report = createProgressReporter('X', { stream });

    report({ fromCache: false, path: '/p', total: null, transferred: 500 });

    const output = stream.chunks.join('');
    expect(output).toContain('500 B');
    expect(output).not.toContain('%');
  });

  it('limita a razão em 100% se transferred > total', () => {
    const stream = makeStream(true);
    const report = createProgressReporter('X', { stream });

    report({ fromCache: false, path: '/p', total: 100, transferred: 150 });

    expect(stream.chunks.join('')).toContain('100%');
  });

  it('padding limpa resíduo de linha anterior mais longa', () => {
    const stream = makeStream(true);
    const report = createProgressReporter('L', { stream });

    report({ fromCache: false, path: '/p', total: 1000, transferred: 1 });
    report({ fromCache: false, path: '/p', total: 1000, transferred: 1000 });

    // segundo render deve escrever sobre o primeiro via \r
    expect(stream.chunks.filter((c) => c.startsWith('\r'))).toHaveLength(2);
  });
});

describe('createProgressReporter (não-TTY)', () => {
  it('não emite updates intermediários, apenas uma linha final ao completar', () => {
    const stream = makeStream(false);
    const report = createProgressReporter('Y', { stream });
    const total = 2048;

    report({ fromCache: false, path: '/p', total, transferred: 0 });
    report({ fromCache: false, path: '/p', total, transferred: total / 2 });
    expect(stream.chunks).toHaveLength(0);

    report({ fromCache: false, path: '/p', total, transferred: total });

    expect(stream.chunks).toHaveLength(1);
    const line = stream.chunks[0]!;
    expect(line).toContain('Y 2.0 KB');
    expect(line.endsWith('\n')).toBe(true);
    expect(line).not.toContain('\r');
  });

  it('não emite nada em não-TTY quando total é desconhecido', () => {
    const stream = makeStream(false);
    const report = createProgressReporter('Z', { stream });

    report({ fromCache: false, path: '/p', total: null, transferred: 100 });
    report({ fromCache: false, path: '/p', total: null, transferred: 200 });

    expect(stream.chunks).toHaveLength(0);
  });
});
