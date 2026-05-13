import type { CompetenciaRange } from './aggregates';
import type { AnomalyHit, AnomalyKind } from './anomaly';
import { anomaliesUrl, rawSiaPaUrl, UF_TOTALS_PARQUET, ufPartitionUrl } from './data-source';
import { queryAll } from './duckdb';
import sigtapCatalog from './loinc-sigtap-catalog.generated.json';

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
 * Agregado nacional para uma faixa fechada de competências, vindo do
 * Parquet consolidado `uf-totals.parquet`. Um único arquivo pequeno =
 * **um GET** S3 por query, em vez de varrer todas as partições anuais.
 */
export async function fetchUfAggregates(range: CompetenciaRange): Promise<UfAggregateRow[]> {
  assertSafe('competencia', range.from);
  assertSafe('competencia', range.to);
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
    WHERE competencia BETWEEN '${range.from.replace(/'/g, "''")}' AND '${range.to.replace(/'/g, "''")}'
  `);
}

/**
 * Dados municipais de uma UF para uma faixa de competências. Usa o
 * Parquet consolidado por UF (18 anos num só arquivo); pushdown de
 * filtro por competência via row-group statistics do Parquet evita
 * ler row-groups de outras datas.
 */
export async function fetchMunicipioAggregates(
  ufSigla: string,
  range: CompetenciaRange,
): Promise<MunicipioAggregateRow[]> {
  assertSafe('ufSigla', ufSigla);
  assertSafe('competencia', range.from);
  assertSafe('competencia', range.to);
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
    WHERE competencia BETWEEN '${range.from.replace(/'/g, "''")}' AND '${range.to.replace(/'/g, "''")}'
  `);
}

/**
 * Linhas (LOINC × mês) de um município específico, ao longo de todas
 * as competências disponíveis. Alimenta o painel de detalhe; é
 * filtrado por faixa client-side via Falcon-style cube/lookup.
 */
export async function fetchMunicipioDetail(
  ufSigla: string,
  municipioCode: string,
): Promise<MunicipioAggregateRow[]> {
  assertSafe('ufSigla', ufSigla);
  assertSafe('municipioCode', municipioCode);
  const safeUf = ufSigla.replace(/'/g, "''");
  const safeMun = municipioCode.replace(/'/g, "''");
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
    WHERE substr(municipioCode, 1, 6) = substr('${safeMun}', 1, 6)
  `);
}

export interface VolumeByCompetenciaRow {
  competencia: string;
  volumeExames: number;
}

/**
 * Volume nacional total de exames por competência (uma linha por mês).
 * Alimenta o histograma do brush — uma única requisição S3, sem filtro
 * por LOINC/UF, agrupando direto no DuckDB.
 */
export async function fetchVolumeByCompetencia(): Promise<VolumeByCompetenciaRow[]> {
  return queryAll<VolumeByCompetenciaRow>(`
    SELECT
      competencia,
      CAST(SUM(volumeExames) AS DOUBLE) AS volumeExames
    FROM read_parquet('${UF_TOTALS_PARQUET}')
    GROUP BY competencia
    ORDER BY competencia
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

export interface AnomaliesPayload {
  /** ISO timestamp da geração do artefato (referência ao último refresh). */
  generatedAt: string;
  /** Top-N hits já ordenados por score desc, com sort secundário estável. */
  hits: AnomalyHit[];
  /** Detector que gerou esses hits. */
  kind: AnomalyKind;
  /** Cap aplicado (length de `hits`). */
  topN: number;
  /** Quantos hits o detector produziu antes do truncamento — útil pra
   *  contextualizar "300 hits mostrados de 12.847 detectados". */
  totalHitsBeforeCap: number;
}

/**
 * Carrega o artefato pré-computado de atipicidades de um detector.
 *
 * Substitui o ciclo antigo de "puxar 270 MB de parquet × rodar
 * detector em JS na main thread × estourar 1.2 GB de heap". Os
 * arquivos vivem em `site/public/anomalies/{kind}.json`, pré-
 * calculados pelo `scripts/compute-anomalies.ts` no refresh do
 * pipeline. São pequenos (<200 KB cada) e parse é instantâneo.
 *
 * Os hits já vêm ordenados por score (com tiebreak estável). O
 * explorador pagina/filtra client-side em cima dessa lista pequena.
 */
export async function fetchAnomalies(kind: AnomalyKind): Promise<AnomaliesPayload> {
  const res = await fetch(anomaliesUrl(kind));
  if (!res.ok) throw new Error(`Falha ao carregar anomalies/${kind} (${res.status}).`);
  return (await res.json()) as AnomaliesPayload;
}

export interface CnesBreakdownRow {
  cnes: string;
  valorAprovadoBRL: number;
  volumeExames: number;
}

/**
 * Lista os códigos SIGTAP que mapeiam pro LOINC informado. O catálogo
 * é extraído do `@precisa-saude/datasus-sdk` em build-time pelo
 * script `scripts/extract-sigtap-catalog.ts` e committed como JSON
 * estático — o SDK em si não roda no browser (importa basic-ftp/fs).
 * Re-gerar quando o SDK for atualizado.
 */
const CATALOG = sigtapCatalog as Readonly<Record<string, readonly string[]>>;

export function sigtapsForLoinc(loinc: string): string[] {
  const entry = CATALOG[loinc];
  return entry ? [...entry] : [];
}

const SAFE_SIGTAP = /^\d{10}$/;

/**
 * Quebra por estabelecimento (CNES) de uma tupla
 * (município × LOINC × competência), consultando o parquet bruto
 * SIA-PA sob demanda. Não usado pelo agregado do site — disparado
 * pelo usuário ao expandir uma linha do explorador.
 *
 * Implementação favorece UM Range Request por chamada (uma só
 * partição mensal). `PA_VALAPR` já chega em BRL no parquet bruto
 * (o decoder DBF→parquet normaliza antes de escrever — o dicionário
 * oficial do SIA-PA fala em centavos, mas o dado publicado pelo
 * `datasus-parquet` já é decimal). Validado contra SP/2024-01: VHS
 * a R$ 4,11/exame, em linha com a tabela SIGTAP.
 */
export async function fetchCnesBreakdown(params: {
  competencia: string;
  ibgeCode6: string;
  loinc: string;
  ufSigla: string;
}): Promise<CnesBreakdownRow[]> {
  const { competencia, ibgeCode6, loinc, ufSigla } = params;
  assertSafe('ufSigla', ufSigla);
  assertSafe('loinc', loinc);
  assertSafe('competencia', competencia);
  assertSafe('municipioCode', ibgeCode6);
  const sigtaps = sigtapsForLoinc(loinc);
  if (sigtaps.length === 0) return [];
  for (const s of sigtaps) {
    if (!SAFE_SIGTAP.test(s)) {
      throw new Error(`SIGTAP inválido no catálogo para LOINC ${loinc}: "${s}"`);
    }
  }
  const [yearStr, monthStr] = competencia.split('-');
  if (yearStr === undefined || monthStr === undefined) {
    throw new Error(`Competência fora do padrão YYYY-MM: "${competencia}"`);
  }
  const ano = Number(yearStr);
  const mes = Number(monthStr);
  if (!Number.isInteger(ano) || ano < 2008 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error(`Competência fora do padrão YYYY-MM: "${competencia}"`);
  }
  const url = rawSiaPaUrl(ano, ufSigla, mes);
  const safeIbge = ibgeCode6.replace(/'/g, "''").slice(0, 6);
  const sigtapList = sigtaps.map((s) => `'${s}'`).join(', ');
  return queryAll<CnesBreakdownRow>(`
    SELECT
      CAST(PA_CODUNI AS VARCHAR) AS cnes,
      CAST(SUM(TRY_CAST(PA_QTDAPR AS DOUBLE)) AS DOUBLE) AS volumeExames,
      CAST(SUM(TRY_CAST(PA_VALAPR AS DOUBLE)) AS DOUBLE) AS valorAprovadoBRL
    FROM read_parquet('${url}')
    WHERE CAST(PA_UFMUN AS VARCHAR) = '${safeIbge}'
      AND CAST(PA_PROC_ID AS VARCHAR) IN (${sigtapList})
    GROUP BY 1
    ORDER BY volumeExames DESC
  `);
}

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
