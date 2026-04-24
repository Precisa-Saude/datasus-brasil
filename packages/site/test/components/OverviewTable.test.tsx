import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { OverviewRow } from '@/components/OverviewTable';
import { OverviewTable } from '@/components/OverviewTable';

const rows: OverviewRow[] = [
  { key: 'SP', primary: 'São Paulo', valor: 1_000_000, volume: 5000 },
  { key: 'MG', primary: 'Minas Gerais', valor: 800_000, volume: 4000 },
  { key: 'RJ', primary: 'Rio de Janeiro', valor: 600_000, volume: 3500 },
];

describe('OverviewTable', () => {
  it('renderiza título, subtítulo e total calculado', () => {
    render(
      <OverviewTable
        primaryLabel="UF"
        rows={rows}
        subtitle="SIA-SUS Jan. 2024"
        title="Brasil — visão nacional"
      />,
    );
    expect(screen.getByText('Brasil — visão nacional')).toBeInTheDocument();
    // Subtitle contém totais somados:
    const subtitle = screen.getByText(/SIA-SUS Jan\. 2024/);
    expect(subtitle.textContent).toContain('12.500 total');
  });

  it('ordena por volume desc por default', () => {
    render(<OverviewTable primaryLabel="UF" rows={rows} subtitle="" title="" />);
    const bodyRows = screen.getAllByRole('row').slice(1); // skip header
    const firstRowText = within(bodyRows[0]!).getByText(/São Paulo/);
    expect(firstRowText).toBeInTheDocument();
  });

  it('inverte ordenação ao clicar na coluna ativa', () => {
    render(<OverviewTable primaryLabel="UF" rows={rows} subtitle="" title="" />);
    const volumeHeader = screen.getByRole('button', { name: /Volume/ });
    fireEvent.click(volumeHeader);
    // Agora ordena asc — primeira linha deve ser Rio (menor volume)
    const bodyRows = screen.getAllByRole('row').slice(1);
    expect(within(bodyRows[0]!).getByText('Rio de Janeiro')).toBeInTheDocument();
  });

  it('ordena por primary (nome) quando header é clicado', () => {
    render(<OverviewTable primaryLabel="UF" rows={rows} subtitle="" title="" />);
    const nameHeader = screen.getByRole('button', { name: /UF/ });
    fireEvent.click(nameHeader);
    const bodyRows = screen.getAllByRole('row').slice(1);
    // Asc alfabético → Minas Gerais primeiro
    expect(within(bodyRows[0]!).getByText('Minas Gerais')).toBeInTheDocument();
  });

  it('dispara onRowClick com a row correspondente', () => {
    const onRowClick = vi.fn();
    render(
      <OverviewTable onRowClick={onRowClick} primaryLabel="UF" rows={rows} subtitle="" title="" />,
    );
    const bodyRows = screen.getAllByRole('row').slice(1);
    fireEvent.click(bodyRows[0]!);
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ key: 'SP' }));
  });

  it('renderiza botão de fechar apenas quando onClose é passado', () => {
    const { rerender } = render(
      <OverviewTable primaryLabel="UF" rows={rows} subtitle="" title="" />,
    );
    expect(screen.queryByLabelText('Fechar')).not.toBeInTheDocument();

    const onClose = vi.fn();
    rerender(
      <OverviewTable onClose={onClose} primaryLabel="UF" rows={rows} subtitle="" title="" />,
    );
    fireEvent.click(screen.getByLabelText('Fechar'));
    expect(onClose).toHaveBeenCalled();
  });

  it('exibe mensagem vazia quando sem rows', () => {
    render(
      <OverviewTable
        emptyMessage="Nada por aqui"
        primaryLabel="UF"
        rows={[]}
        subtitle=""
        title=""
      />,
    );
    expect(screen.getByText('Nada por aqui')).toBeInTheDocument();
  });

  it('renderiza secondary quando fornecido', () => {
    render(
      <OverviewTable
        primaryLabel="Município"
        rows={[{ key: '1', primary: 'Rio Branco', secondary: 'AC', valor: 0, volume: 100 }]}
        subtitle=""
        title=""
      />,
    );
    expect(screen.getByText('AC')).toBeInTheDocument();
  });
});
