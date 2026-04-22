import { describe, expect, it } from 'vitest';

import { optInt, parseArgs, requireInt, requireOpt, UsageError } from '../src/args.js';

describe('parseArgs', () => {
  it('parses --flag value form', () => {
    const { opts } = parseArgs(['--uf', 'SP', '--year', '2024']);
    expect(opts.get('uf')).toBe('SP');
    expect(opts.get('year')).toBe('2024');
  });

  it('parses --flag=value form', () => {
    const { opts } = parseArgs(['--uf=SP', '--year=2024']);
    expect(opts.get('uf')).toBe('SP');
    expect(opts.get('year')).toBe('2024');
  });

  it('treats trailing --flag as boolean', () => {
    const { bools, opts } = parseArgs(['--preliminar']);
    expect(bools.has('preliminar')).toBe(true);
    expect(opts.has('preliminar')).toBe(false);
  });

  it('treats --flag followed by --other as boolean', () => {
    const { bools, opts } = parseArgs(['--preliminar', '--year', '2024']);
    expect(bools.has('preliminar')).toBe(true);
    expect(opts.get('year')).toBe('2024');
  });

  it('parses short boolean flags like -h', () => {
    const { bools } = parseArgs(['-h']);
    expect(bools.has('h')).toBe(true);
  });

  it('splits combined short flags like -vh into individual bools', () => {
    const { bools } = parseArgs(['-vh']);
    expect(bools.has('v')).toBe(true);
    expect(bools.has('h')).toBe(true);
    expect(bools.has('vh')).toBe(false);
  });

  it('accepts negative numbers as values, not flags', () => {
    const { bools, opts } = parseArgs(['--year', '-5']);
    expect(opts.get('year')).toBe('-5');
    expect(bools.has('5')).toBe(false);
  });

  it('accepts negative numbers via =', () => {
    const { opts } = parseArgs(['--offset=-10']);
    expect(opts.get('offset')).toBe('-10');
  });

  it('collects positional args', () => {
    const { positional } = parseArgs(['cnes', 'extra']);
    expect(positional).toEqual(['cnes', 'extra']);
  });

  it('mixes positional and flags', () => {
    const { opts, positional } = parseArgs(['cnes', '--uf', 'SP', 'trailing']);
    expect(positional).toEqual(['cnes', 'trailing']);
    expect(opts.get('uf')).toBe('SP');
  });

  it('returns empty sets/arrays for empty argv', () => {
    const { bools, opts, positional } = parseArgs([]);
    expect(bools.size).toBe(0);
    expect(opts.size).toBe(0);
    expect(positional).toEqual([]);
  });
});

describe('requireOpt', () => {
  it('returns the value when present', () => {
    const args = parseArgs(['--uf', 'SP']);
    expect(requireOpt(args, 'uf')).toBe('SP');
  });

  it('throws UsageError when missing', () => {
    const args = parseArgs([]);
    expect(() => requireOpt(args, 'uf')).toThrow(UsageError);
    expect(() => requireOpt(args, 'uf')).toThrow(/--uf/);
  });

  it('throws UsageError for empty string value', () => {
    const args = parseArgs(['--uf=']);
    expect(() => requireOpt(args, 'uf')).toThrow(UsageError);
  });
});

describe('requireInt', () => {
  it('parses integer value', () => {
    const args = parseArgs(['--year', '2024']);
    expect(requireInt(args, 'year')).toBe(2024);
  });

  it('throws when value is not an integer', () => {
    const args = parseArgs(['--year', 'abc']);
    expect(() => requireInt(args, 'year')).toThrow(/deve ser inteiro/);
  });

  it('throws when flag is absent', () => {
    const args = parseArgs([]);
    expect(() => requireInt(args, 'year')).toThrow(UsageError);
  });
});

describe('optInt', () => {
  it('returns fallback when flag absent', () => {
    expect(optInt(parseArgs([]), 'top', 10)).toBe(10);
  });

  it('parses flag when present', () => {
    expect(optInt(parseArgs(['--top', '5']), 'top', 10)).toBe(5);
  });

  it('throws when flag present but invalid', () => {
    expect(() => optInt(parseArgs(['--top', 'xyz']), 'top', 10)).toThrow(/deve ser inteiro/);
  });
});
