import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CompetenciaSlider, formatCompetencia } from '@/components/CompetenciaSlider';

describe('formatCompetencia', () => {
  it('formata YYYY-MM para "Mmm. YYYY"', () => {
    expect(formatCompetencia('2024-01')).toBe('Jan. 2024');
    expect(formatCompetencia('2024-12')).toBe('Dez. 2024');
    expect(formatCompetencia('2008-07')).toBe('Jul. 2008');
  });

  it('retorna input original quando inválido', () => {
    expect(formatCompetencia('invalido')).toBe('invalido');
    expect(formatCompetencia('2024-13')).toBe('2024-13');
  });
});

describe('CompetenciaSlider', () => {
  const competencias = ['2023-01', '2023-06', '2024-01', '2024-12'];

  it('renderiza rótulo com valor atual formatado', () => {
    render(<CompetenciaSlider competencias={competencias} onChange={vi.fn()} value="2024-01" />);
    expect(screen.getByText('Competência')).toBeInTheDocument();
    expect(screen.getByText('Jan. 2024')).toBeInTheDocument();
  });

  it('aciona onChange com nova competência ao mover o slider', () => {
    const onChange = vi.fn();
    render(<CompetenciaSlider competencias={competencias} onChange={onChange} value="2023-01" />);
    const input = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith('2024-01');
  });

  it('renderiza ticks de início de ano', () => {
    render(<CompetenciaSlider competencias={competencias} onChange={vi.fn()} value="2024-01" />);
    // 2023-01 e 2024-01 são inícios de ano → devem aparecer labels "2023" e "2024"
    expect(screen.getByText('2023')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
  });

  it('lida com lista vazia graciosamente', () => {
    render(<CompetenciaSlider competencias={[]} onChange={vi.fn()} value="" />);
    expect(screen.getByText('Competência')).toBeInTheDocument();
  });
});
