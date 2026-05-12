import { describe, expect, it } from 'vitest';

import type { AnomalyRow } from '@/lib/anomaly';
import {
  detectConcentration,
  detectPerCapitaOutliers,
  detectPriceRatioOutliers,
  detectTemporalSpikes,
} from '@/lib/anomaly';

/** Helper para gerar linhas de uma série mensal contínua. */
function series(
  base: Omit<AnomalyRow, 'competencia' | 'valorAprovadoBRL' | 'volumeExames'>,
  start: string,
  volumes: number[],
  brlPerExam = 50,
): AnomalyRow[] {
  const [y0, m0] = start.split('-').map(Number) as [number, number];
  return volumes.map((v, i) => {
    const t = m0 + i - 1;
    const yyyy = y0 + Math.floor(t / 12);
    const mm = String((t % 12) + 1).padStart(2, '0');
    return {
      ...base,
      competencia: `${yyyy}-${mm}`,
      valorAprovadoBRL: v * brlPerExam,
      volumeExames: v,
    };
  });
}

const munA = { loinc: '2160-0', municipioCode: '350000', municipioNome: 'Cidade A', ufSigla: 'SP' };
const munB = { loinc: '2160-0', municipioCode: '350100', municipioNome: 'Cidade B', ufSigla: 'SP' };

describe('detectTemporalSpikes', () => {
  it('flagra ponto que ultrapassa threshold em z-score', () => {
    // 12 meses de baseline com leve variação (~50 ± 5), depois 500.
    const baseline = Array.from({ length: 12 }, (_, i) => 50 + (i % 3) - 1);
    const rows = series(munA, '2023-01', [...baseline, 500]);
    const hits = detectTemporalSpikes(rows, { minBaseline: 6, threshold: 3, window: 12 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.competencia).toBe('2024-01');
    expect(hits[0]!.score).toBeGreaterThan(3);
    expect(hits[0]!.details['z']).toBeGreaterThan(3);
  });

  it('ignora série com baseline curta (< minBaseline)', () => {
    const rows = series(munA, '2024-01', [10, 20, 500]);
    const hits = detectTemporalSpikes(rows, { minBaseline: 6 });
    expect(hits).toHaveLength(0);
  });

  it('ignora série constante (std = 0)', () => {
    const rows = series(
      munA,
      '2023-01',
      Array.from({ length: 24 }, () => 100),
    );
    const hits = detectTemporalSpikes(rows, { minBaseline: 6, threshold: 3 });
    expect(hits).toHaveLength(0);
  });

  it('isola spike por (município, LOINC) — séries não se misturam', () => {
    const a = series(munA, '2023-01', [
      ...Array.from({ length: 12 }, (_, i) => 50 + (i % 3) - 1),
      500,
    ]);
    const b = series(
      munB,
      '2023-01',
      Array.from({ length: 13 }, (_, i) => 50 + (i % 3) - 1),
    );
    const hits = detectTemporalSpikes([...a, ...b], { minBaseline: 6, threshold: 3 });
    expect(hits.map((h) => h.municipioCode)).toEqual(['350000']);
  });

  it('ordena por score decrescente', () => {
    const baseVar = Array.from({ length: 12 }, (_, i) => 50 + (i % 3) - 1);
    const moderate = series(munA, '2023-01', [...baseVar, 300]);
    const extreme = series(munB, '2023-01', [...baseVar, 5000]);
    const hits = detectTemporalSpikes([...moderate, ...extreme], {
      minBaseline: 6,
      threshold: 3,
    });
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[0]!.municipioCode).toBe('350100');
  });
});

describe('detectPerCapitaOutliers', () => {
  const pop = (code: string, _year: number) => ({ '350000': 10000, '350100': 200000 })[code];

  it('flagra município pequeno com alta taxa por 1k habitantes', () => {
    const rows: AnomalyRow[] = [
      { ...munA, competencia: '2024-01', valorAprovadoBRL: 0, volumeExames: 2000 },
    ];
    const hits = detectPerCapitaOutliers(rows, pop, { maxPop: 50000, minPer1k: 50, minPop: 5000 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.details['per1k']).toBe(200);
  });

  it('descarta município grande (acima de maxPop)', () => {
    const rows: AnomalyRow[] = [
      { ...munB, competencia: '2024-01', valorAprovadoBRL: 0, volumeExames: 50000 },
    ];
    const hits = detectPerCapitaOutliers(rows, pop, { maxPop: 50000, minPer1k: 50, minPop: 5000 });
    expect(hits).toHaveLength(0);
  });

  it('descarta município sem dado de população', () => {
    const rows: AnomalyRow[] = [
      {
        competencia: '2024-01',
        loinc: '2160-0',
        municipioCode: '999999',
        municipioNome: 'Sem dado',
        ufSigla: 'XX',
        valorAprovadoBRL: 0,
        volumeExames: 9999,
      },
    ];
    const hits = detectPerCapitaOutliers(rows, pop);
    expect(hits).toHaveLength(0);
  });

  it('descarta competência com ano inválido', () => {
    const rows: AnomalyRow[] = [
      { ...munA, competencia: 'abc-01', valorAprovadoBRL: 0, volumeExames: 2000 },
    ];
    const hits = detectPerCapitaOutliers(rows, pop);
    expect(hits).toHaveLength(0);
  });
});

describe('detectConcentration', () => {
  it('flagra município com share alto do par LOINC×competência', () => {
    const rows: AnomalyRow[] = [
      { ...munA, competencia: '2024-01', valorAprovadoBRL: 0, volumeExames: 800 },
      { ...munB, competencia: '2024-01', valorAprovadoBRL: 0, volumeExames: 200 },
    ];
    const hits = detectConcentration(rows, { minTotal: 500, threshold: 0.5 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.municipioCode).toBe('350000');
    expect(hits[0]!.details['share']).toBeCloseTo(0.8);
  });

  it('descarta par (LOINC, competência) com volume total abaixo de minTotal', () => {
    const rows: AnomalyRow[] = [
      { ...munA, competencia: '2024-01', valorAprovadoBRL: 0, volumeExames: 8 },
      { ...munB, competencia: '2024-01', valorAprovadoBRL: 0, volumeExames: 2 },
    ];
    const hits = detectConcentration(rows, { minTotal: 500, threshold: 0.5 });
    expect(hits).toHaveLength(0);
  });

  it('descarta share abaixo do threshold', () => {
    const rows: AnomalyRow[] = [
      { ...munA, competencia: '2024-01', valorAprovadoBRL: 0, volumeExames: 100 },
      { ...munB, competencia: '2024-01', valorAprovadoBRL: 0, volumeExames: 900 },
    ];
    const hits = detectConcentration(rows, { minTotal: 500, threshold: 0.5 });
    expect(hits.map((h) => h.municipioCode)).toEqual(['350100']);
  });
});

describe('detectPriceRatioOutliers', () => {
  it('flagra município com BRL/exame fora do IQR do par LOINC×ano', () => {
    // 6 municípios com BRL/exame variando de 45 a 55; 1 outlier a 500.
    const normal: AnomalyRow[] = Array.from({ length: 6 }, (_, i) => ({
      competencia: '2024-01',
      loinc: '2160-0',
      municipioCode: `35000${i}`,
      municipioNome: `Cidade ${i}`,
      ufSigla: 'SP',
      valorAprovadoBRL: (45 + i * 2) * 100,
      volumeExames: 100,
    }));
    const outlier: AnomalyRow = {
      competencia: '2024-02',
      loinc: '2160-0',
      municipioCode: '350099',
      municipioNome: 'Cidade Outlier',
      ufSigla: 'SP',
      valorAprovadoBRL: 500 * 100,
      volumeExames: 100,
    };
    const hits = detectPriceRatioOutliers([...normal, outlier], { k: 1.5, minVolume: 30 });
    expect(hits.some((h) => h.municipioCode === '350099')).toBe(true);
  });

  it('descarta município com volume abaixo de minVolume', () => {
    const rows: AnomalyRow[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        competencia: '2024-01',
        loinc: '2160-0',
        municipioCode: `35000${i}`,
        municipioNome: `Cidade ${i}`,
        ufSigla: 'SP',
        valorAprovadoBRL: 50 * 100,
        volumeExames: 100,
      })),
      {
        competencia: '2024-01',
        loinc: '2160-0',
        municipioCode: '350099',
        municipioNome: 'Pequena',
        ufSigla: 'SP',
        valorAprovadoBRL: 5000,
        volumeExames: 10,
      },
    ];
    const hits = detectPriceRatioOutliers(rows, { k: 1.5, minVolume: 30 });
    expect(hits.find((h) => h.municipioCode === '350099')).toBeUndefined();
  });

  it('não produz flags quando grupo tem menos de 5 amostras', () => {
    const rows: AnomalyRow[] = Array.from({ length: 4 }, (_, i) => ({
      competencia: '2024-01',
      loinc: '2160-0',
      municipioCode: `35000${i}`,
      municipioNome: `M${i}`,
      ufSigla: 'SP',
      valorAprovadoBRL: 50 * 100,
      volumeExames: 100,
    }));
    expect(detectPriceRatioOutliers(rows)).toHaveLength(0);
  });

  it('não produz flags quando IQR é zero', () => {
    const rows: AnomalyRow[] = Array.from({ length: 6 }, (_, i) => ({
      competencia: '2024-01',
      loinc: '2160-0',
      municipioCode: `35000${i}`,
      municipioNome: `M${i}`,
      ufSigla: 'SP',
      valorAprovadoBRL: 5000,
      volumeExames: 100,
    }));
    expect(detectPriceRatioOutliers(rows, { k: 1 })).toHaveLength(0);
  });
});
