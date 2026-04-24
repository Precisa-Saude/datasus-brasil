import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BiomarkerSelect } from '@/components/BiomarkerSelect';

const BIOMARKERS = [
  { code: 'HbA1c', display: 'Hemoglobina glicada', loinc: '4548-4' },
  { code: 'HDL', display: 'Colesterol HDL', loinc: '2085-9' },
  { code: 'AST', display: 'Aspartato Aminotransferase', loinc: '1920-8' },
];

describe('BiomarkerSelect', () => {
  it('renderiza uma option por biomarcador com display + code', () => {
    render(<BiomarkerSelect biomarkers={BIOMARKERS} onChange={() => {}} value="4548-4" />);
    const select = screen.getByLabelText(/Selecionar biomarcador/i) as HTMLSelectElement;
    expect(select.options).toHaveLength(3);
    expect(select.options[0].textContent).toContain('Hemoglobina glicada');
    expect(select.options[0].textContent).toContain('HbA1c');
    expect(select.value).toBe('4548-4');
  });

  it('dispara onChange com o LOINC selecionado', () => {
    const onChange = vi.fn();
    render(<BiomarkerSelect biomarkers={BIOMARKERS} onChange={onChange} value="4548-4" />);
    const select = screen.getByLabelText(/Selecionar biomarcador/i);
    fireEvent.change(select, { target: { value: '2085-9' } });
    expect(onChange).toHaveBeenCalledWith('2085-9');
  });
});
