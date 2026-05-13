import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { useCompetenciaRange } from '@/lib/use-competencia-range';

const COMPETENCIAS = [
  '2023-01',
  '2023-02',
  '2023-03',
  '2023-04',
  '2023-05',
  '2023-06',
  '2023-07',
  '2023-08',
  '2023-09',
  '2023-10',
  '2023-11',
  '2023-12',
  '2024-01',
  '2024-02',
];

function wrapper(initialEntries: string[]) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
}

describe('useCompetenciaRange', () => {
  it('default = últimos 12 meses quando não há params', () => {
    const { result } = renderHook(() => useCompetenciaRange(COMPETENCIAS), {
      wrapper: wrapper(['/']),
    });
    expect(result.current.range).toEqual({ from: '2023-03', to: '2024-02' });
  });

  it('lê from/to válidos da URL', () => {
    const { result } = renderHook(() => useCompetenciaRange(COMPETENCIAS), {
      wrapper: wrapper(['/?from=2023-06&to=2023-09']),
    });
    expect(result.current.range).toEqual({ from: '2023-06', to: '2023-09' });
  });

  it('aceita janela de 1 mês exato (from === to) — não cai no default', () => {
    // Caso real do PR #40: clicar uma linha do explorador gera
    // `?from=YYYY-MM&to=YYYY-MM` pra mostrar exatamente o volume
    // daquela linha. Antes a validação era `<` estrito e o range
    // colapsado caía no default de 12 meses; agora é `<=`.
    const { result } = renderHook(() => useCompetenciaRange(COMPETENCIAS), {
      wrapper: wrapper(['/?from=2023-07&to=2023-07']),
    });
    expect(result.current.range).toEqual({ from: '2023-07', to: '2023-07' });
  });

  it('cai no default quando from > to (range invertido é inválido)', () => {
    const { result } = renderHook(() => useCompetenciaRange(COMPETENCIAS), {
      wrapper: wrapper(['/?from=2023-09&to=2023-06']),
    });
    // 12 meses defaults — não passa o range invertido.
    expect(result.current.range).toEqual({ from: '2023-03', to: '2024-02' });
  });

  it('compat: ?competencia=YYYY-MM vira faixa de 2 meses terminando no mês pedido', () => {
    const { result } = renderHook(() => useCompetenciaRange(COMPETENCIAS), {
      wrapper: wrapper(['/?competencia=2023-06']),
    });
    expect(result.current.range).toEqual({ from: '2023-05', to: '2023-06' });
  });

  it('?competencia no primeiro mês vira faixa começando nele', () => {
    const { result } = renderHook(() => useCompetenciaRange(COMPETENCIAS), {
      wrapper: wrapper(['/?competencia=2023-01']),
    });
    expect(result.current.range).toEqual({ from: '2023-01', to: '2023-02' });
  });

  it('range nulo quando há menos de 2 competências', () => {
    const { result } = renderHook(() => useCompetenciaRange(['2024-01']), {
      wrapper: wrapper(['/']),
    });
    expect(result.current.range).toBeNull();
  });

  it('setRange escreve from/to na URL', () => {
    const { result } = renderHook(
      () => {
        const api = useCompetenciaRange(COMPETENCIAS);
        const [params] = useSearchParams();
        return { api, params };
      },
      { wrapper: wrapper(['/']) },
    );
    act(() => {
      result.current.api.setRange({ from: '2023-06', to: '2023-09' });
    });
    expect(result.current.params.get('from')).toBe('2023-06');
    expect(result.current.params.get('to')).toBe('2023-09');
  });

  it('resetRange limpa params (efeito reescreve com defaults)', () => {
    const { result } = renderHook(
      () => {
        const api = useCompetenciaRange(COMPETENCIAS);
        const [params] = useSearchParams();
        return { api, params };
      },
      { wrapper: wrapper(['/?from=2023-06&to=2023-09']) },
    );
    act(() => {
      result.current.api.resetRange();
    });
    // O efeito de rewrite roda em sequência e enche os defaults.
    expect(result.current.api.range).toEqual({ from: '2023-03', to: '2024-02' });
  });
});
