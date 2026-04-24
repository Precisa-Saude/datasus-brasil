import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/duckdb', () => ({
  queryAll: vi.fn(async () => []),
}));

import { queryAll } from '@/lib/duckdb';
import { fetchMunicipioAggregates, fetchUfAggregates } from '@/lib/queries';

const queryAllMock = vi.mocked(queryAll);

beforeEach(() => {
  queryAllMock.mockClear();
  queryAllMock.mockResolvedValue([]);
});

describe('fetchUfAggregates', () => {
  it('filtra pela competência informada', async () => {
    await fetchUfAggregates('2024-01');
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain("WHERE competencia = '2024-01'");
    expect(sql).toContain('uf-totals.parquet');
  });

  it('faz CAST para DOUBLE para evitar BigInt no cliente', async () => {
    await fetchUfAggregates('2024-02');
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('CAST(volumeExames AS DOUBLE)');
    expect(sql).toContain('CAST(valorAprovadoBRL AS DOUBLE)');
  });

  it('escapa aspas simples na competência pra evitar SQL injection', async () => {
    await fetchUfAggregates("2024'01");
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain("'2024''01'");
  });

  it('propaga as linhas retornadas pelo DuckDB', async () => {
    queryAllMock.mockResolvedValueOnce([
      {
        competencia: '2024-01',
        loinc: '4548-4',
        ufSigla: 'SP',
        valorAprovadoBRL: 100,
        volumeExames: 10,
      },
    ]);
    const rows = await fetchUfAggregates('2024-01');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ufSigla).toBe('SP');
  });
});

describe('fetchMunicipioAggregates', () => {
  it('lê do Parquet consolidado da UF', async () => {
    await fetchMunicipioAggregates('SP', '2024-01');
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('uf=SP/part.parquet');
    expect(sql).toContain("WHERE competencia = '2024-01'");
  });

  it('injeta ufSigla como literal na SELECT', async () => {
    await fetchMunicipioAggregates('RJ', '2024-05');
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain("'RJ' AS ufSigla");
  });

  it('escapa aspas simples tanto em uf quanto em competência', async () => {
    await fetchMunicipioAggregates("A'C", "2024'01");
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain("'A''C'");
    expect(sql).toContain("'2024''01'");
  });
});
