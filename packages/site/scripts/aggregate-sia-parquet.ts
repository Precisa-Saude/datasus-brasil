#!/usr/bin/env tsx
/**
 * Agregador SIA-PA → Parquet particionado em Hive-style
 * (`ano=YYYY/uf=XX/part.parquet`). Pensado pra escalar: todas as UFs ×
 * todos os anos disponíveis no FTP DATASUS (2008+) num único layout
 * que DuckDB WASM lê direto via `read_parquet(...)` com pushdown de
 * filtro por partição.
 *
 * Pré-requisitos: `pnpm -F @datasus-brasil/site install` (inclui
 * `duckdb` native binding).
 *
 * Uso:
 *   pnpm -F @datasus-brasil/site aggregate-parquet \
 *     --ufs AC --years 2024
 *   pnpm -F @datasus-brasil/site aggregate-parquet \
 *     --ufs ALL --years 2008-2025
 *
 * Observação: só agrega linhas de laboratório (SIGTAP 02.02) com LOINC
 * mapeado. `municipioCode` mantido em 6 dígitos (sem DV, como o SIA).
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  enrichWithLoinc,
  findMunicipio,
  isSigtapLaboratorio,
  sia,
  type SiaProducaoAmbulatorialRecord,
} from '@precisa-saude/datasus-sdk';
import duckdb from 'duckdb';

interface Cli {
  outDir: string;
  throttleMs: number;
  ufs: string[];
  yearPauseMs: number;
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

  const rawUfs = get('--ufs', 'AC').toUpperCase();
  const ufs = rawUfs === 'ALL' ? ALL_UFS : rawUfs.split(',').map((s) => s.trim());
  const yearsArg = get('--years', '2024');
  const years: number[] = [];
  for (const chunk of yearsArg.split(',')) {
    const [a, b] = chunk.split('-').map((s) => Number(s.trim()));
    if (!Number.isInteger(a)) throw new Error(`--years inválido: '${yearsArg}'`);
    const end = Number.isInteger(b) ? b : a;
    for (let y = a; y <= end!; y += 1) years.push(y);
  }
  const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const outDir = resolve(siteRoot, get('--out', 'build/parquet'));
  const throttleMs = Number(get('--throttle-ms', '500'));
  const yearPauseMs = Number(get('--year-pause-ms', '5000'));
  if (!Number.isFinite(throttleMs) || throttleMs < 0) {
    throw new Error(`--throttle-ms inválido: ${throttleMs}`);
  }
  if (!Number.isFinite(yearPauseMs) || yearPauseMs < 0) {
    throw new Error(`--year-pause-ms inválido: ${yearPauseMs}`);
  }
  return { outDir, throttleMs, ufs, yearPauseMs, years };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
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

async function collectMonth(
  ufSigla: string,
  year: number,
  month: number,
  rows: Row[],
): Promise<number> {
  const iso = `${year}-${String(month).padStart(2, '0')}`;
  const agg = new Map<string, { valor: number; volume: number; nome: string }>();
  let read = 0;
  try {
    for await (const raw of sia.streamProducaoAmbulatorial({ month, uf: ufSigla, year })) {
      read += 1;
      const record = raw as SiaProducaoAmbulatorialRecord;
      if (!isSigtapLaboratorio(typeof record.PA_PROC_ID === 'string' ? record.PA_PROC_ID : null)) {
        continue;
      }
      const enriched = enrichWithLoinc(record);
      if (enriched.loinc === null || enriched.loinc.loinc === null) continue;
      const loinc = enriched.loinc.loinc;
      const munCode = typeof record.PA_UFMUN === 'string' ? record.PA_UFMUN : null;
      if (!munCode) continue;
      const qtd = typeof record.PA_QTDAPR === 'number' ? record.PA_QTDAPR : 1;
      const valor = typeof record.PA_VALAPR === 'number' ? record.PA_VALAPR : 0;
      const key = `${munCode}|${loinc}`;
      const cur = agg.get(key) ?? {
        nome: findMunicipio(munCode)?.nome ?? munCode,
        valor: 0,
        volume: 0,
      };
      cur.volume += qtd;
      cur.valor += valor;
      agg.set(key, cur);
    }
  } catch (err) {
    process.stderr.write(`FALHA ${ufSigla} ${iso}: ${(err as Error).message}\n`);
    return 0;
  }
  for (const [key, v] of agg) {
    const [municipioCode, loinc] = key.split('|') as [string, string];
    rows.push({
      competencia: iso,
      loinc,
      municipioCode,
      municipioNome: v.nome,
      ufSigla,
      valorAprovadoBRL: Number(v.valor.toFixed(2)),
      volumeExames: v.volume,
    });
  }
  return read;
}

async function writePartition(cli: Cli, ufSigla: string, year: number, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const partitionDir = resolve(cli.outDir, `ano=${year}/uf=${ufSigla}`);
  mkdirSync(partitionDir, { recursive: true });
  const outFile = resolve(partitionDir, 'part.parquet');

  // Via DuckDB: leitura de JSON em memória → COPY TO Parquet (zstd).
  const jsonFile = resolve(partitionDir, 'part.ndjson');
  writeFileSync(jsonFile, rows.map((r) => JSON.stringify(r)).join('\n'));

  await new Promise<void>((resolve2, reject) => {
    const db = new duckdb.Database(':memory:');
    db.all(
      `COPY (SELECT * FROM read_json_auto('${jsonFile.replace(/'/g, "''")}', format='newline_delimited'))
       TO '${outFile.replace(/'/g, "''")}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
      (err) => {
        db.close(() => {
          if (err) reject(err);
          else resolve2();
        });
      },
    );
  });

  rmSync(jsonFile);
  process.stderr.write(`  ✓ ano=${year}/uf=${ufSigla}/part.parquet  (${rows.length} linhas)\n`);
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  mkdirSync(cli.outDir, { recursive: true });
  process.stderr.write(
    `Agregando SIA-PA → Parquet | UFs=${cli.ufs.join(',')} | anos=${cli.years.join(',')} | out=${cli.outDir}\n`,
  );

  for (let yIdx = 0; yIdx < cli.years.length; yIdx += 1) {
    const year = cli.years[yIdx]!;
    for (const ufSigla of cli.ufs) {
      const rows: Row[] = [];
      let totalRead = 0;
      process.stderr.write(`[${year}] ${ufSigla}: `);
      for (let month = 1; month <= 12; month += 1) {
        const read = await collectMonth(ufSigla, year, month, rows);
        totalRead += read;
        process.stderr.write(`${month}${read > 0 ? '·' : 'x'}`);
        // Throttle entre arquivos pra não hammer o FTP DATASUS.
        if (cli.throttleMs > 0 && month < 12) await sleep(cli.throttleMs);
      }
      process.stderr.write(
        ` (${totalRead.toLocaleString('pt-BR')} registros → ${rows.length} lab-LOINC)\n`,
      );
      await writePartition(cli, ufSigla, year, rows);
      if (cli.throttleMs > 0) await sleep(cli.throttleMs);
    }
    // Pausa mais longa entre anos (ex. checkpoint natural). Útil se
    // quiser interromper manualmente — já temos todos os Parquet do
    // ano completo em disco.
    if (cli.yearPauseMs > 0 && yIdx < cli.years.length - 1) {
      process.stderr.write(`  (pausa de ${cli.yearPauseMs}ms antes do próximo ano)\n`);
      await sleep(cli.yearPauseMs);
    }
  }

  process.stderr.write(`✓ Parquet particionado em ${cli.outDir}\n`);
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Erro: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
