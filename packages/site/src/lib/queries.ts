import { PARQUET_GLOB } from './data-source';
import { queryAll } from './duckdb';

export interface UfAggregateRow {
  competencia: string;
  loinc: string;
  ufSigla: string;
  valorAprovadoBRL: number;
  volumeExames: number;
}

export interface MunicipioAggregateRow {
  competencia: string;
  loinc: string;
  municipioCode: string;
  municipioNome: string;
  ufSigla: string;
  valorAprovadoBRL: number;
  volumeExames: number;
}

/**
 * Agrega por UF × LOINC × competência pra uma faixa de anos. Roda no
 * DuckDB WASM: `read_parquet` com `hive_partitioning=1` dá pushdown
 * de partição (filtro `ano BETWEEN` só baixa os Parquets daquela
 * faixa).
 */
export async function fetchUfAggregates(years: readonly number[]): Promise<UfAggregateRow[]> {
  if (years.length === 0) return [];
  const min = Math.min(...years);
  const max = Math.max(...years);
  return queryAll<UfAggregateRow>(`
    SELECT
      competencia,
      loinc,
      ufSigla,
      SUM(volumeExames) AS volumeExames,
      SUM(valorAprovadoBRL) AS valorAprovadoBRL
    FROM read_parquet('${PARQUET_GLOB}', hive_partitioning=1)
    WHERE ano BETWEEN ${min} AND ${max}
    GROUP BY competencia, loinc, ufSigla
  `);
}

/** Todos os registros municipais de uma UF × faixa de anos. */
export async function fetchMunicipioAggregates(
  ufSigla: string,
  years: readonly number[],
): Promise<MunicipioAggregateRow[]> {
  if (years.length === 0) return [];
  const min = Math.min(...years);
  const max = Math.max(...years);
  return queryAll<MunicipioAggregateRow>(`
    SELECT
      competencia,
      loinc,
      municipioCode,
      municipioNome,
      ufSigla,
      volumeExames,
      valorAprovadoBRL
    FROM read_parquet('${PARQUET_GLOB}', hive_partitioning=1)
    WHERE ano BETWEEN ${min} AND ${max} AND uf = '${ufSigla.replace(/'/g, "''")}'
  `);
}
