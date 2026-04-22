import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsageError } from '../src/args.js';
import { emit, parseFormat } from '../src/output.js';

describe('parseFormat', () => {
  it('returns json by default', () => {
    expect(parseFormat(undefined)).toBe('json');
  });

  it('accepts json and jsonl', () => {
    expect(parseFormat('json')).toBe('json');
    expect(parseFormat('jsonl')).toBe('jsonl');
  });

  it('rejects csv and other values', () => {
    expect(() => parseFormat('csv')).toThrow(UsageError);
    expect(() => parseFormat('yaml')).toThrow(/--format inválido/);
  });
});

describe('emit', () => {
  const capture = (fn: () => void): string => {
    let out = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    });
    try {
      fn();
    } finally {
      spy.mockRestore();
    }
    return out;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits pretty JSON with trailing newline in json mode', () => {
    const out = capture(() => emit([{ a: 1 }, { a: 2 }], 'json'));
    expect(out.endsWith('\n')).toBe(true);
    expect(JSON.parse(out)).toEqual([{ a: 1 }, { a: 2 }]);
    expect(out).toContain('  '); // indentação
  });

  it('emits one line per record in jsonl mode', () => {
    const out = capture(() => emit([{ a: 1 }, { a: 2 }], 'jsonl'));
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ a: 1 });
    expect(JSON.parse(lines[1]!)).toEqual({ a: 2 });
  });

  it('emits empty JSON array in json mode for empty input', () => {
    const out = capture(() => emit([], 'json'));
    expect(JSON.parse(out)).toEqual([]);
  });

  it('emits nothing for empty input in jsonl mode', () => {
    const out = capture(() => emit([], 'jsonl'));
    expect(out).toBe('');
  });
});
