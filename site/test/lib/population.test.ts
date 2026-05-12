import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetPopulationCacheForTests, loadPopulation } from '@/lib/population';

const SAMPLE_PAYLOAD = {
  coverageYears: [2018, 2019, 2020, 2024],
  generatedAt: '2026-05-12T00:00:00Z',
  population: {
    '431060': { 2018: 37757, 2019: 38000, 2020: 38200, 2024: 36830 },
    '350000': { 2020: 1000, 2024: 1100 },
  },
  source: 'IBGE — Estimativas',
};

beforeEach(() => {
  __resetPopulationCacheForTests();
  globalThis.fetch = vi.fn(async () => {
    return new Response(JSON.stringify(SAMPLE_PAYLOAD), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  __resetPopulationCacheForTests();
});

describe('loadPopulation', () => {
  it('cacheia a promessa entre chamadas', async () => {
    const a = loadPopulation();
    const b = loadPopulation();
    expect(a).toBe(b);
    await a;
    expect(globalThis.fetch as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('expõe coverageYears e source', async () => {
    const ds = await loadPopulation();
    expect(ds.coverageYears).toEqual([2018, 2019, 2020, 2024]);
    expect(ds.source).toContain('IBGE');
  });

  it('lookup exato retorna o valor publicado', async () => {
    const { lookup } = await loadPopulation();
    expect(lookup('431060', 2018)).toBe(37757);
    expect(lookup('431060', 2024)).toBe(36830);
  });

  it('lookup com year fora do range cai pro ano mais próximo do município', async () => {
    const { lookup } = await loadPopulation();
    // 2010 não publicado — escolhe 2018 (mais próximo) já que 2009 também
    // está fora do dataset deste teste.
    expect(lookup('431060', 2010)).toBe(37757);
    // 2025 vai pra 2024.
    expect(lookup('431060', 2025)).toBe(36830);
    // Empate exato entre 2018 e 2024 favorece o ano publicado primeiro.
    expect(lookup('431060', 2021)).toBe(38200);
  });

  it('retorna undefined pra município desconhecido', async () => {
    const { lookup } = await loadPopulation();
    expect(lookup('999999', 2020)).toBeUndefined();
  });

  it('propaga erro de rede com instrução de regerar', async () => {
    __resetPopulationCacheForTests();
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof fetch;
    await expect(loadPopulation()).rejects.toThrow(/ingest-population/);
  });
});
