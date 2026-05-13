#!/usr/bin/env tsx
/**
 * Pré-computa as quatro famílias de atipicidades do explorador
 * (`spike`, `concentration`, `per-capita`, `price-ratio`) sobre os
 * agregados municipais publicados em `parquet-opt/uf=XX/part.parquet`,
 * e escreve um JSON por família em `site/public/anomalies/`.
 *
 * Motivação: rodar os detectores no client significava puxar ~270 MB
 * de parquet, materializar ~1M de linhas em heap JS, processar
 * sincronamente na main thread e travar a UI (~1.2 GB de memória no
 * tab, lag perceptível só ao hover). Os detectores são puros, os
 * parâmetros são fixos e os hits totais cabem em ~1 MB — pré-computar
 * uma vez por refresh resolve tudo isso.
 *
 * Uso:
 *
 *   pnpm -F @datasus-viz/site exec tsx scripts/compute-anomalies.ts
 *
 * Lê o parquet-opt diretamente do CDN público — não precisa ter
 * artefatos locais. Os JSONs gerados ficam committed no repo
 * (regenerados a cada refresh via `refresh.yml`).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import duckdb from 'duckdb';

import type { AnomalyHit, AnomalyRow, PopulationLookup } from '../src/lib/anomaly.ts';
import {
  detectConcentration,
  detectPerCapitaOutliers,
  detectPriceRatioOutliers,
  detectTemporalSpikes,
} from '../src/lib/anomaly.ts';

const DEFAULT_SOURCE_URL = 'https://dfdu08vi8wsus.cloudfront.net';

/**
 * Cap de hits persistidos por detector. Os detectores rodam sobre
 * ~20M de linhas e podem produzir centenas de milhares de hits a
 * scores baixos — JSON.stringify de tudo estoura o limite de string
 * do V8 (~512 MB). 5k é uma profundidade confortável pro usuário
 * paginar/filtrar sem cair pra hits triviais; mantém o artefato em
 * ~1.5 MB por detector (gzip cai pra ~300 KB).
 */
const TOP_N_HITS = 5000;

const ALL_UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
];

interface PopulationData {
  coverageYears: number[];
  generatedAt: string;
  population: Record<string, Record<string, number>>;
  source: string;
}

function buildPopulationLookup(data: PopulationData): PopulationLookup {
  const coverageYears = [...data.coverageYears].sort((a, b) => a - b);
  return (municipioCode, year) => {
    const byYear = data.population[municipioCode];
    if (!byYear) return undefined;
    const yk = String(year);
    if (byYear[yk] !== undefined) return byYear[yk];
    // Fallback: ano mais próximo dentro da cobertura — mesma regra
    // do `lib/population.ts` no browser. Mantém o sinal de per-capita
    // útil mesmo nos buracos da SIDRA (2007, 2010, 2022, 2023).
    let best: number | undefined;
    let bestDist = Infinity;
    for (const y of coverageYears) {
      const v = byYear[String(y)];
      if (v === undefined) continue;
      const d = Math.abs(y - year);
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    return best;
  };
}

function runQuery<T = Record<string, unknown>>(db: duckdb.Database, sql: string): Promise<T[]> {
  return new Promise((res, rej) => {
    db.all(sql, (err, rows) => (err ? rej(err) : res((rows ?? []) as T[])));
  });
}

async function loadAllRows(sourceUrl: string): Promise<AnomalyRow[]> {
  const db = new duckdb.Database(':memory:');
  await runQuery(db, 'LOAD httpfs;');
  const all: AnomalyRow[] = [];
  for (const uf of ALL_UFS) {
    const url = `${sourceUrl}/parquet-opt/uf=${uf}/part.parquet`;
    process.stderr.write(`  · ${uf} `);
    const t0 = Date.now();
    const rows = await runQuery<AnomalyRow>(
      db,
      `SELECT
         CAST(competencia AS VARCHAR) AS competencia,
         CAST(loinc AS VARCHAR) AS loinc,
         CAST(municipioCode AS VARCHAR) AS municipioCode,
         CAST(municipioNome AS VARCHAR) AS municipioNome,
         '${uf}' AS ufSigla,
         CAST(volumeExames AS DOUBLE) AS volumeExames,
         CAST(valorAprovadoBRL AS DOUBLE) AS valorAprovadoBRL
       FROM read_parquet('${url}')`,
    );
    // `.push(...rows)` estoura o stack quando rows > ~100k (spread vira
    // argumentos). Iterar é seguro e tem custo desprezível aqui.
    for (const r of rows) all.push(r);
    process.stderr.write(`(${rows.length} rows, ${Date.now() - t0}ms)\n`);
  }
  return new Promise((res, rej) => db.close((err) => (err ? rej(err) : res(all))));
}

interface AnomalyOutput {
  /** ISO timestamp da geração. */
  generatedAt: string;
  /** Top-N hits ordenados por score (desc). */
  hits: AnomalyHit[];
  /** Identificador do detector. */
  kind: string;
  /** Parâmetros default (sem tuning). Sinaliza no artefato pra
   *  futura UI de "parâmetros usados" se quiser expor. */
  paramsDefault: true;
  /** Cap aplicado — quantos hits estão no array `hits`. */
  topN: number;
  /** Quantos hits brutos o detector produziu antes do truncamento. */
  totalHitsBeforeCap: number;
}

function writeOutput(outPath: string, kind: string, hits: AnomalyHit[], topN: number): void {
  mkdirSync(dirname(outPath), { recursive: true });
  const truncated = hits.slice(0, topN);
  const payload: AnomalyOutput = {
    generatedAt: new Date().toISOString(),
    hits: truncated,
    kind,
    paramsDefault: true,
    topN: truncated.length,
    totalHitsBeforeCap: hits.length,
  };
  writeFileSync(outPath, `${JSON.stringify(payload)}\n`, 'utf-8');
  process.stderr.write(
    `  ✓ ${outPath} (${truncated.length}/${hits.length.toLocaleString('pt-BR')} hits, ${formatBytes(outPath)})\n`,
  );
}

function formatBytes(path: string): string {
  const bytes = readFileSync(path).byteLength;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main(): Promise<void> {
  const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const sourceUrl = process.env['DATA_SOURCE_URL'] ?? DEFAULT_SOURCE_URL;
  const outDir = resolve(siteRoot, 'public/anomalies');

  process.stderr.write(`Lendo parquet-opt de ${sourceUrl} (27 UFs)...\n`);
  const t0 = Date.now();
  const rows = await loadAllRows(sourceUrl);
  process.stderr.write(
    `Total: ${rows.length.toLocaleString('pt-BR')} linhas em ${((Date.now() - t0) / 1000).toFixed(1)}s\n\n`,
  );

  process.stderr.write('Computando detectores...\n');
  const tD = Date.now();
  const spikeAll = detectTemporalSpikes(rows);
  const concentrationAll = detectConcentration(rows);
  const priceRatioAll = detectPriceRatioOutliers(rows);

  // Per-capita exige a base IBGE — lê o JSON já committed.
  const popPath = resolve(siteRoot, 'public/data/populacao.json');
  const popData = JSON.parse(readFileSync(popPath, 'utf-8')) as PopulationData;
  const pop = buildPopulationLookup(popData);
  const perCapitaAll = detectPerCapitaOutliers(rows, pop);
  process.stderr.write(`Detectores rodaram em ${((Date.now() - tD) / 1000).toFixed(1)}s\n`);
  process.stderr.write(
    `  hits brutos: spike=${spikeAll.length.toLocaleString('pt-BR')}, ` +
      `concentration=${concentrationAll.length.toLocaleString('pt-BR')}, ` +
      `price-ratio=${priceRatioAll.length.toLocaleString('pt-BR')}, ` +
      `per-capita=${perCapitaAll.length.toLocaleString('pt-BR')}\n\n`,
  );

  process.stderr.write(`Escrevendo artefatos (top ${TOP_N_HITS} por detector)...\n`);
  writeOutput(resolve(outDir, 'spike.json'), 'spike', spikeAll, TOP_N_HITS);
  writeOutput(resolve(outDir, 'concentration.json'), 'concentration', concentrationAll, TOP_N_HITS);
  writeOutput(resolve(outDir, 'price-ratio.json'), 'price-ratio', priceRatioAll, TOP_N_HITS);
  writeOutput(resolve(outDir, 'per-capita.json'), 'per-capita', perCapitaAll, TOP_N_HITS);

  process.stderr.write(`\n✓ Tudo em ${outDir}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `\n✗ Erro: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
