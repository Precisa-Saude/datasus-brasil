import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/duckdb', () => ({
  queryAll: vi.fn(async () => []),
}));

import { queryAll } from '@/lib/duckdb';
import { useDataCubes } from '@/lib/use-data-cubes';

const queryAllMock = vi.mocked(queryAll);

const COMPETENCIAS = ['2024-01', '2024-02', '2024-03'];

beforeEach(() => {
  queryAllMock.mockReset();
});

describe('useDataCubes', () => {
  it('constrói o cubo nacional e expõe ufTotals via lookup', async () => {
    queryAllMock.mockResolvedValueOnce([
      { competencia: '2024-01', ufSigla: 'SP', val: 100, vol: 10 },
      { competencia: '2024-02', ufSigla: 'SP', val: 200, vol: 20 },
      { competencia: '2024-03', ufSigla: 'SP', val: 300, vol: 30 },
    ]);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useDataCubes(COMPETENCIAS, null, { from: '2024-01', to: '2024-03' }, onError),
    );
    await waitFor(() => expect(result.current.ufCube).not.toBeNull());
    expect(result.current.ufTotals.get('SP')?.volume).toBe(60);
    expect(result.current.municipioCube).toBeNull();
    expect(result.current.municipioTotals).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('constrói o cubo municipal quando uma UF é selecionada', async () => {
    queryAllMock
      .mockResolvedValueOnce([{ competencia: '2024-01', ufSigla: 'SP', val: 100, vol: 10 }])
      .mockResolvedValueOnce([
        {
          competencia: '2024-01',
          municipioCode: '355030',
          municipioNome: 'São Paulo',
          val: 80,
          vol: 8,
        },
      ]);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useDataCubes(COMPETENCIAS, 'SP', { from: '2024-01', to: '2024-01' }, onError),
    );
    await waitFor(() => expect(result.current.municipioCube).not.toBeNull());
    expect(result.current.municipioTotals?.get('355030')?.volume).toBe(8);
    expect(result.current.municipioTotals?.get('355030')?.label).toBe('São Paulo');
  });

  it('reporta erro via callback quando build falha', async () => {
    queryAllMock.mockRejectedValueOnce(new Error('boom'));
    const onError = vi.fn();
    renderHook(() => useDataCubes(COMPETENCIAS, null, { from: '2024-01', to: '2024-03' }, onError));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('boom'));
  });

  it('lookups vazios quando range é null', async () => {
    queryAllMock.mockResolvedValueOnce([
      { competencia: '2024-01', ufSigla: 'SP', val: 100, vol: 10 },
    ]);
    const { result } = renderHook(() => useDataCubes(COMPETENCIAS, null, null, vi.fn()));
    await waitFor(() => expect(result.current.ufCube).not.toBeNull());
    expect(result.current.ufTotals.size).toBe(0);
  });

  it('descartar setSelectedUf zera o cubo municipal', async () => {
    queryAllMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        competencia: '2024-01',
        municipioCode: '355030',
        municipioNome: 'São Paulo',
        val: 1,
        vol: 1,
      },
    ]);
    const { rerender, result } = renderHook(
      ({ uf }: { uf: null | string }) =>
        useDataCubes(COMPETENCIAS, uf, { from: '2024-01', to: '2024-01' }, vi.fn()),
      { initialProps: { uf: 'SP' as null | string } },
    );
    await waitFor(() => expect(result.current.municipioCube).not.toBeNull());
    act(() => rerender({ uf: null }));
    expect(result.current.municipioCube).toBeNull();
  });
});
