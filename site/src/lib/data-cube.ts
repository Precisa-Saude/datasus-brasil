/**
 * Cubos de prefix-sum para cross-filtering instantâneo do brush de
 * competência.
 *
 * Inspirado em **Falcon** (Moritz et al., CHI 2019, "Falcon: Balancing
 * Interactive Latency and Resolution Sensitivity for Scalable Linked
 * Visualizations" — https://idl.cs.washington.edu/papers/falcon/).
 *
 * O brush sobre meses é a *active view*; o mapa coroplético e a tabela
 * de UFs/municípios são *passive views*. Ao entrar num escopo (Brasil
 * ou UF selecionada), pré-computamos um cubo `[N+1][numBins]` (Float64)
 * onde `cube[i][b] = Σ volume(meses 0..i-1, bin b)`. Cada movimento do
 * brush vira `cube[toIdx+1] - cube[fromIdx]` — uma subtração de
 * Float64Array por bin, sem ida ao DuckDB.
 *
 * Equivalentes na codebase do Falcon:
 *   - `src/db/sql.ts` linhas 160–277 (`cubeSlice1D`): SQL `GROUP BY
 *     keyActive, key` + prefix-sum.
 *   - `src/app.ts` linhas 818–848 (`valueFor1D` / `histFor1D`): a
 *     subtração `cube[hi] - cube[lo]` em runtime.
 *
 * Diferenças:
 *   - Falcon agrega `count(*)`; a gente agrega `SUM(volume)` e
 *     `SUM(valor)` (parquet já agregado por LOINC × UF × mês).
 *   - Eles usam `Float32Array` no cubo. Volumes laboratoriais nacionais
 *     chegam à casa dos bilhões num intervalo grande, o que estoura a
 *     mantissa de 24 bits do float32 (resolução começa a falhar acima
 *     de 16M). Usamos `Float64Array`.
 *   - Falcon resolve a active dim em pixels (suaviza o brush sub-bin);
 *     o nosso brush snapeia em mês inteiro, então N (número de meses)
 *     é a resolução nativa — sem necessidade de pixel binning.
 */

import type { CompetenciaRange } from './aggregates';
import { UF_TOTALS_PARQUET, ufPartitionUrl } from './data-source';
import { queryAll } from './duckdb';

/**
 * Cubo de prefix-sum sobre um conjunto de bins (UFs ou municípios) ao
 * longo das competências disponíveis.
 *
 * `volume` e `valor` são `Float64Array` achatados em row-major:
 * `cube[i * numBins + b]`. `i ∈ [0..N]`; `cube[0]` é zero (linha
 * sentinela que torna `cube[from]` válido inclusive quando from=0).
 */
export interface DataCube {
  /** Rótulo legível em paralelo a `bins` (sigla pra UF, nome pra município). */
  binLabels: string[];
  /** Identificadores dos bins (ufSigla ou municipioCode). */
  bins: string[];
  /** Lista ordenada das competências (`YYYY-MM`). N = `competencias.length`. */
  competencias: string[];
  /** Idem para `valorAprovadoBRL`. */
  valor: Float64Array;
  /** `(N+1) × numBins` em row-major, prefix-sum acumulado. */
  volume: Float64Array;
}

export interface BinTotals {
  bin: string;
  label: string;
  valor: number;
  volume: number;
}

/**
 * Soma `[from, to]` (inclusive) por bin via subtração de prefix-sums.
 *
 * Cf. Falcon `histFor1D` em `src/app.ts:832-848` —
 * `sub(hists.pick(hi, null), hists.pick(lo, null))`.
 *
 * O custo é `O(numBins)` operações Float64 — para 27 UFs, ~54 FLOPs
 * por chamada, sub-milissegundo mesmo a 60fps.
 */
export function lookupRange(
  cube: DataCube,
  range: CompetenciaRange,
): { byBin: Map<string, BinTotals>; max: number } {
  const numBins = cube.bins.length;
  const fromIdx = Math.max(0, cube.competencias.indexOf(range.from));
  const toIdx = Math.max(fromIdx, cube.competencias.indexOf(range.to));
  // Linha sentinela em 0 → `cube[from]` é a soma estritamente *antes*
  // de from (ou zero quando from=0). `cube[to+1]` inclui o mês `to`.
  const lo = fromIdx;
  const hi = toIdx + 1;
  const byBin = new Map<string, BinTotals>();
  let max = 0;
  for (let b = 0; b < numBins; b += 1) {
    const v = (cube.volume[hi * numBins + b] ?? 0) - (cube.volume[lo * numBins + b] ?? 0);
    if (v <= 0) continue;
    const $ = (cube.valor[hi * numBins + b] ?? 0) - (cube.valor[lo * numBins + b] ?? 0);
    const id = cube.bins[b] as string;
    const label = cube.binLabels[b] as string;
    byBin.set(id, { bin: id, label, valor: $, volume: v });
    if (v > max) max = v;
  }
  return { byBin, max };
}

/**
 * Constrói o cubo nacional (volume/valor por UF × mês). Equivalente
 * ao `cubeSlice1D` do Falcon (`src/db/sql.ts:202-208`), mas com
 * SUM(volume) em vez de count(*), e a active dim já em mês (sem pixel
 * bucket).
 */
export async function buildUfCube(competencias: string[]): Promise<DataCube> {
  const rows = await queryAll<{ competencia: string; ufSigla: string; vol: number; val: number }>(`
    SELECT
      competencia,
      ufSigla,
      CAST(SUM(volumeExames) AS DOUBLE) AS vol,
      CAST(SUM(valorAprovadoBRL) AS DOUBLE) AS val
    FROM read_parquet('${UF_TOTALS_PARQUET}')
    GROUP BY competencia, ufSigla
  `);
  const ufs = [...new Set(rows.map((r) => r.ufSigla))].sort();
  return assembleCube(competencias, ufs, ufs, rows, (r) => r.ufSigla);
}

/**
 * Constrói o cubo municipal de uma UF (volume/valor por município ×
 * mês). Mesma estratégia, escopo restrito ao parquet consolidado da UF.
 */
export async function buildMunicipioCube(
  ufSigla: string,
  competencias: string[],
): Promise<DataCube> {
  if (!/^[A-Z]{2}$/.test(ufSigla)) {
    throw new Error(`UF inválida: ${ufSigla}`);
  }
  const rows = await queryAll<{
    competencia: string;
    municipioCode: string;
    municipioNome: string;
    vol: number;
    val: number;
  }>(`
    SELECT
      competencia,
      municipioCode,
      ANY_VALUE(municipioNome) AS municipioNome,
      CAST(SUM(volumeExames) AS DOUBLE) AS vol,
      CAST(SUM(valorAprovadoBRL) AS DOUBLE) AS val
    FROM read_parquet('${ufPartitionUrl(ufSigla)}')
    GROUP BY competencia, municipioCode
  `);
  const nomeByCode = new Map<string, string>();
  for (const r of rows) {
    if (!nomeByCode.has(r.municipioCode)) nomeByCode.set(r.municipioCode, r.municipioNome);
  }
  const codes = [...nomeByCode.keys()].sort();
  const labels = codes.map((c) => nomeByCode.get(c) ?? c);
  return assembleCube(competencias, codes, labels, rows, (r) => r.municipioCode);
}

/**
 * Pivota linhas `(competencia, bin) → (vol, val)` num par de
 * Float64Arrays e aplica prefix-sum ao longo do eixo de competências.
 *
 * Cf. Falcon `prefixSum` em `src/db/sql.ts:256-259` — eles aplicam por
 * coluna do passive bin; aqui o layout é row-major em (i, b) e a soma
 * acumula para `i+1`.
 */
function assembleCube<R extends { competencia: string; val: number; vol: number }>(
  competencias: string[],
  bins: string[],
  binLabels: string[],
  rows: R[],
  binOf: (r: R) => string,
): DataCube {
  const N = competencias.length;
  const numBins = bins.length;
  const compIdx = new Map(competencias.map((c, i) => [c, i]));
  const binIdx = new Map(bins.map((b, i) => [b, i]));

  const volume = new Float64Array((N + 1) * numBins);
  const valor = new Float64Array((N + 1) * numBins);

  for (const r of rows) {
    const i = compIdx.get(r.competencia);
    const b = binIdx.get(binOf(r));
    if (i === undefined || b === undefined) continue;
    // Coloca a contribuição no slot `i+1` antes do prefix-sum, deixando
    // a linha 0 zerada como sentinela.
    volume[(i + 1) * numBins + b] = r.vol;
    valor[(i + 1) * numBins + b] = r.val;
  }

  // Prefix-sum ao longo do eixo de competências (row i inclui rows 0..i).
  for (let i = 1; i <= N; i += 1) {
    const dst = i * numBins;
    const prev = (i - 1) * numBins;
    for (let b = 0; b < numBins; b += 1) {
      volume[dst + b] = (volume[dst + b] ?? 0) + (volume[prev + b] ?? 0);
      valor[dst + b] = (valor[dst + b] ?? 0) + (valor[prev + b] ?? 0);
    }
  }

  return { binLabels, bins, competencias, valor, volume };
}
