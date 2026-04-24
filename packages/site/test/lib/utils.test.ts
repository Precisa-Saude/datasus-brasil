import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';

describe('cn', () => {
  it('concatena classes sem duplicar', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('aplica tailwind-merge para classes conflitantes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('aceita condicionais', () => {
    const active = false;
    expect(cn('base', active ? 'foo' : null, 'bar')).toBe('base bar');
  });

  it('ignora valores falsy', () => {
    expect(cn('base', null, undefined, '')).toBe('base');
  });
});
