import { describe, expect, it } from 'vitest';

import { normalizeText, wordStartFilter } from '@/lib/search';

describe('normalizeText', () => {
  it('remove acentos combinantes e baixa caixa', () => {
    expect(normalizeText('Ácido Úrico')).toBe('acido urico');
    expect(normalizeText('GLICEMIA')).toBe('glicemia');
  });

  it('é idempotente em texto sem acento', () => {
    expect(normalizeText('alanina')).toBe('alanina');
  });
});

describe('wordStartFilter', () => {
  it('aceita tudo quando o search está vazio', () => {
    const f = wordStartFilter(0);
    expect(f('Glicemia', '')).toBe(1);
  });

  it('respeita o mínimo de caracteres antes de filtrar', () => {
    const f = wordStartFilter(3);
    expect(f('Hemograma', 'he')).toBe(1); // ainda abaixo do mínimo
    expect(f('Hemograma', 'hem')).toBe(1);
    expect(f('Glicemia', 'hem')).toBe(0);
  });

  it('casa do início da string', () => {
    const f = wordStartFilter(0);
    expect(f('Alanina', 'ala')).toBe(1);
  });

  it('casa do início de palavras intermediárias', () => {
    const f = wordStartFilter(0);
    expect(f('Ácido Úrico — UricAcid', 'urico')).toBe(1);
  });

  it('ignora acentos no haystack e no needle', () => {
    const f = wordStartFilter(0);
    expect(f('Ácido Úrico', 'acido')).toBe(1);
    expect(f('Acido Urico', 'ácido')).toBe(1);
  });

  it('rejeita matches no meio de uma palavra', () => {
    const f = wordStartFilter(0);
    expect(f('Hemograma', 'gram')).toBe(0);
  });
});
