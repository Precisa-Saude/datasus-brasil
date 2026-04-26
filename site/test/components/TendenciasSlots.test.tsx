import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ComboboxSlots } from '@/components/TendenciasSlots';

const ITEMS = [
  { label: 'SP', value: 'SP' },
  { label: 'RJ', value: 'RJ' },
  { label: 'MG', value: 'MG' },
];

describe('ComboboxSlots', () => {
  it('renderiza um Combobox por valor', () => {
    render(
      <ComboboxSlots
        ariaPrefix="UF"
        colors={['#7c3aed', '#f59e0b', '#10b981']}
        items={ITEMS}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        removeLabel="Remover UF"
        searchPlaceholder="Buscar UF…"
        values={['SP', 'RJ']}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'UF 1' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'UF 2' })).toBeInTheDocument();
  });

  it('esconde o botão de remover quando há apenas um slot', () => {
    render(
      <ComboboxSlots
        ariaPrefix="UF"
        colors={['#7c3aed']}
        items={ITEMS}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        removeLabel="Remover UF"
        searchPlaceholder="Buscar UF…"
        values={['SP']}
      />,
    );
    expect(screen.queryByRole('button', { name: /Remover UF/i })).toBeNull();
  });

  it('chama onRemove com o índice do slot clicado', () => {
    const onRemove = vi.fn();
    render(
      <ComboboxSlots
        ariaPrefix="UF"
        colors={['#7c3aed', '#f59e0b']}
        items={ITEMS}
        onChange={vi.fn()}
        onRemove={onRemove}
        removeLabel="Remover UF"
        searchPlaceholder="Buscar UF…"
        values={['SP', 'RJ']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remover UF 2' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('aplica a cor passada no bullet de cada slot', () => {
    const { container } = render(
      <ComboboxSlots
        ariaPrefix="UF"
        colors={['rgb(255, 0, 0)', 'rgb(0, 255, 0)']}
        items={ITEMS}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        removeLabel="Remover UF"
        searchPlaceholder="Buscar UF…"
        values={['SP', 'RJ']}
      />,
    );
    const bullets = container.querySelectorAll('span[aria-hidden="true"].rounded-full');
    expect(bullets[0]).toHaveStyle({ background: 'rgb(255, 0, 0)' });
    expect(bullets[1]).toHaveStyle({ background: 'rgb(0, 255, 0)' });
  });
});
