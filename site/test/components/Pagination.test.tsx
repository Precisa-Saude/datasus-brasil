import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Pagination } from '@/components/ui/pagination';

describe('Pagination', () => {
  it('mostra indicador "page / totalPages" e contagem total', () => {
    render(
      <Pagination
        itemsLabel="itens"
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={2}
        pageSize={10}
        totalRows={45}
      />,
    );
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
    expect(screen.getByText(/45 itens/)).toBeInTheDocument();
  });

  it('clampa pageSize=0 para evitar divisão por zero', () => {
    render(
      <Pagination
        itemsLabel="itens"
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={1}
        pageSize={0}
        totalRows={30}
      />,
    );
    // Com clamp = 1, totalPages = ceil(30/1) = 30, finito.
    expect(screen.getByText('1 / 30')).toBeInTheDocument();
  });

  it('desabilita "Anterior" na primeira página e "Próxima" na última', () => {
    const { rerender } = render(
      <Pagination
        itemsLabel="itens"
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={1}
        pageSize={10}
        totalRows={30}
      />,
    );
    expect(screen.getByLabelText('Anterior')).toBeDisabled();
    expect(screen.getByLabelText('Próxima')).not.toBeDisabled();
    rerender(
      <Pagination
        itemsLabel="itens"
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={3}
        pageSize={10}
        totalRows={30}
      />,
    );
    expect(screen.getByLabelText('Próxima')).toBeDisabled();
  });

  it('dispara onPageChange com os valores corretos pra cada botão', () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        itemsLabel="itens"
        onPageChange={onPageChange}
        onPageSizeChange={() => undefined}
        page={3}
        pageSize={10}
        totalRows={50}
      />,
    );
    fireEvent.click(screen.getByLabelText('Primeira página'));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByLabelText('Anterior'));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByLabelText('Próxima'));
    expect(onPageChange).toHaveBeenLastCalledWith(4);
    fireEvent.click(screen.getByLabelText('Última página'));
    expect(onPageChange).toHaveBeenLastCalledWith(5);
  });
});
