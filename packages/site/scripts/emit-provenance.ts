#!/usr/bin/env tsx
/**
 * Emite `build/provenance/ano=YYYY/uf=XX/part.provenance.json` para
 * cada Parquet agregado em `build/parquet/`, com SHA256 dos DBC-fonte
 * lidos do cache `@precisa-saude/datasus` e metadados do pipeline
 * (gitSha do script, versão do decoder, row-count, filtro aplicado).
 *
 * Objetivo: permitir reexecução determinística por terceiros — o
 * pesquisador baixa o DBC direto do `ftp.datasus.gov.br`, confere SHA256,
 * reexecuta `aggregate-sia-parquet.ts` no gitSha indicado e compara
 * o Parquet resultante byte-a-byte com o publicado.
 *
 * Uso:
 *   pnpm -F @datasus-brasil/site run emit-provenance
 *   pnpm -F @datasus-brasil/site run emit-provenance -- \
 *     --parquet-dir build/parquet --out build/provenance
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import duckdb from 'duckdb';

interface Cli {
  outDir: string;
  parquetDir: string;
}

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
  const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  return {
    outDir: resolve(siteRoot, get('--out', 'build/provenance')),
    parquetDir: resolve(siteRoot, get('--parquet-dir', 'build/parquet')),
  };
}

function defaultCacheDir(): string {
  return process.env['XDG_CACHE_HOME']
    ? join(process.env['XDG_CACHE_HOME'], 'datasus-brasil')
    : join(homedir(), '.cache', 'datasus-brasil');
}

function ftpPathFor(uf: string, year: number, month: number): string {
  const yy = String(year).slice(2);
  const mm = String(month).padStart(2, '0');
  return `/dissemin/publicos/SIASUS/200801_/Dados/PA${uf}${yy}${mm}.dbc`;
}

function sha256OfFile(path: string): string {
  const h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

interface PackageInfo {
  name: string;
  version: string;
}

function readPackageVersion(siteRoot: string, dep: string): PackageInfo {
  // Lê a resolução instalada no monorepo — reflete o que foi usado
  // no build, não o range semver do package.json.
  const candidates = [
    resolve(siteRoot, 'node_modules', dep, 'package.json'),
    resolve(siteRoot, '..', '..', 'node_modules', dep, 'package.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as PackageInfo;
      return { name: pkg.name, version: pkg.version };
    }
  }
  return { name: dep, version: 'unknown' };
}

function gitSha(repoRoot: string): string {
  try {
    const headRef = readFileSync(join(repoRoot, '.git', 'HEAD'), 'utf8').trim();
    if (headRef.startsWith('ref: ')) {
      const ref = headRef.slice(5);
      return readFileSync(join(repoRoot, '.git', ref), 'utf8').trim();
    }
    return headRef;
  } catch {
    return 'unknown';
  }
}

interface RowCountResult {
  rows: number;
}

function countRowsInParquet(path: string): Promise<number> {
  return new Promise((res, rej) => {
    const db = new duckdb.Database(':memory:');
    db.all(
      `SELECT COUNT(*) AS rows FROM read_parquet('${path.replace(/'/g, "''")}')`,
      (err, rows) => {
        db.close(() => {
          if (err) rej(err);
          else {
            const first = (rows?.[0] ?? {}) as RowCountResult;
            res(Number(first.rows ?? 0));
          }
        });
      },
    );
  });
}

interface PartitionKey {
  ano: number;
  uf: string;
}

function discoverPartitions(root: string): PartitionKey[] {
  if (!existsSync(root)) return [];
  const out: PartitionKey[] = [];
  for (const anoDir of readdirSync(root)) {
    const m = anoDir.match(/^ano=(\d{4})$/);
    if (!m) continue;
    const ano = Number(m[1]);
    const anoPath = join(root, anoDir);
    for (const ufDir of readdirSync(anoPath)) {
      const mm = ufDir.match(/^uf=([A-Z]{2})$/);
      if (!mm) continue;
      const uf = mm[1]!;
      const file = join(anoPath, ufDir, 'part.parquet');
      if (existsSync(file)) out.push({ ano, uf });
    }
  }
  return out.sort((a, b) => (a.ano === b.ano ? a.uf.localeCompare(b.uf) : a.ano - b.ano));
}

interface SourceFile {
  bytes: number;
  file: string;
  ftpPath: string;
  mtime: string;
  sha256: string;
}

function describeSources(cacheDir: string, uf: string, ano: number): SourceFile[] {
  const sources: SourceFile[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const ftpPath = ftpPathFor(uf, ano, month);
    const local = join(cacheDir, ftpPath);
    if (!existsSync(local)) continue;
    const stat = statSync(local);
    sources.push({
      bytes: stat.size,
      file: `PA${uf}${String(ano).slice(2)}${String(month).padStart(2, '0')}.dbc`,
      ftpPath,
      mtime: stat.mtime.toISOString(),
      sha256: sha256OfFile(local),
    });
  }
  return sources;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const repoRoot = resolve(siteRoot, '..', '..');
  const cacheDir = defaultCacheDir();

  if (!existsSync(cli.parquetDir)) {
    throw new Error(`Input ${cli.parquetDir} não existe. Rode aggregate antes.`);
  }
  mkdirSync(cli.outDir, { recursive: true });

  const decoder = readPackageVersion(siteRoot, '@precisa-saude/datasus-dbc');
  const datasusSdk = readPackageVersion(siteRoot, '@precisa-saude/datasus');
  const sha = gitSha(repoRoot);
  const partitions = discoverPartitions(cli.parquetDir);

  process.stderr.write(
    `Gerando provenance: ${partitions.length} partições, git ${sha.slice(0, 7)}, ` +
      `decoder ${decoder.version}, sdk ${datasusSdk.version}\n`,
  );

  for (const p of partitions) {
    const parquetPath = join(cli.parquetDir, `ano=${p.ano}/uf=${p.uf}/part.parquet`);
    const outFile = join(cli.outDir, `ano=${p.ano}/uf=${p.uf}/part.provenance.json`);
    mkdirSync(join(cli.outDir, `ano=${p.ano}/uf=${p.uf}`), { recursive: true });

    const sources = describeSources(cacheDir, p.uf, p.ano);
    const rows = await countRowsInParquet(parquetPath);
    const parquetSha = sha256OfFile(parquetPath);

    const body = {
      generatedAt: new Date().toISOString(),
      output: {
        file: `ano=${p.ano}/uf=${p.uf}/part.parquet`,
        rows,
        sha256: parquetSha,
      },
      partition: { ano: p.ano, uf: p.uf },
      pipeline: {
        aggregateScript: `packages/site/scripts/aggregate-sia-parquet.ts@${sha}`,
        datasusSdk: `${datasusSdk.name}@${datasusSdk.version}`,
        decoder: `${decoder.name}@${decoder.version}`,
        enrichment: 'sigtapToLoinc (loinc-biomarkers.json)',
        filter: 'isSigtapLaboratorio (SIGTAP 02.02)',
        schemaVintage: 'SIA-PA 2008+',
      },
      sources,
    };
    writeFileSync(outFile, `${JSON.stringify(body, null, 2)}\n`);
    process.stderr.write(
      `  ✓ ano=${p.ano}/uf=${p.uf} — ${sources.length} fontes, ${rows.toLocaleString('pt-BR')} linhas\n`,
    );
  }

  process.stderr.write(`✓ Provenance em ${cli.outDir}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Erro: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
