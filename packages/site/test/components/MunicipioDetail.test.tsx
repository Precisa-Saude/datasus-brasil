import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MunicipioDetail } from '@/components/MunicipioDetail';
import type { MunicipioAggregate } from '@/lib/aggregates';

const BIOMARKERS_BY_LOINC: Record<string, string> = {
  '4548-4': 'Hemoglobina glicada',
  '2085-9': 'Colesterol HDL',
  '1920-8': 'Aspartato Aminotransferase',
};

const MUNICIPIO = { codigo: '355030', nome: 'São Paulo', ufSigla: 'SP' };

function makeData(): MunicipioAggregate[] {
  return [
    {
      competencia: '2024-01',
      loinc: '4548-4',
      municipioCode: '355030',
      municipioNome: 'São Paulo',
      valorAprovadoBRL: 500,
      volumeExames: 100,
    },
    {
      competencia: '2024-01',
      loinc: '2085-9',
      municipioCode: '355030',
      municipioNome: 'São Paulo',
      valorAprovadoBRL: 1500,
      volumeExames: 250,
    },
    {
      competencia: '2024-01',
      loinc: '1920-8',
      municipioCode: '355030',
      municipioNome: 'São Paulo',
      valorAprovadoBRL: 0,
      volumeExames: 0,
    },
    // outra competência — deve ser filtrada
    {
      competencia: '2024-02',
      loinc: '4548-4',
      municipioCode: '355030',
      municipioNome: 'São Paulo',
      valorAprovadoBRL: 900,
      volumeExames: 300,
    },
    // outro município — deve ser filtrado pelo prefixo de 6 dígitos
    {
      competencia: '2024-01',
      loinc: '4548-4',
      municipioCode: '330455',
      municipioNome: 'Rio de Janeiro',
      valorAprovadoBRL: 999,
      volumeExames: 999,
    },
  ];
}

function renderDetail(overrides: Partial<Parameters<typeof MunicipioDetail>[0]> = {}) {
  return render(
    <MunicipioDetail
      biomarkersByLoinc={BIOMARKERS_BY_LOINC}
      competencia="2024-01"
      data={makeData()}
      municipio={MUNICIPIO}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe('MunicipioDetail', () => {
  it('mostra nome e UF do município no header', () => {
    renderDetail();
    const header = screen.getByRole('heading', { level: 2 });
    expect(header.textContent).toContain('São Paulo');
    expect(header.textContent).toContain('SP');
  });

  it('filtra pela competência selecionada', () => {
    renderDetail();
    expect(screen.queryByText(/2024-02/)).toBeNull();
  });

  it('omite exames com volume zero', () => {
    renderDetail();
    expect(screen.queryByText('Aspartato Aminotransferase')).toBeNull();
  });

  it('filtra por prefixo de 6 dígitos do municipioCode (ignora outro município)', () => {
    renderDetail();
    expect(screen.queryByText('Rio de Janeiro')).toBeNull();
  });

  it('ordena por volume desc por default', () => {
    renderDetail();
    const rows = screen.getAllByRole('row').slice(1); // tira o header
    // HDL tem 250 exames, HbA1c tem 100
    expect(rows[0]?.textContent).toContain('Colesterol HDL');
    expect(rows[1]?.textContent).toContain('Hemoglobina glicada');
  });

  it('alterna direção ao clicar novamente na mesma coluna', () => {
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: /Volume/i }));
    const rows = screen.getAllByRole('row').slice(1);
    // asc: HbA1c (100) antes de HDL (250)
    expect(rows[0]?.textContent).toContain('Hemoglobina glicada');
  });

  it('troca de coluna usa a direção default (display=asc)', () => {
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: /Exame/i }));
    const rows = screen.getAllByRole('row').slice(1);
    // asc alfabético: Colesterol HDL antes de Hemoglobina glicada
    expect(rows[0]?.textContent).toContain('Colesterol HDL');
  });

  it('mostra fallback quando não há dados para a competência', () => {
    renderDetail({ competencia: '2099-12' });
    expect(screen.getByText(/Nenhum exame laboratorial registrado/i)).toBeDefined();
  });

  it('dispara onClose ao clicar no botão de fechar', () => {
    const onClose = vi.fn();
    renderDetail({ onClose });
    fireEvent.click(screen.getByLabelText('Fechar'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('cai no próprio LOINC quando o biomarcador não está no dicionário', () => {
    renderDetail({ biomarkersByLoinc: {} });
    const rows = screen.getAllByRole('row').slice(1);
    // Todos os displays devem ser os LOINC
    expect(within(rows[0]!).getByText('2085-9')).toBeDefined();
  });
});
