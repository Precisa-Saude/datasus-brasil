import { UF_TOTALS_PARQUET, ufPartitionUrl } from './data-source';
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
 * Agregado nacional para uma única competência (mês), vindo do Parquet
 * consolidado `uf-totals.parquet`. Um único arquivo pequeno = **um GET**
 * S3 por query, em vez de varrer todas as partições anuais.
 */
export async function fetchUfAggregates(competencia: string): Promise<UfAggregateRow[]> {
  return queryAll<UfAggregateRow>(`
    SELECT competencia, loinc, ufSigla, volumeExames, valorAprovadoBRL
    FROM read_parquet('${UF_TOTALS_PARQUET}')
    WHERE competencia = '${competencia.replace(/'/g, "''")}'
  `);
}

/**
 * Dados municipais de uma UF para uma competência específica. Usa o
 * Parquet consolidado por UF (18 anos num só arquivo); pushdown de
 * filtro por competência via row-group statistics do Parquet evita
 * ler row-groups de outras datas.
 */
export async function fetchMunicipioAggregates(
  ufSigla: string,
  competencia: string,
): Promise<MunicipioAggregateRow[]> {
  const safeUf = ufSigla.replace(/'/g, "''");
  return queryAll<MunicipioAggregateRow>(`
    SELECT
      competencia,
      loinc,
      municipioCode,
      municipioNome,
      '${safeUf}' AS ufSigla,
      volumeExames,
      valorAprovadoBRL
    FROM read_parquet('${ufPartitionUrl(ufSigla)}')
    WHERE competencia = '${competencia.replace(/'/g, "''")}'
  `);
}
