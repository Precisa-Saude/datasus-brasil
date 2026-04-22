import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseArgs, UsageError } from '../src/args.js';
import { consumeStream, emitJsonlRecord, parseStreamOptions } from '../src/stream.js';

async function* gen<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

describe('parseStreamOptions', () => {
  it('defaulta tudo (sem flags)', () => {
    expect(parseStreamOptions(parseArgs([]))).toEqual({
      format: 'json',
      limit: null,
      raw: false,
    });
  });

  it('--limit N parseia inteiro', () => {
    expect(parseStreamOptions(parseArgs(['--limit', '42']))).toMatchObject({ limit: 42 });
  });

  it('--limit 0 e negativo são rejeitados', () => {
    expect(() => parseStreamOptions(parseArgs(['--limit', '0']))).toThrow(UsageError);
    // forma --flag=valor é necessária para negativos (o parser de espaço
    // trataria '-5' como novo flag).
    expect(() => parseStreamOptions(parseArgs(['--limit=-5']))).toThrow(
      /--limit deve ser inteiro positivo/,
    );
  });

  it('--raw sem --format defaulta pra jsonl', () => {
    expect(parseStreamOptions(parseArgs(['--raw']))).toMatchObject({ format: 'jsonl', raw: true });
  });

  it('--raw --format json preserva json', () => {
    expect(parseStreamOptions(parseArgs(['--raw', '--format', 'json']))).toMatchObject({
      format: 'json',
      raw: true,
    });
  });

  it('sem --raw, --format usa o valor passado', () => {
    expect(parseStreamOptions(parseArgs(['--format', 'jsonl']))).toMatchObject({
      format: 'jsonl',
      raw: false,
    });
  });

  it('rejeita --format inválido', () => {
    expect(() => parseStreamOptions(parseArgs(['--format', 'csv']))).toThrow(UsageError);
  });
});

describe('consumeStream', () => {
  it('consome tudo quando limit é null', async () => {
    const seen: number[] = [];
    const n = await consumeStream(gen([1, 2, 3]), null, (x) => seen.push(x));
    expect(n).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('para após N registros quando limit definido', async () => {
    const seen: number[] = [];
    const n = await consumeStream(gen([1, 2, 3, 4, 5]), 3, (x) => seen.push(x));
    expect(n).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('handles empty stream', async () => {
    const n = await consumeStream(gen<number>([]), 10, () => {});
    expect(n).toBe(0);
  });

  it('limit maior que stream retorna só os disponíveis', async () => {
    const n = await consumeStream(gen([1, 2]), 100, () => {});
    expect(n).toBe(2);
  });
});

describe('emitJsonlRecord', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emite JSON + newline no stdout', () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
      chunks.push(typeof c === 'string' ? c : c.toString());
      return true;
    });
    emitJsonlRecord({ a: 1, b: 'x' });
    expect(chunks.join('')).toBe('{"a":1,"b":"x"}\n');
  });
});
