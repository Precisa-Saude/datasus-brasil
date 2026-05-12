/**
 * Detectores de "datapoints atípicos" sobre os agregados SIA-PA.
 *
 * Funções puras, sem dependência de React/DuckDB — toda I/O fica no
 * lado da `queries.ts`. Cada detector recebe linhas já materializadas
 * e devolve um array ordenado de `AnomalyHit` por score decrescente.
 *
 * Quatro heurísticas independentes, toggleáveis na UI:
 * - spike temporal (z-score sobre janela rolante)
 * - per-capita (volume / população)
 * - concentração (share do total nacional/UF do par LOINC × competência)
 * - razão preço/volume (BRL/exame vs mediana nacional por LOINC × ano)
 */

export type AnomalyKind = 'concentration' | 'per-capita' | 'price-ratio' | 'spike';

export interface AnomalyRow {
  competencia: string;
  loinc: string;
  municipioCode: string;
  municipioNome: string;
  ufSigla: string;
  valorAprovadoBRL: number;
  volumeExames: number;
}

export interface AnomalyHit {
  baseline: number;
  competencia: string;
  /** Detalhes calculados pelo detector (z, share, ratio, per1k…). */
  details: Record<string, number>;
  kind: AnomalyKind;
  loinc: string;
  municipioCode: string;
  municipioNome: string;
  observed: number;
  /** Score para ranquear hits — sempre comparável dentro do mesmo `kind`. */
  score: number;
  ufSigla: string;
}

function keyFor(row: Pick<AnomalyRow, 'loinc' | 'municipioCode'>): string {
  return `${row.municipioCode}::${row.loinc}`;
}

/**
 * Bucket multiplicativo do score — escolhe granularidade proporcional
 * ao módulo do valor, agrupando scores que estão dentro de ~10% um do
 * outro num mesmo "balde". Ex.: 10,5 e 10,8 caem no balde 10; 15 e 14
 * também; já 15 e 25 vão pra baldes distintos. Sem isso, scores quase
 * idênticos (R$/exame variando centavos entre meses) ficavam cada um
 * num bucket próprio e os tiebreakers (município/competência) nunca
 * disparavam.
 */
function scoreBucket(score: number): number {
  if (!Number.isFinite(score) || score === 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(score))));
  return Math.round(score / magnitude) * magnitude;
}

/**
 * Ordenação canônica de hits:
 *   1. bucket de score (1 sig fig) desc — outliers mais fortes no
 *      topo, mas variações pequenas entre meses ficam empacotadas,
 *   2. município asc (collation pt-BR) — agrupa todas as competências
 *      do mesmo município lado a lado,
 *   3. LOINC asc — dentro de um município, ordena por exame,
 *   4. competência desc — meses mais recentes primeiro dentro do
 *      mesmo (município, exame).
 */
function sortHits(hits: AnomalyHit[]): void {
  hits.sort((a, b) => {
    const bucketA = scoreBucket(a.score);
    const bucketB = scoreBucket(b.score);
    if (bucketA !== bucketB) return bucketB - bucketA;
    if (a.municipioNome !== b.municipioNome)
      return a.municipioNome.localeCompare(b.municipioNome, 'pt-BR');
    if (a.loinc !== b.loinc) return a.loinc.localeCompare(b.loinc);
    return b.competencia.localeCompare(a.competencia);
  });
}

/**
 * Z-score sobre janela rolante por (município, LOINC). O ponto atual
 * NÃO entra no cálculo do baseline — evita que um spike "se anteveja"
 * e suavize o próprio z-score.
 *
 * Flag aplicado quando:
 * - baseline tem ≥ `minBaseline` observações distintas e não-zero,
 * - std da janela > 0 (séries constantes geram z indefinido),
 * - |z| ≥ `threshold`.
 */
export interface SpikeOptions {
  /** Mínimo de pontos não-zero na janela pra produzir flag. Default: 6. */
  minBaseline?: number;
  /** |z| mínimo pra ser considerado spike. Default: 3.0. */
  threshold?: number;
  /** Tamanho da janela rolante em meses. Default: 12. */
  window?: number;
}

export function detectTemporalSpikes(rows: AnomalyRow[], options: SpikeOptions = {}): AnomalyHit[] {
  const window = options.window ?? 12;
  const threshold = options.threshold ?? 3.0;
  const minBaseline = options.minBaseline ?? 6;

  // Agrupa por (município, LOINC) e ordena cada grupo por competência.
  const groups = new Map<string, AnomalyRow[]>();
  for (const r of rows) {
    const k = keyFor(r);
    const arr = groups.get(k);
    if (arr) arr.push(r);
    else groups.set(k, [r]);
  }

  const hits: AnomalyHit[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.competencia.localeCompare(b.competencia));
    for (let i = 0; i < group.length; i++) {
      const start = Math.max(0, i - window);
      const baselineSlice = group.slice(start, i);
      const baseline = baselineSlice.filter((r) => r.volumeExames > 0);
      if (baseline.length < minBaseline) continue;
      const mean = baseline.reduce((s, r) => s + r.volumeExames, 0) / baseline.length;
      const variance =
        baseline.reduce((s, r) => s + (r.volumeExames - mean) ** 2, 0) / baseline.length;
      const std = Math.sqrt(variance);
      if (std === 0) continue;
      const row = group[i]!;
      const z = (row.volumeExames - mean) / std;
      if (Math.abs(z) < threshold) continue;
      hits.push({
        baseline: mean,
        competencia: row.competencia,
        details: { baselineN: baseline.length, std, z },
        kind: 'spike',
        loinc: row.loinc,
        municipioCode: row.municipioCode,
        municipioNome: row.municipioNome,
        observed: row.volumeExames,
        score: Math.abs(z),
        ufSigla: row.ufSigla,
      });
    }
  }
  sortHits(hits);
  return hits;
}

export interface PerCapitaOptions {
  /**
   * Limite máximo de população para um município ser considerado
   * "pequeno". Default: 50000 — abaixo disso volumes desproporcionais
   * costumam refletir comportamento atípico, não escala demográfica.
   */
  maxPop?: number;
  /** Mínimo de exames por 1k habitantes pra entrar no rank. Default: 50. */
  minPer1k?: number;
  /**
   * População mínima — descarta micro-municípios onde 1 exame vira
   * taxa enorme. Default: 5000.
   */
  minPop?: number;
}

export type PopulationLookup = (municipioCode: string, year: number) => number | undefined;

/**
 * Per-capita: volume mensal × 1000 / população do ano da competência.
 * Ranqueia exclusivamente municípios pequenos (≤ `maxPop`) — o sinal
 * de interesse é "cidadezinha com exame demais", não as capitais.
 */
export function detectPerCapitaOutliers(
  rows: AnomalyRow[],
  pop: PopulationLookup,
  options: PerCapitaOptions = {},
): AnomalyHit[] {
  const minPop = options.minPop ?? 5000;
  const maxPop = options.maxPop ?? 50000;
  const minPer1k = options.minPer1k ?? 50;
  const hits: AnomalyHit[] = [];
  for (const r of rows) {
    const year = Number(r.competencia.slice(0, 4));
    if (!Number.isFinite(year)) continue;
    const population = pop(r.municipioCode, year);
    if (population === undefined) continue;
    if (population < minPop || population > maxPop) continue;
    const per1k = (r.volumeExames * 1000) / population;
    if (per1k < minPer1k) continue;
    hits.push({
      baseline: minPer1k,
      competencia: r.competencia,
      details: { per1k, population },
      kind: 'per-capita',
      loinc: r.loinc,
      municipioCode: r.municipioCode,
      municipioNome: r.municipioNome,
      observed: r.volumeExames,
      score: per1k,
      ufSigla: r.ufSigla,
    });
  }
  sortHits(hits);
  return hits;
}

export interface ConcentrationOptions {
  /**
   * Volume total mínimo no par (LOINC, competência) — evita flag em
   * exames raros onde 10 exames já são 50%. Default: 500.
   */
  minTotal?: number;
  /** Share mínimo (0–1) pra flag. Default: 0.20 (20% do total LOINC×competência). */
  threshold?: number;
}

/**
 * Concentração: a fração do par (LOINC, competência) que cada
 * município responde. Útil pra detectar centros de referência
 * absorvendo a maior parte de exames de uma região.
 */
export function detectConcentration(
  rows: AnomalyRow[],
  options: ConcentrationOptions = {},
): AnomalyHit[] {
  const threshold = options.threshold ?? 0.2;
  const minTotal = options.minTotal ?? 500;
  const totals = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.loinc}::${r.competencia}`;
    totals.set(k, (totals.get(k) ?? 0) + r.volumeExames);
  }
  const hits: AnomalyHit[] = [];
  for (const r of rows) {
    const k = `${r.loinc}::${r.competencia}`;
    const total = totals.get(k) ?? 0;
    if (total < minTotal) continue;
    const share = r.volumeExames / total;
    if (share < threshold) continue;
    hits.push({
      baseline: total,
      competencia: r.competencia,
      details: { groupTotal: total, share },
      kind: 'concentration',
      loinc: r.loinc,
      municipioCode: r.municipioCode,
      municipioNome: r.municipioNome,
      observed: r.volumeExames,
      score: share,
      ufSigla: r.ufSigla,
    });
  }
  sortHits(hits);
  return hits;
}

export interface PriceRatioOptions {
  /** Multiplicador IQR. Default: 3.0. */
  k?: number;
  /**
   * Desvio absoluto mínimo (mesma unidade que `valorAprovadoBRL` /
   * `volumeExames`, ou seja BRL/exame) entre observado e mediana.
   * Default: 1.0 BRL. Combinado com `minRelativeDeviation` garante que
   * a UI nunca renderize hits onde observado e mediana arredondam pro
   * mesmo valor (NF_INT). R$ 1,60 vs R$ 2,40 passaria 30% relativo
   * mas ambos viram "R$ 2" — sem sinal pro usuário.
   */
  minAbsoluteDeviation?: number;
  /**
   * Desvio relativo mínimo em relação à mediana pra entrar no rank.
   * Default: 0.5 (50%). Garante que o município flagado está
   * claramente fora da banda — não é só ruído em distribuição
   * apertada.
   */
  minRelativeDeviation?: number;
  /** Volume mínimo no município pra entrar no rank. Default: 30. */
  minVolume?: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * BRL/exame vs mediana nacional do mesmo par (LOINC, ano). Flag
 * quando o ratio cai fora de `[q1 - k·IQR, q3 + k·IQR]` na distribuição
 * nacional do par. Score = |ratio - mediana| / IQR.
 */
export function detectPriceRatioOutliers(
  rows: AnomalyRow[],
  options: PriceRatioOptions = {},
): AnomalyHit[] {
  const k = options.k ?? 3.0;
  const minVolume = options.minVolume ?? 30;
  const minRelativeDeviation = options.minRelativeDeviation ?? 0.5;
  const minAbsoluteDeviation = options.minAbsoluteDeviation ?? 1.0;

  // Agrupa ratios por (LOINC, ano).
  const ratiosByGroup = new Map<string, number[]>();
  for (const r of rows) {
    if (r.volumeExames < minVolume) continue;
    const year = r.competencia.slice(0, 4);
    const key = `${r.loinc}::${year}`;
    const ratio = r.valorAprovadoBRL / r.volumeExames;
    const arr = ratiosByGroup.get(key);
    if (arr) arr.push(ratio);
    else ratiosByGroup.set(key, [ratio]);
  }

  const stats = new Map<string, { hi: number; iqr: number; lo: number; median: number }>();
  for (const [key, arr] of ratiosByGroup) {
    if (arr.length < 5) continue;
    const sorted = [...arr].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const median = quantile(sorted, 0.5);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    if (iqr === 0) continue;
    stats.set(key, { hi: q3 + k * iqr, iqr, lo: q1 - k * iqr, median });
  }

  const hits: AnomalyHit[] = [];
  for (const r of rows) {
    if (r.volumeExames < minVolume) continue;
    const year = r.competencia.slice(0, 4);
    const key = `${r.loinc}::${year}`;
    const s = stats.get(key);
    if (!s) continue;
    const ratio = r.valorAprovadoBRL / r.volumeExames;
    if (ratio >= s.lo && ratio <= s.hi) continue;
    const absDiff = Math.abs(ratio - s.median);
    if (absDiff < minAbsoluteDeviation) continue;
    // Desvio relativo: protege contra distribuições muito apertadas
    // onde o IQR é cents e qualquer ruído estoura.
    if (s.median > 0 && absDiff / s.median < minRelativeDeviation) continue;
    hits.push({
      baseline: s.median,
      competencia: r.competencia,
      details: { iqr: s.iqr, median: s.median, ratio },
      kind: 'price-ratio',
      loinc: r.loinc,
      municipioCode: r.municipioCode,
      municipioNome: r.municipioNome,
      observed: ratio,
      score: Math.abs(ratio - s.median) / s.iqr,
      ufSigla: r.ufSigla,
    });
  }
  sortHits(hits);
  return hits;
}
