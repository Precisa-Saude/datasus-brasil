import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AnomalyDetectorTable } from '@/components/AnomalyDetectorTable';
import type { AnomalyHit } from '@/lib/anomaly';

function hit(idx: number): AnomalyHit {
  return {
    baseline: 50,
    competencia: `2024-${String((idx % 12) + 1).padStart(2, '0')}`,
    details: {
      baselineN: 12,
      mad: 3,
      valorAprovadoBRL: 1000 + idx,
      volumeExames: 100 + idx,
      windowMonths: 12,
      z: 5 + idx,
    },
    kind: 'spike',
    loinc: '2160-0',
    municipioCode: `35${String(idx).padStart(4, '0')}`,
    municipioNome: `Cidade ${idx}`,
    observed: 1000 + idx,
    score: 5 + idx,
    ufSigla: 'SP',
  };
}

function renderTable(hits: AnomalyHit[], page = 1, pageSize = 20) {
  const onPageChange = vi.fn();
  const onPageSizeChange = vi.fn();
  const utils = render(
    <MemoryRouter>
      <AnomalyDetectorTable
        axisLabel="Volume de exames"
        formatValue={(v) => String(v)}
        hits={hits}
        kind="spike"
        labelForLoinc={(l) => `Exame ${l}`}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        page={page}
        pageSize={pageSize}
        title="Pico temporal"
      />
    </MemoryRouter>,
  );
  return { ...utils, onPageChange, onPageSizeChange };
}

describe('AnomalyDetectorTable', () => {
  it('renderiza cabeçalhos da tabela e o título do detector', () => {
    renderTable([hit(0)]);
    expect(screen.getByText('Pico temporal')).toBeInTheDocument();
    expect(screen.getByText('Município')).toBeInTheDocument();
    expect(screen.getByText('UF')).toBeInTheDocument();
    expect(screen.getByText('Mês')).toBeInTheDocument();
    expect(screen.getByText('Exame')).toBeInTheDocument();
  });

  it('renderiza apenas a página atual de hits e link para o município', () => {
    const hits = Array.from({ length: 30 }, (_, i) => hit(i));
    renderTable(hits, 1, 10);
    expect(screen.getByText('Cidade 0')).toBeInTheDocument();
    expect(screen.queryByText('Cidade 15')).not.toBeInTheDocument();
    const link = screen.getByText('Cidade 0').closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/uf/SP/mun/350000');
  });

  it('mostra contador total na paginação', () => {
    const hits = Array.from({ length: 30 }, (_, i) => hit(i));
    renderTable(hits, 1, 10);
    expect(screen.getByText(/30 achados/)).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('dispara onPageChange ao clicar em próxima', () => {
    const hits = Array.from({ length: 30 }, (_, i) => hit(i));
    const { onPageChange } = renderTable(hits, 1, 10);
    fireEvent.click(screen.getByLabelText('Próxima'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('estado vazio: renderiza header mas zero linhas de dados', () => {
    const { container } = renderTable([], 1, 10);
    // header tem o link "Município" mas sem dados não há `<a>` clicável de cidade
    expect(within(container).queryAllByRole('link')).toHaveLength(0);
  });
});
