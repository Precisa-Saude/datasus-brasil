import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Combobox } from '@/components/ui/combobox';

const ITEMS = [
  { label: 'Ácido Úrico — 3084-1', value: '3084-1' },
  { label: 'Alanina Aminotransferase — 1742-6', value: '1742-6' },
];

describe('Combobox', () => {
  it('mostra o label do item selecionado quando value casa', () => {
    render(<Combobox items={ITEMS} onChange={vi.fn()} value="1742-6" />);
    expect(screen.getByText('Alanina Aminotransferase — 1742-6')).toBeInTheDocument();
  });

  it('mostra o placeholder quando value não casa com nenhum item', () => {
    render(
      <Combobox items={ITEMS} onChange={vi.fn()} placeholder="Selecionar exame" value="999-9" />,
    );
    expect(screen.getByText('Selecionar exame')).toBeInTheDocument();
  });

  it('expõe o ariaLabel passado no botão trigger', () => {
    render(
      <Combobox
        ariaLabel="Selecionar biomarcador"
        items={ITEMS}
        onChange={vi.fn()}
        value="3084-1"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Selecionar biomarcador' })).toBeInTheDocument();
  });

  it('alterna aria-expanded ao clicar no trigger', () => {
    render(<Combobox ariaLabel="Combo" items={ITEMS} onChange={vi.fn()} value="3084-1" />);
    const trigger = screen.getByRole('combobox', { name: 'Combo' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
