import { UF_TOTALS_PARQUET, ufPartitionUrl } from './data-source';
import { queryAll } from './duckdb';

/**
 * Defesa em profundidade contra SQL injection. Os valores que entram
 * nas queries (LOINC, UF, competência) sempre vêm do manifest público
 * ou de search params validados contra ele, mas a função a seguir
 * garante que mesmo se algo escapar do whitelist o conteúdo só pode
 * conter caracteres alfanuméricos + dash/underscore/dot.
 *
 * Em adição, todas as queries fazem escape de aspas via `.replace(/'/g, "''")`
 * — duplo zero-trust.
 */
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.-]+$/;
function assertSafe(label: string, value: string): void {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `Valor inválido para ${label}: "${value}". Esperado: alfanumérico, "-", "_" ou ".".`,
    );
  }
}

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
  assertSafe('competencia', competencia);
  // CAST para DOUBLE evita BigInt no cliente — int64 vira BigInt no
  // DuckDB WASM por default, o que quebra `Math.max(...numbers)`.
  return queryAll<UfAggregateRow>(`
    SELECT
      competencia,
      loinc,
      ufSigla,
      CAST(volumeExames AS DOUBLE) AS volumeExames,
      CAST(valorAprovadoBRL AS DOUBLE) AS valorAprovadoBRL
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
  assertSafe('ufSigla', ufSigla);
  assertSafe('competencia', competencia);
  const safeUf = ufSigla.replace(/'/g, "''");
  return queryAll<MunicipioAggregateRow>(`
    SELECT
      competencia,
      loinc,
      municipioCode,
      municipioNome,
      '${safeUf}' AS ufSigla,
      CAST(volumeExames AS DOUBLE) AS volumeExames,
      CAST(valorAprovadoBRL AS DOUBLE) AS valorAprovadoBRL
    FROM read_parquet('${ufPartitionUrl(ufSigla)}')
    WHERE competencia = '${competencia.replace(/'/g, "''")}'
  `);
}

export interface TrendPoint {
  competencia: string;
  /** Identificador da série — LOINC ou UF, conforme o modo da consulta. */
  seriesId: string;
  valorAprovadoBRL: number;
  volumeExames: number;
}

/**
 * Série temporal de um ou mais LOINCs ao longo de todas as
 * competências, para sobreposição/comparação no gráfico.
 *
 * Quando `ufSigla` é `null`, soma todas as UFs (visão nacional);
 * quando informado, retorna apenas a UF pedida. Sempre lê o
 * `uf-totals.parquet` consolidado — uma única requisição S3
 * independente do número de LOINCs (pushdown via filtro `IN`).
 */
export async function fetchTrend(loincs: string[], ufSigla: null | string): Promise<TrendPoint[]> {
  if (loincs.length === 0) return [];
  for (const l of loincs) assertSafe('loinc', l);
  if (ufSigla !== null) assertSafe('ufSigla', ufSigla);
  const safeLoincs = loincs.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ');
  const ufFilter = ufSigla === null ? '' : `AND ufSigla = '${ufSigla.replace(/'/g, "''")}'`;
  return queryAll<TrendPoint>(`
    SELECT
      competencia,
      loinc AS seriesId,
      CAST(SUM(volumeExames) AS DOUBLE) AS volumeExames,
      CAST(SUM(valorAprovadoBRL) AS DOUBLE) AS valorAprovadoBRL
    FROM read_parquet('${UF_TOTALS_PARQUET}')
    WHERE loinc IN (${safeLoincs})
    ${ufFilter}
    GROUP BY competencia, loinc
    ORDER BY competencia
  `);
}

/**
 * Top-N LOINCs por volume total acumulado (todas as UFs, todas as
 * competências). Usado para semear defaults de UI sem cair em ordem
 * alfabética. Lê o consolidado `uf-totals.parquet` — uma única
 * requisição.
 */
export async function fetchTopLoincsByVolume(n: number): Promise<string[]> {
  if (n <= 0) return [];
  const rows = await queryAll<{ loinc: string }>(`
    SELECT loinc
    FROM read_parquet('${UF_TOTALS_PARQUET}')
    GROUP BY loinc
    ORDER BY SUM(volumeExames) DESC
    LIMIT ${Math.floor(n)}
  `);
  return rows.map((r) => r.loinc);
}

/**
 * Top-N UFs por volume total acumulado. Usado para semear defaults
 * de UI no modo "comparar UFs".
 */
export async function fetchTopUfsByVolume(n: number): Promise<string[]> {
  if (n <= 0) return [];
  const rows = await queryAll<{ ufSigla: string }>(`
    SELECT ufSigla
    FROM read_parquet('${UF_TOTALS_PARQUET}')
    GROUP BY ufSigla
    ORDER BY SUM(volumeExames) DESC
    LIMIT ${Math.floor(n)}
  `);
  return rows.map((r) => r.ufSigla);
}

/**
 * Série temporal de um único LOINC quebrado por UF — uma série
 * por UF para comparação geográfica. Mesma fonte (`uf-totals.parquet`),
 * uma única requisição.
 */
export async function fetchTrendByUf(loinc: string, ufSiglas: string[]): Promise<TrendPoint[]> {
  if (ufSiglas.length === 0) return [];
  assertSafe('loinc', loinc);
  for (const u of ufSiglas) assertSafe('ufSigla', u);
  const safeLoinc = loinc.replace(/'/g, "''");
  const safeUfs = ufSiglas.map((u) => `'${u.replace(/'/g, "''")}'`).join(', ');
  return queryAll<TrendPoint>(`
    SELECT
      competencia,
      ufSigla AS seriesId,
      CAST(volumeExames AS DOUBLE) AS volumeExames,
      CAST(valorAprovadoBRL AS DOUBLE) AS valorAprovadoBRL
    FROM read_parquet('${UF_TOTALS_PARQUET}')
    WHERE loinc = '${safeLoinc}' AND ufSigla IN (${safeUfs})
    ORDER BY competencia
  `);
}
