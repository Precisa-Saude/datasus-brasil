import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnomalyDumbbell, isDumbbellLogScale } from '@/components/AnomalyDumbbell';
import type { AnomalyHit } from '@/lib/anomaly';

const noopPop = null;

function hit(overrides: Partial<AnomalyHit> = {}): AnomalyHit {
  return {
    baseline: 50,
    competencia: '2024-06',
    details: {
      baselineN: 12,
      mad: 3,
      valorAprovadoBRL: 12000,
      volumeExames: 1000,
      windowMonths: 12,
      z: 8.4,
    },
    kind: 'spike',
    loinc: '2160-0',
    municipioCode: '350000',
    municipioNome: 'Cidade A',
    observed: 1000,
    score: 8.4,
    ufSigla: 'SP',
    ...overrides,
  };
}

const noopFmt = (v: number): string => String(v);
const noopLabel = (l: string): string => `Exame ${l}`;

describe('AnomalyDumbbell', () => {
  it('renderiza um dot por hit + um dot baseline + área de eixo', () => {
    const hits = [hit(), hit({ municipioCode: '350100', municipioNome: 'Cidade B' })];
    const { container } = render(
      <AnomalyDumbbell
        formatValue={noopFmt}
        hits={hits}
        kind="spike"
        labelForLoinc={noopLabel}
        populationLookup={noopPop}
        rowHeight={36}
      />,
    );
    // 2 baseline + 2 observed + 2 hit-area = 6 circles
    expect(container.querySelectorAll('circle')).toHaveLength(6);
    // 4 ticks no eixo X
    expect(container.querySelectorAll('svg text').length).toBeGreaterThanOrEqual(4);
  });

  it('mostra tooltip com município, variação e valor ao passar o mouse no observado', () => {
    const { container } = render(
      <AnomalyDumbbell
        formatValue={(v) => `R$ ${v}`}
        hits={[hit()]}
        kind="spike"
        labelForLoinc={noopLabel}
        populationLookup={noopPop}
        rowHeight={36}
      />,
    );
    const dots = container.querySelectorAll('circle[fill="#7c3aed"]');
    expect(dots.length).toBe(1);
    fireEvent.mouseEnter(dots[0]!);
    expect(screen.getByText(/Cidade A/)).toBeInTheDocument();
    expect(screen.getByText(/Exame 2160-0/)).toBeInTheDocument();
    expect(screen.getByText(/Variação/)).toBeInTheDocument();
    expect(screen.getByText(/Volume/)).toBeInTheDocument();
    expect(screen.getByText(/Valor unitário/)).toBeInTheDocument();
    // Sem populationLookup → row "População" aparece com label e "indisponível".
    expect(screen.getByText(/^População/)).toBeInTheDocument();
    expect(screen.getByText(/indisponível/)).toBeInTheDocument();
    fireEvent.mouseLeave(dots[0]!);
    expect(screen.queryByText(/Cidade A/)).not.toBeInTheDocument();
  });

  it('omite variação no detector de concentração', () => {
    const concentrationHit = hit({
      baseline: 0.2,
      details: { groupTotal: 5000, share: 0.7, valorAprovadoBRL: 0, volumeExames: 3500 },
      kind: 'concentration',
      observed: 0.7,
      score: 0.7,
    });
    const { container } = render(
      <AnomalyDumbbell
        formatValue={(v) => `${v}`}
        hits={[concentrationHit]}
        kind="concentration"
        labelForLoinc={noopLabel}
        populationLookup={noopPop}
        rowHeight={36}
      />,
    );
    const dot = container.querySelector('circle[fill="#f59e0b"]')!;
    fireEvent.mouseEnter(dot);
    expect(screen.queryByText(/Variação/)).not.toBeInTheDocument();
    expect(screen.getByText(/Share/)).toBeInTheDocument();
    expect(screen.getByText(/Total nacional/)).toBeInTheDocument();
  });

  it('mostra população do município e exames por 1k hab. quando lookup IBGE é fornecido', () => {
    const pop = (code: string, year: number): number | undefined => {
      if (code === '350000' && year === 2024) return 10000;
      return undefined;
    };
    const { container } = render(
      <AnomalyDumbbell
        formatValue={(v) => String(v)}
        hits={[hit({ observed: 1000, details: { volumeExames: 1000, valorAprovadoBRL: 12000 } })]}
        kind="spike"
        labelForLoinc={noopLabel}
        populationLookup={pop}
        rowHeight={36}
      />,
    );
    const dot = container.querySelector('circle[fill="#7c3aed"]')!;
    fireEvent.mouseEnter(dot);
    expect(screen.getByText('10.000')).toBeInTheDocument();
    expect(screen.getByText(/Exames por 1k hab/)).toBeInTheDocument();
    expect(screen.getByText('100.0')).toBeInTheDocument(); // 1000*1000/10000
  });

  it('mostra estatísticas Q1–Q3 no detector de preço/exame', () => {
    const priceHit = hit({
      baseline: 2,
      details: {
        groupN: 100,
        iqr: 0.5,
        median: 2,
        q1: 1.75,
        q3: 2.25,
        ratio: 7,
        valorAprovadoBRL: 7000,
        volumeExames: 1000,
      },
      kind: 'price-ratio',
      observed: 7,
      score: 10,
    });
    const { container } = render(
      <AnomalyDumbbell
        formatValue={(v) => `R$ ${v}`}
        hits={[priceHit]}
        kind="price-ratio"
        labelForLoinc={noopLabel}
        populationLookup={noopPop}
        rowHeight={36}
      />,
    );
    const dot = container.querySelector('circle[fill="#ef4444"]')!;
    fireEvent.mouseEnter(dot);
    expect(screen.getByText(/Q1.+Q3/)).toBeInTheDocument();
    expect(screen.getByText(/Municípios/)).toBeInTheDocument();
    // Em price-ratio o observed JÁ é o valor unitário, então
    // omitimos a row extra "Valor unitário".
    expect(screen.queryByText(/Valor unitário/)).not.toBeInTheDocument();
  });
});

describe('isDumbbellLogScale', () => {
  it('retorna false em range comprimido', () => {
    expect(isDumbbellLogScale([hit({ baseline: 50, observed: 100 })])).toBe(false);
  });

  it('retorna true em range heavy-tailed', () => {
    expect(isDumbbellLogScale([hit({ baseline: 50, observed: 100_000 })])).toBe(true);
  });

  it('ignora zero ao escolher o floor', () => {
    // Sem ignorar zeros, lo=0 e a função antiga retornaria false.
    // Com o fix, hi=100k justifica log mesmo com um baseline=0.
    const hits = [hit({ baseline: 0, observed: 5 }), hit({ baseline: 10, observed: 100_000 })];
    expect(isDumbbellLogScale(hits)).toBe(true);
  });

  it('retorna false em array vazio', () => {
    expect(isDumbbellLogScale([])).toBe(false);
  });
});
