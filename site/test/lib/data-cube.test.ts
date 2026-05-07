import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/duckdb', () => ({
  queryAll: vi.fn(async () => []),
}));

import { buildMunicipioCube, buildUfCube, lookupRange } from '@/lib/data-cube';
import { queryAll } from '@/lib/duckdb';

const queryAllMock = vi.mocked(queryAll);

beforeEach(() => {
  queryAllMock.mockReset();
});

const COMPETENCIAS = ['2024-01', '2024-02', '2024-03'];

describe('buildUfCube + lookupRange', () => {
  it('agrupa por UF × mês e a soma do range bate com a soma direta', async () => {
    queryAllMock.mockResolvedValueOnce([
      { competencia: '2024-01', ufSigla: 'SP', val: 1000, vol: 100 },
      { competencia: '2024-01', ufSigla: 'RJ', val: 500, vol: 50 },
      { competencia: '2024-02', ufSigla: 'SP', val: 2000, vol: 200 },
      { competencia: '2024-02', ufSigla: 'RJ', val: 700, vol: 70 },
      { competencia: '2024-03', ufSigla: 'SP', val: 3000, vol: 300 },
      { competencia: '2024-03', ufSigla: 'RJ', val: 900, vol: 90 },
    ]);
    const cube = await buildUfCube(COMPETENCIAS);
    expect(cube.bins).toEqual(['RJ', 'SP']);
    expect(cube.binLabels).toEqual(['RJ', 'SP']);

    // Range cobrindo todos os meses
    const all = lookupRange(cube, { from: '2024-01', to: '2024-03' });
    expect(all.byBin.get('SP')?.volume).toBe(600);
    expect(all.byBin.get('SP')?.valor).toBe(6000);
    expect(all.byBin.get('RJ')?.volume).toBe(210);
    expect(all.max).toBe(600);

    // Range parcial
    const part = lookupRange(cube, { from: '2024-02', to: '2024-03' });
    expect(part.byBin.get('SP')?.volume).toBe(500);
    expect(part.byBin.get('RJ')?.volume).toBe(160);
  });

  it('lookup com from === to retorna o mês inteiro', async () => {
    queryAllMock.mockResolvedValueOnce([
      { competencia: '2024-02', ufSigla: 'SP', val: 1234, vol: 42 },
    ]);
    const cube = await buildUfCube(COMPETENCIAS);
    const r = lookupRange(cube, { from: '2024-02', to: '2024-02' });
    expect(r.byBin.get('SP')?.volume).toBe(42);
    expect(r.byBin.get('SP')?.valor).toBe(1234);
  });

  it('omite bins com volume zero no resultado', async () => {
    queryAllMock.mockResolvedValueOnce([
      { competencia: '2024-01', ufSigla: 'SP', val: 100, vol: 10 },
      // RJ não aparece no mês — não deve estar no byBin
    ]);
    const cube = await buildUfCube(COMPETENCIAS);
    const r = lookupRange(cube, { from: '2024-01', to: '2024-01' });
    expect(r.byBin.has('SP')).toBe(true);
    expect(r.byBin.has('RJ')).toBe(false);
  });

  it('emite SQL agregado com SUM(volumeExames) e SUM(valorAprovadoBRL)', async () => {
    queryAllMock.mockResolvedValueOnce([]);
    await buildUfCube(COMPETENCIAS);
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('SUM(volumeExames)');
    expect(sql).toContain('SUM(valorAprovadoBRL)');
    expect(sql).toContain('GROUP BY competencia, ufSigla');
  });
});

describe('buildMunicipioCube', () => {
  it('preserva nome do município no binLabels', async () => {
    queryAllMock.mockResolvedValueOnce([
      {
        competencia: '2024-01',
        municipioCode: '355030',
        municipioNome: 'São Paulo',
        val: 100,
        vol: 10,
      },
      {
        competencia: '2024-02',
        municipioCode: '355030',
        municipioNome: 'São Paulo',
        val: 200,
        vol: 20,
      },
      {
        competencia: '2024-01',
        municipioCode: '350410',
        municipioNome: 'Barueri',
        val: 50,
        vol: 5,
      },
    ]);
    const cube = await buildMunicipioCube('SP', COMPETENCIAS);
    expect(cube.bins).toEqual(['350410', '355030']);
    expect(cube.binLabels).toEqual(['Barueri', 'São Paulo']);

    const r = lookupRange(cube, { from: '2024-01', to: '2024-02' });
    expect(r.byBin.get('355030')?.volume).toBe(30);
    expect(r.byBin.get('355030')?.label).toBe('São Paulo');
  });

  it('rejeita UF inválida', async () => {
    await expect(buildMunicipioCube('A1', COMPETENCIAS)).rejects.toThrow(/UF inválida/);
    expect(queryAllMock).not.toHaveBeenCalled();
  });
});
