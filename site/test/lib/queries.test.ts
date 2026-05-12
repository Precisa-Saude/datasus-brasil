import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/duckdb', () => ({
  queryAll: vi.fn(async () => []),
}));

import { queryAll } from '@/lib/duckdb';
import {
  fetchAnomalyDataset,
  fetchMunicipioAggregates,
  fetchTopLoincsByVolume,
  fetchTopUfsByVolume,
  fetchTrend,
  fetchTrendByUf,
  fetchUfAggregates,
} from '@/lib/queries';

const queryAllMock = vi.mocked(queryAll);

beforeEach(() => {
  queryAllMock.mockClear();
  queryAllMock.mockResolvedValue([]);
});

describe('fetchUfAggregates', () => {
  it('filtra pela faixa de competências informada', async () => {
    await fetchUfAggregates({ from: '2024-01', to: '2024-06' });
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain("WHERE competencia BETWEEN '2024-01' AND '2024-06'");
    expect(sql).toContain('uf-totals.parquet');
  });

  it('faz CAST para DOUBLE para evitar BigInt no cliente', async () => {
    await fetchUfAggregates({ from: '2024-02', to: '2024-02' });
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('CAST(volumeExames AS DOUBLE)');
    expect(sql).toContain('CAST(valorAprovadoBRL AS DOUBLE)');
  });

  it('rejeita competência com caracteres fora do whitelist (defesa contra SQL injection)', async () => {
    await expect(fetchUfAggregates({ from: "2024'01", to: '2024-06' })).rejects.toThrow(
      /competencia/,
    );
    await expect(fetchUfAggregates({ from: '2024-01', to: "2024'06" })).rejects.toThrow(
      /competencia/,
    );
    expect(queryAllMock).not.toHaveBeenCalled();
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
    const rows = await fetchUfAggregates({ from: '2024-01', to: '2024-01' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ufSigla).toBe('SP');
  });
});

describe('fetchTrend', () => {
  it('retorna lista vazia sem disparar query quando loincs está vazio', async () => {
    const rows = await fetchTrend([], null);
    expect(rows).toEqual([]);
    expect(queryAllMock).not.toHaveBeenCalled();
  });

  it('monta filtro IN com a lista de LOINCs e agrupa por competência', async () => {
    await fetchTrend(['2160-0', '1742-6'], null);
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain("WHERE loinc IN ('2160-0', '1742-6')");
    expect(sql).toContain('GROUP BY competencia, loinc');
    expect(sql).not.toContain('AND ufSigla');
  });

  it('inclui filtro de UF quando ufSigla é informado', async () => {
    await fetchTrend(['2160-0'], 'SP');
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain("AND ufSigla = 'SP'");
  });

  it('rejeita LOINC com caractere fora do whitelist', async () => {
    await expect(fetchTrend(["a'b"], null)).rejects.toThrow(/loinc/);
    expect(queryAllMock).not.toHaveBeenCalled();
  });

  it('rejeita ufSigla com caractere fora do whitelist', async () => {
    await expect(fetchTrend(['2160-0'], "S'P")).rejects.toThrow(/ufSigla/);
    expect(queryAllMock).not.toHaveBeenCalled();
  });
});

describe('fetchTrendByUf', () => {
  it('retorna lista vazia sem disparar query quando ufSiglas está vazio', async () => {
    const rows = await fetchTrendByUf('2160-0', []);
    expect(rows).toEqual([]);
    expect(queryAllMock).not.toHaveBeenCalled();
  });

  it('filtra por LOINC único e IN de UFs', async () => {
    await fetchTrendByUf('2160-0', ['SP', 'RJ']);
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain("WHERE loinc = '2160-0' AND ufSigla IN ('SP', 'RJ')");
    expect(sql).toContain('ufSigla AS seriesId');
  });
});

describe('fetchTopLoincsByVolume', () => {
  it('retorna [] sem query quando n <= 0', async () => {
    expect(await fetchTopLoincsByVolume(0)).toEqual([]);
    expect(await fetchTopLoincsByVolume(-3)).toEqual([]);
    expect(queryAllMock).not.toHaveBeenCalled();
  });

  it('ordena por SUM(volumeExames) e aplica LIMIT inteiro', async () => {
    await fetchTopLoincsByVolume(3);
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('ORDER BY SUM(volumeExames) DESC');
    expect(sql).toContain('LIMIT 3');
    expect(sql).toContain('GROUP BY loinc');
  });

  it('mapeia rows.loinc para o array de strings', async () => {
    queryAllMock.mockResolvedValueOnce([{ loinc: '2160-0' }, { loinc: '1742-6' }]);
    const result = await fetchTopLoincsByVolume(2);
    expect(result).toEqual(['2160-0', '1742-6']);
  });
});

describe('fetchTopUfsByVolume', () => {
  it('retorna [] sem query quando n <= 0', async () => {
    expect(await fetchTopUfsByVolume(0)).toEqual([]);
    expect(queryAllMock).not.toHaveBeenCalled();
  });

  it('agrupa por ufSigla e ordena por volume', async () => {
    await fetchTopUfsByVolume(3);
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('GROUP BY ufSigla');
    expect(sql).toContain('ORDER BY SUM(volumeExames) DESC');
    expect(sql).toContain('LIMIT 3');
  });

  it('extrai ufSigla das rows', async () => {
    queryAllMock.mockResolvedValueOnce([{ ufSigla: 'SP' }, { ufSigla: 'RJ' }]);
    const result = await fetchTopUfsByVolume(2);
    expect(result).toEqual(['SP', 'RJ']);
  });
});

describe('fetchMunicipioAggregates', () => {
  it('lê do Parquet consolidado da UF e filtra por faixa', async () => {
    await fetchMunicipioAggregates('SP', { from: '2024-01', to: '2024-12' });
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('uf=SP/part.parquet');
    expect(sql).toContain("WHERE competencia BETWEEN '2024-01' AND '2024-12'");
  });

  it('injeta ufSigla como literal na SELECT', async () => {
    await fetchMunicipioAggregates('RJ', { from: '2024-05', to: '2024-05' });
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain("'RJ' AS ufSigla");
  });

  it('rejeita uf e competência com caracteres fora do whitelist', async () => {
    await expect(
      fetchMunicipioAggregates("A'C", { from: '2024-01', to: '2024-02' }),
    ).rejects.toThrow(/ufSigla/);
    await expect(
      fetchMunicipioAggregates('SP', { from: "2024'01", to: '2024-02' }),
    ).rejects.toThrow(/competencia/);
    expect(queryAllMock).not.toHaveBeenCalled();
  });
});

describe('fetchAnomalyDataset', () => {
  it('lê do parquet consolidado da UF sem filtros quando opcionais omitidos', async () => {
    await fetchAnomalyDataset({ ufSigla: 'SP' });
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('uf=SP/part.parquet');
    expect(sql).not.toContain('WHERE');
  });

  it('aplica pushdown por LOINC e faixa de competências quando fornecidos', async () => {
    await fetchAnomalyDataset({
      loinc: '2160-0',
      range: { from: '2023-01', to: '2024-12' },
      ufSigla: 'SP',
    });
    const sql = queryAllMock.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain("loinc = '2160-0'");
    expect(sql).toContain("competencia BETWEEN '2023-01' AND '2024-12'");
  });

  it('rejeita uf, loinc e competência com caracteres fora do whitelist', async () => {
    await expect(fetchAnomalyDataset({ ufSigla: "A'C" })).rejects.toThrow(/ufSigla/);
    await expect(fetchAnomalyDataset({ loinc: "2160';--", ufSigla: 'SP' })).rejects.toThrow(
      /loinc/,
    );
    await expect(
      fetchAnomalyDataset({ range: { from: "2024'01", to: '2024-12' }, ufSigla: 'SP' }),
    ).rejects.toThrow(/competencia/);
    expect(queryAllMock).not.toHaveBeenCalled();
  });
});
