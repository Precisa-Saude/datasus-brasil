import { describe, expect, it } from 'vitest';

import { formatCompetencia, formatCompetenciaRange } from '@/lib/format';

describe('formatCompetencia', () => {
  it('formata YYYY-MM para "Mmm. YYYY"', () => {
    expect(formatCompetencia('2024-01')).toBe('Jan. 2024');
    expect(formatCompetencia('2024-12')).toBe('Dez. 2024');
    expect(formatCompetencia('2008-07')).toBe('Jul. 2008');
  });

  it('retorna input original quando inválido', () => {
    expect(formatCompetencia('invalido')).toBe('invalido');
    expect(formatCompetencia('2024-13')).toBe('2024-13');
  });
});

describe('formatCompetenciaRange', () => {
  it('formata faixa com from e to distintos', () => {
    expect(formatCompetenciaRange({ from: '2024-01', to: '2024-12' })).toBe(
      'Jan. 2024 – Dez. 2024',
    );
  });

  it('colapsa quando from === to', () => {
    expect(formatCompetenciaRange({ from: '2024-03', to: '2024-03' })).toBe('Mar. 2024');
  });
});
