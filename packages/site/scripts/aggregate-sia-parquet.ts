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

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  fromPending: null | string;
  outDir: string;
  throttleMs: number;
  ufs: string[];
  yearPauseMs: number;
  years: number[];
}

interface PendingEntry {
  ftpPath?: string;
  month: number;
  uf: string;
  year: number;
}

interface PendingFile {
  detectedAt: string;
  latestCompetencia: string;
  pending: PendingEntry[];
}

interface UfYearMonth {
  month: number;
  uf: string;
  year: number;
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
  // Determinismo: UFs sempre ordenadas alfabeticamente.
  const ufs = (rawUfs === 'ALL' ? ALL_UFS : rawUfs.split(',').map((s) => s.trim())).sort();
  const yearsArg = get('--years', '2024');
  const years: number[] = [];
  for (const chunk of yearsArg.split(',')) {
    const [a, b] = chunk.split('-').map((s) => Number(s.trim()));
    if (!Number.isInteger(a)) throw new Error(`--years inválido: '${yearsArg}'`);
    const end = Number.isInteger(b) ? b : a;
    for (let y = a; y <= end!; y += 1) years.push(y);
  }
  years.sort((x, y) => x - y);
  const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const outDir = resolve(siteRoot, get('--out', 'build/parquet'));
  const throttleMs = Number(get('--throttle-ms', '500'));
  const yearPauseMs = Number(get('--year-pause-ms', '5000'));
  const fromPendingArg = argv.indexOf('--from-pending');
  // Aceita `--from-pending` (caminho default) ou `--from-pending <path>`.
  const fromPending =
    fromPendingArg === -1
      ? null
      : argv[fromPendingArg + 1] && !argv[fromPendingArg + 1]!.startsWith('--')
        ? resolve(siteRoot, argv[fromPendingArg + 1]!)
        : resolve(siteRoot, '..', '..', 'state/pending.json');
  if (!Number.isFinite(throttleMs) || throttleMs < 0) {
    throw new Error(`--throttle-ms inválido: ${throttleMs}`);
  }
  if (!Number.isFinite(yearPauseMs) || yearPauseMs < 0) {
    throw new Error(`--year-pause-ms inválido: ${yearPauseMs}`);
  }
  return { fromPending, outDir, throttleMs, ufs, yearPauseMs, years };
}

function loadPending(path: string): UfYearMonth[] {
  if (!existsSync(path)) {
    throw new Error(`--from-pending: arquivo não encontrado em ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as PendingFile;
  const list = (raw.pending ?? []).map((p) => ({
    month: p.month,
    uf: p.uf.toUpperCase(),
    year: p.year,
  }));
  // Determinismo: ordena (uf, year, month).
  return list.sort((a, b) => {
    if (a.uf !== b.uf) return a.uf.localeCompare(b.uf);
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
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
    // Determinismo: ORDER BY fixo, row_group_size explícito. Produz
    // Parquet byte-a-byte idêntico em reexecuções com o mesmo DBC.
    db.all(
      `COPY (
         SELECT * FROM read_json_auto('${jsonFile.replace(/'/g, "''")}', format='newline_delimited')
         ORDER BY ufSigla, municipioCode, competencia, loinc
       ) TO '${outFile.replace(/'/g, "''")}'
       (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)`,
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

async function runFromPending(cli: Cli): Promise<void> {
  const pending = loadPending(cli.fromPending!);
  process.stderr.write(`Modo --from-pending: ${pending.length} (UF × competência) a processar\n`);

  // Agrupa por (uf, year) pra emitir 1 partição por grupo — mantém o
  // layout existente `ano=YYYY/uf=XX/part.parquet`.
  const byUfYear = new Map<string, UfYearMonth[]>();
  for (const p of pending) {
    const key = `${p.uf}|${p.year}`;
    const bucket = byUfYear.get(key) ?? [];
    bucket.push(p);
    byUfYear.set(key, bucket);
  }

  for (const [key, items] of [...byUfYear.entries()].sort()) {
    const [uf, yearStr] = key.split('|') as [string, string];
    const year = Number(yearStr);
    const rows: Row[] = [];
    let totalRead = 0;
    process.stderr.write(`[${year}] ${uf}: `);
    for (const { month } of items.sort((a, b) => a.month - b.month)) {
      const read = await collectMonth(uf, year, month, rows);
      totalRead += read;
      process.stderr.write(`${month}${read > 0 ? '·' : 'x'}`);
      if (cli.throttleMs > 0) await sleep(cli.throttleMs);
    }
    process.stderr.write(
      ` (${totalRead.toLocaleString('pt-BR')} registros → ${rows.length} lab-LOINC)\n`,
    );
    await writePartition(cli, uf, year, rows);
  }

  process.stderr.write(`✓ Delta processado em ${cli.outDir}\n`);
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  mkdirSync(cli.outDir, { recursive: true });

  if (cli.fromPending) {
    await runFromPending(cli);
    process.exit(0);
  }

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
