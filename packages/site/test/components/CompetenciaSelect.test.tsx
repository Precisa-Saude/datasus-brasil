import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CompetenciaSelect } from '@/components/CompetenciaSelect';

describe('CompetenciaSelect', () => {
  it('lista competências ordenadas e dispara onChange', () => {
    const onChange = vi.fn();
    render(
      <CompetenciaSelect
        competencias={['2024-01', '2024-02', '2024-03']}
        onChange={onChange}
        value="2024-01"
      />,
    );
    const select = screen.getByLabelText(/Selecionar competência/i) as HTMLSelectElement;
    expect(select.options).toHaveLength(3);
    fireEvent.change(select, { target: { value: '2024-03' } });
    expect(onChange).toHaveBeenCalledWith('2024-03');
  });
});
