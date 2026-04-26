#!/usr/bin/env tsx
/**
 * Agregador SIA-PA → Parquet particionado em Hive-style
 * (`ano=YYYY/uf=XX/mes=MM/part.parquet`). Consome o **raw Parquet
 * público** publicado por `datasus-parquet` via HTTPS — não toca o FTP
 * DATASUS nem cache local.
 *
 * Pipeline:
 *   1. Para cada (uf, year, month), constrói URL do raw parquet
 *      em `https://<RAW_BASE_URL>/sia-pa/ano=YYYY/uf=XX/mes=MM/part.parquet`.
 *   2. DuckDB native lê o parquet remoto via httpfs, filtra SIGTAP
 *      02.02, agrega por (município, SIGTAP).
 *   3. JS traduz SIGTAP → LOINC via `@precisa-saude/datasus-sdk`.
 *   4. Re-agrega por (município, LOINC) — múltiplos SIGTAPs podem
 *      mapear pro mesmo biomarcador.
 *   5. Escreve Parquet agregado local (`build/parquet/...`) pra
 *      consumo posterior pelo `consolidate-parquet.ts`.
 *
 * Uso:
 *   pnpm aggregate -- --ufs AC --years 2024
 *   pnpm aggregate -- --ufs ALL --years 2020-2025
 *   pnpm aggregate -- --source-url https://my-mirror.example.com
 *
 * Se o raw parquet não existir pro mês (ex.: split files MG/RJ/SP 2021+),
 * o HEAD falha com 404 e o mês é pulado silenciosamente.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findMunicipio, sigtapToLoinc } from '@precisa-saude/datasus-sdk';
import duckdb from 'duckdb';

const DEFAULT_SOURCE_URL = 'https://dfdu08vi8wsus.cloudfront.net';

interface Cli {
  force: boolean;
  outDir: string;
  sourceUrl: string;
  ufs: string[];
  years: number[];
}

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

function parseArgs(argv: string[]): Cli {
  const get = (flag: string, fallback: string): string => {
    const idx = argv.indexOf(flag);
    if (idx === -1) return fallback;
    const value = argv[idx + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Valor ausente para ${flag}`);
    }
    return value;
  };

  // Default cobre o universo do dataset SIA-PA hoje publicado: todas as
  // UFs × 2008–ano corrente. O loop interno pula partições já agregadas
  // (idempotência via existsSync no Parquet de saída) e ignora 404s do
  // S3 — então `pnpm aggregate` sem flags vira "preencha o que falta".
  const rawUfs = get('--ufs', 'ALL').toUpperCase();
  const ufs = (rawUfs === 'ALL' ? ALL_UFS : rawUfs.split(',').map((s) => s.trim())).sort();
  const yearsArg = get('--years', `2008-${new Date().getFullYear()}`);
  const years: number[] = [];
  for (const chunk of yearsArg.split(',')) {
    const [a, b] = chunk.split('-').map((s) => Number(s.trim()));
    if (a === undefined || !Number.isInteger(a)) {
      throw new Error(`--years inválido: '${yearsArg}'`);
    }
    const end = Number.isInteger(b) ? (b as number) : a;
    for (let y = a; y <= end; y += 1) years.push(y);
  }
  years.sort((x, y) => x - y);
  const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  return {
    force: argv.includes('--force'),
    outDir: resolve(siteRoot, get('--out', 'build/parquet')),
    sourceUrl: get('--source-url', DEFAULT_SOURCE_URL).replace(/\/+$/, ''),
    ufs,
    years,
  };
}

function rawUrl(sourceUrl: string, uf: string, year: number, month: number): string {
  const mesStr = String(month).padStart(2, '0');
  return `${sourceUrl}/sia-pa/ano=${year}/uf=${uf}/mes=${mesStr}/part.parquet`;
}

async function remoteExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

interface AggregatedRow {
  municipioCode: string;
  sigtap: string;
  valor: number;
  volume: number;
}

function aggregateMonthSql(url: string): Promise<AggregatedRow[]> {
  return new Promise((res, rej) => {
    const db = new duckdb.Database(':memory:');
    // Filtro SIGTAP 02.02 + agregação em SQL. Retorna milhares de
    // linhas (município × SIGTAP) em vez de milhões de registros brutos.
    db.all(
      `INSTALL httpfs; LOAD httpfs;
       SELECT
         CAST(PA_UFMUN AS VARCHAR) AS municipioCode,
         CAST(PA_PROC_ID AS VARCHAR) AS sigtap,
         CAST(SUM(TRY_CAST(PA_QTDAPR AS DOUBLE)) AS DOUBLE) AS volume,
         CAST(SUM(TRY_CAST(PA_VALAPR AS DOUBLE)) AS DOUBLE) AS valor
       FROM read_parquet('${url.replace(/'/g, "''")}')
       WHERE substr(CAST(PA_PROC_ID AS VARCHAR), 1, 4) = '0202'
         AND PA_UFMUN IS NOT NULL
       GROUP BY PA_UFMUN, PA_PROC_ID`,
      (err, rows) => {
        db.close(() => {
          if (err) rej(err);
          else res((rows ?? []) as unknown as AggregatedRow[]);
        });
      },
    );
  });
}

interface Row {
  competencia: string;
  loinc: string;
  municipioCode: string;
  municipioNome: string;
  ufSigla: string;
  valorAprovadoBRL: number;
  volumeExames: number;
}

function enrichAndReaggregate(aggregated: AggregatedRow[], uf: string, competencia: string): Row[] {
  const byKey = new Map<string, { municipioNome: string; valor: number; volume: number }>();
  for (const r of aggregated) {
    const mapping = sigtapToLoinc(r.sigtap);
    if (mapping?.loinc == null) continue;
    const key = `${r.municipioCode}|${mapping.loinc}`;
    const prev = byKey.get(key) ?? {
      municipioNome: findMunicipio(r.municipioCode)?.nome ?? r.municipioCode,
      valor: 0,
      volume: 0,
    };
    prev.volume += Number(r.volume) || 0;
    prev.valor += Number(r.valor) || 0;
    byKey.set(key, prev);
  }
  const out: Row[] = [];
  for (const [key, v] of byKey) {
    const [municipioCode, loinc] = key.split('|') as [string, string];
    out.push({
      competencia,
      loinc,
      municipioCode,
      municipioNome: v.municipioNome,
      ufSigla: uf,
      valorAprovadoBRL: Number(v.valor.toFixed(2)),
      volumeExames: v.volume,
    });
  }
  return out;
}

async function writeMonthPartition(
  outDir: string,
  uf: string,
  year: number,
  month: number,
  rows: Row[],
): Promise<void> {
  if (rows.length === 0) return;
  const mesStr = String(month).padStart(2, '0');
  const partitionDir = resolve(outDir, `ano=${year}/uf=${uf}/mes=${mesStr}`);
  mkdirSync(partitionDir, { recursive: true });
  const outFile = resolve(partitionDir, 'part.parquet');
  const jsonFile = resolve(partitionDir, 'part.ndjson');
  writeFileSync(jsonFile, rows.map((r) => JSON.stringify(r)).join('\n'));

  await new Promise<void>((res, rej) => {
    const db = new duckdb.Database(':memory:');
    db.all(
      `COPY (
         SELECT * FROM read_json_auto('${jsonFile.replace(/'/g, "''")}',
           format='newline_delimited')
         ORDER BY ufSigla, municipioCode, competencia, loinc
       ) TO '${outFile.replace(/'/g, "''")}'
       (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)`,
      (err) => {
        db.close(() => (err ? rej(err) : res()));
      },
    );
  });

  rmSync(jsonFile);
  process.stderr.write(
    `  ✓ ano=${year}/uf=${uf}/mes=${mesStr}/part.parquet (${rows.length} linhas)\n`,
  );
}

async function processMonth(
  cli: Cli,
  uf: string,
  year: number,
  month: number,
): Promise<{ emitted: number; status: '404' | 'done' | 'skipped' }> {
  const mesStr = String(month).padStart(2, '0');
  const outFile = resolve(cli.outDir, `ano=${year}/uf=${uf}/mes=${mesStr}/part.parquet`);
  if (existsSync(outFile) && !cli.force) {
    return { emitted: 0, status: 'skipped' };
  }

  const url = rawUrl(cli.sourceUrl, uf, year, month);
  if (!(await remoteExists(url))) {
    return { emitted: 0, status: '404' };
  }

  const competencia = `${year}-${mesStr}`;
  const aggregated = await aggregateMonthSql(url);
  const rows = enrichAndReaggregate(aggregated, uf, competencia);
  await writeMonthPartition(cli.outDir, uf, year, month, rows);
  return { emitted: rows.length, status: 'done' };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  mkdirSync(cli.outDir, { recursive: true });
  process.stderr.write(
    `Agregando SIA-PA (raw HTTPS → filtered+LOINC) | UFs=${cli.ufs.join(',')} | ` +
      `anos=${cli.years.join(',')} | source=${cli.sourceUrl}\n`,
  );

  for (const year of cli.years) {
    for (const uf of cli.ufs) {
      process.stderr.write(`[${year}] ${uf}: `);
      for (let month = 1; month <= 12; month += 1) {
        const r = await processMonth(cli, uf, year, month);
        const marker = r.status === 'done' ? '·' : r.status === 'skipped' ? '=' : 'x';
        process.stderr.write(`${month}${marker}`);
      }
      process.stderr.write('\n');
    }
  }

  process.stderr.write(`✓ Agregado em ${cli.outDir}\n`);
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Erro: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
