import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CompetenciaBrush } from '@/components/CompetenciaBrush';

const COMPETENCIAS = ['2023-01', '2023-06', '2024-01', '2024-06', '2024-12'];

function makeVolume(): Map<string, number> {
  return new Map([
    ['2023-01', 100],
    ['2023-06', 200],
    ['2024-01', 150],
    ['2024-06', 50],
    ['2024-12', 300],
  ]);
}

describe('CompetenciaBrush', () => {
  it('renderiza rótulo com a faixa atual formatada', () => {
    render(
      <CompetenciaBrush
        competencias={COMPETENCIAS}
        onCommit={vi.fn()} onPreview={vi.fn()}
        value={{ from: '2023-01', to: '2024-12' }}
        volumeByCompetencia={makeVolume()}
      />,
    );
    expect(screen.getByText('Competência')).toBeInTheDocument();
    expect(screen.getByText('Jan. 2023 – Dez. 2024')).toBeInTheDocument();
  });

  it('renderiza ticks de início de ano', () => {
    render(
      <CompetenciaBrush
        competencias={COMPETENCIAS}
        onCommit={vi.fn()} onPreview={vi.fn()}
        value={{ from: '2023-01', to: '2024-12' }}
        volumeByCompetencia={makeVolume()}
      />,
    );
    expect(screen.getByText('2023')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
  });

  it('expõe handles como sliders ARIA com from/to', () => {
    render(
      <CompetenciaBrush
        competencias={COMPETENCIAS}
        onCommit={vi.fn()} onPreview={vi.fn()}
        value={{ from: '2023-06', to: '2024-06' }}
        volumeByCompetencia={makeVolume()}
      />,
    );
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(2);
    const start = screen.getByLabelText('Início da faixa');
    const end = screen.getByLabelText('Fim da faixa');
    expect(start.getAttribute('aria-valuetext')).toBe('Jun. 2023');
    expect(end.getAttribute('aria-valuetext')).toBe('Jun. 2024');
  });

  it('teclado: → no handle de fim avança um mês', () => {
    const onChange = vi.fn();
    render(
      <CompetenciaBrush
        competencias={COMPETENCIAS}
        onCommit={onChange} onPreview={vi.fn()}
        value={{ from: '2023-01', to: '2024-01' }}
        volumeByCompetencia={makeVolume()}
      />,
    );
    const end = screen.getByLabelText('Fim da faixa');
    fireEvent.keyDown(end, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith({ from: '2023-01', to: '2024-06' });
  });

  it('teclado: → no handle de início clampa em to - 1 (faixa mín. 2 meses)', () => {
    const onChange = vi.fn();
    render(
      <CompetenciaBrush
        competencias={COMPETENCIAS}
        onCommit={onChange} onPreview={vi.fn()}
        value={{ from: '2023-01', to: '2024-06' }}
        volumeByCompetencia={makeVolume()}
      />,
    );
    const start = screen.getByLabelText('Início da faixa');
    // Shift+→ tenta avançar 12 meses; deve clampar em to - 1 = '2024-01'
    fireEvent.keyDown(start, { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith({ from: '2024-01', to: '2024-06' });
  });
});
