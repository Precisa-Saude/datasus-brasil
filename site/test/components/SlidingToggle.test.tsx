import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SlidingToggle } from '@/components/ui/sliding-toggle';

const ITEMS = [
  { label: 'Comparar exames', value: 'exames' },
  { label: 'Comparar UFs', value: 'ufs' },
] as const;

describe('SlidingToggle', () => {
  it('renderiza ambos os itens com seus rótulos', () => {
    render(<SlidingToggle items={ITEMS} onChange={vi.fn()} value="exames" />);
    expect(screen.getByText('Comparar exames')).toBeInTheDocument();
    expect(screen.getByText('Comparar UFs')).toBeInTheDocument();
  });

  it('dispara onChange com o valor do item clicado', () => {
    const onChange = vi.fn();
    render(<SlidingToggle items={ITEMS} onChange={onChange} value="exames" />);
    fireEvent.click(screen.getByText('Comparar UFs'));
    expect(onChange).toHaveBeenCalledWith('ufs');
  });

  it('aplica destaque (text-primary-foreground) ao item ativo', () => {
    render(<SlidingToggle items={ITEMS} onChange={vi.fn()} value="ufs" />);
    const active = screen.getByText('Comparar UFs');
    const inactive = screen.getByText('Comparar exames');
    expect(active.className).toContain('text-primary-foreground');
    expect(inactive.className).toContain('text-muted-foreground');
  });

  it('não renderiza pill ativo quando value não casa com nenhum item', () => {
    const { container } = render(
      <SlidingToggle items={ITEMS} onChange={vi.fn()} value={'inexistente' as 'exames' | 'ufs'} />,
    );
    // O indicador é o único `aria-hidden` interno; sem item ativo, ele some.
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
