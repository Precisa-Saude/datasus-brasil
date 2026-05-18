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
 *
 * Detecção de revisão upstream: pra cada partição já agregada, fazemos
 * um HEAD no raw remoto e comparamos `Last-Modified` com o mtime do
 * agregado local. Se o remoto foi republicado depois (DATASUS reescreve
 * meses históricos quando o gestor empurra correções), re-agregamos —
 * caso contrário pulamos pelo caminho rápido. `--force` ignora a
 * comparação e re-agrega tudo. Markers na saída: `·` agregado novo,
 * `↻` re-agregado por revisão upstream, `=` pulado, `x` 404, `e` erro.
 */

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * Devolve o `Last-Modified` do raw parquet remoto convertido pra epoch
 * ms, ou `null` se o header estiver ausente / a request falhar. Usado
 * pra detectar partições publicadas pelo `datasus-parquet` mais
 * recentemente que o agregado local — DATASUS reescreve meses
 * históricos quando o gestor empurra correções retroativas, e o
 * `existsSync` puro do `processMonth` deixava essas correções
 * congeladas no `parquet-opt` indefinidamente.
 */
async function remoteLastModified(url: string): Promise<null | number> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return null;
    const lm = res.headers.get('last-modified');
    if (lm === null) return null;
    const t = Date.parse(lm);
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

interface AggregatedRow {
  municipioCode: string;
  sigtap: string;
  valor: number;
  volume: number;
}

// Pre-install httpfs uma vez no startup. Sem isso, 12 in-memory DuckDBs
// rodando `INSTALL httpfs` em paralelo (um por mês via Promise.allSettled)
// brigam pelo mesmo extension cache em ~/.duckdb/extensions/ e geram
// SIGSEGV no native module — observado em run 25270535305 que crashou
// com exit 139 ao processar 2012/AP→BA.
async function ensureHttpfsInstalled(): Promise<void> {
  return new Promise((res, rej) => {
    const db = new duckdb.Database(':memory:');
    db.all('INSTALL httpfs;', (err) => {
      db.close(() => (err ? rej(err) : res()));
    });
  });
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 3,
  baseMs = 1000,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      const wait = baseMs * 4 ** i;
      process.stderr.write(
        `  ↺ ${label}: tentativa ${i + 1}/${attempts} falhou (${(err as Error).message.split('\n')[0]}), aguardando ${wait}ms\n`,
      );
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw lastErr;
}

function aggregateMonthSql(url: string): Promise<AggregatedRow[]> {
  return new Promise((res, rej) => {
    const db = new duckdb.Database(':memory:');
    // Filtro SIGTAP 02.02 + agregação em SQL. Retorna milhares de
    // linhas (município × SIGTAP) em vez de milhões de registros brutos.
    // LOAD httpfs por DB (cada in-memory DB precisa ativar a extensão);
    // INSTALL acontece uma vez via ensureHttpfsInstalled() antes do fanout.
    db.all(
      `LOAD httpfs;
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
): Promise<{ emitted: number; status: '404' | 'done' | 'refreshed' | 'skipped' }> {
  const mesStr = String(month).padStart(2, '0');
  const outFile = resolve(cli.outDir, `ano=${year}/uf=${uf}/mes=${mesStr}/part.parquet`);
  const url = rawUrl(cli.sourceUrl, uf, year, month);

  // Idempotência com detecção de revisão upstream: se o agregado local
  // existe e `--force` não foi passado, comparamos o mtime local com o
  // `Last-Modified` do raw remoto. Igualdade ou remoto mais antigo ⇒
  // skip (caminho rápido — 1 HEAD ~50ms vs aggregação completa ~6s).
  // Remoto mais novo ⇒ re-agrega, marca `refreshed`. Sem header de
  // Last-Modified disponível, mantém o comportamento histórico (skip
  // — fail open, pra não regredir em mirrors sem suporte a HEAD).
  let isRefresh = false;
  if (existsSync(outFile) && !cli.force) {
    const localMtime = statSync(outFile).mtimeMs;
    const remoteMtime = await remoteLastModified(url);
    if (remoteMtime === null || remoteMtime <= localMtime) {
      return { emitted: 0, status: 'skipped' };
    }
    isRefresh = true;
  } else if (!(await remoteExists(url))) {
    return { emitted: 0, status: '404' };
  }

  const competencia = `${year}-${mesStr}`;
  // Retry com backoff exponencial: CloudFront 403 transiente já derrubou
  // run inteiro (2026-05-18 09:24 UTC: 2009+ todos falharam, gerando
  // manifest só com 2008 / 12 UFs). 3 tentativas × backoff 1s/4s/16s
  // absorvem rate-limit sem custar muito no caminho feliz.
  const aggregated = await retryWithBackoff(() => aggregateMonthSql(url), `${uf} ${competencia}`);
  const rows = enrichAndReaggregate(aggregated, uf, competencia);
  await writeMonthPartition(cli.outDir, uf, year, month, rows);
  return { emitted: rows.length, status: isRefresh ? 'refreshed' : 'done' };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  mkdirSync(cli.outDir, { recursive: true });
  await ensureHttpfsInstalled();
  // Concurrência por UF/ano: cada (year, uf) processa seus 12 meses em
  // paralelo. CloudFront I/O + DuckDB scan são embaraçosamente paralelos
  // por mês; sequencial gastava ~6s/mês × 6156 meses = 6h+ e batia no
  // hard cap de 6h dos runners GH-hosted. Em paralelo dentro do UF cada
  // UF/ano fica limitado pelo mês mais lento (~10-20s), 27 UFs × 19 anos
  // ≈ 1h de wall time. Ordenamento da saída preservado: linha por
  // [ano] UF com markers reordenados em mês crescente.
  process.stderr.write(
    `Agregando SIA-PA (raw HTTPS → filtered+LOINC) | UFs=${cli.ufs.join(',')} | ` +
      `anos=${cli.years.join(',')} | source=${cli.sourceUrl}\n`,
  );

  // allSettled em vez de Promise.all: se um mês falhar, os outros 11
  // ainda escrevem suas partições. Erros viram marker 'e' na saída
  // pra não passar batido. Idempotência cuida do retry no próximo run.
  let totalRefreshed = 0;
  let totalFailed = 0;
  for (const year of cli.years) {
    for (const uf of cli.ufs) {
      const months = Array.from({ length: 12 }, (_, i) => i + 1);
      const settled = await Promise.allSettled(months.map((m) => processMonth(cli, uf, year, m)));
      const markers = settled.map((s, i) => {
        const m = i + 1;
        if (s.status === 'rejected') {
          totalFailed += 1;
          process.stderr.write(
            `\n  ✗ ${uf} ${year}-${String(m).padStart(2, '0')}: ` +
              `${(s.reason as Error).message}\n`,
          );
          return `${m}e`;
        }
        if (s.value.status === 'refreshed') totalRefreshed += 1;
        const sym =
          s.value.status === 'done'
            ? '·'
            : s.value.status === 'refreshed'
              ? '↻'
              : s.value.status === 'skipped'
                ? '='
                : 'x';
        return `${m}${sym}`;
      });
      process.stderr.write(`[${year}] ${uf}: ${markers.join('')}\n`);
    }
  }

  if (totalRefreshed > 0) {
    process.stderr.write(
      `↻ ${totalRefreshed} partição(ões) reagregada(s) por revisão upstream do datasus-parquet.\n`,
    );
  }
  // Fail-loud: limite default 24 (= 2 UFs/ano de tolerância) absorve falhas
  // isoladas mas pega catástrofes como 2026-05-18 09:24 UTC, onde 2009+
  // inteiro falhou com 403 e o run terminou "limpo" publicando manifest
  // só com 2008. Override via AGGREGATE_MAX_FAILURES.
  const maxFailures = Number(process.env.AGGREGATE_MAX_FAILURES ?? '24');
  if (totalFailed > maxFailures) {
    process.stderr.write(
      `\n✗ ${totalFailed} partições falharam (limite=${maxFailures}). ` +
        `Provavelmente algo sistêmico (CloudFront throttling, S3 down, schema break). ` +
        `Não progredindo para upload — o manifest publicado seria parcial.\n`,
    );
    process.exit(2);
  }
  if (totalFailed > 0) {
    process.stderr.write(
      `⚠ ${totalFailed} partições falharam (dentro do limite ${maxFailures}). ` +
        `Próximo run idempotente vai re-tentar.\n`,
    );
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
