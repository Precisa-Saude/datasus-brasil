import { describe, expect, it } from 'vitest';

import { buildOverviewTooltipHtml, formatBRL, formatInt } from '@/lib/tooltip';

describe('formatInt', () => {
  it('arredonda e formata com separador pt-BR', () => {
    expect(formatInt(1234567)).toBe('1.234.567');
  });

  it('arredonda fracionários', () => {
    expect(formatInt(1500.7)).toBe('1.501');
  });

  it('cobre zero', () => {
    expect(formatInt(0)).toBe('0');
  });
});

describe('formatBRL', () => {
  it('formata como moeda brasileira', () => {
    const result = formatBRL(1234.5);
    expect(result).toContain('1.234,50');
    expect(result).toContain('R$');
  });

  it('zero em reais', () => {
    const result = formatBRL(0);
    expect(result).toContain('0,00');
    expect(result).toContain('R$');
  });
});

describe('buildOverviewTooltipHtml', () => {
  it('inclui nome, subtítulo, total e label', () => {
    const html = buildOverviewTooltipHtml({
      name: 'São Paulo',
      subtitle: '2024-01',
      totalLabel: 'exames',
      totalValue: 1234,
    });
    expect(html).toContain('São Paulo');
    expect(html).toContain('2024-01');
    expect(html).toContain('1.234');
    expect(html).toContain('exames');
  });

  it('arredonda totalValue via formatInt', () => {
    const html = buildOverviewTooltipHtml({
      name: 'Brasil',
      subtitle: 'Total',
      totalLabel: 'registros',
      totalValue: 999.9,
    });
    expect(html).toContain('1.000');
  });
});
