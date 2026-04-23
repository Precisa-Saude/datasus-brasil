#!/usr/bin/env tsx
/**
 * Pós-processa o diretório `build/parquet/` (layout
 * `ano=YYYY/uf=XX/part.parquet`) emitido pelo `aggregate-sia-parquet.ts`
 * em dois artefatos otimizados pra consumo no browser via DuckDB WASM:
 *
 *   build/parquet-opt/
 *     ├─ uf-totals.parquet           — agregado nacional
 *     │                                (ufSigla × loinc × competencia)
 *     │                                ~500 KB. Usado pela visão
 *     │                                país → 1 Range Request por query.
 *     └─ uf=XX/part.parquet          — 27 arquivos, um por UF, com
 *                                      `ano` como coluna. Consolida
 *                                      as 18 partições anuais num
 *                                      único Parquet — corta 95% do
 *                                      overhead de metadata do DuckDB.
 *
 * Rationale: cada Parquet tem ~30-80 KB de footer que o DuckDB lê via
 * HTTP Range pra saber quais row-groups ignorar. Com 486 arquivos
 * (18 anos × 27 UFs), isso vira ~1000 GETs por query. Consolidando
 * por UF, caem pra 27 (menos ainda pra UF-totals: 1).
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import duckdb from 'duckdb';

function runSql(db: duckdb.Database, sql: string): Promise<void> {
  return new Promise((res, rej) => {
    db.all(sql, (err) => (err ? rej(err) : res()));
  });
}

async function main(): Promise<void> {
  const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const inDir = resolve(siteRoot, 'build/parquet');
  const outDir = resolve(siteRoot, 'build/parquet-opt');

  if (!existsSync(inDir)) {
    throw new Error(`Input ${inDir} não existe. Rode \`aggregate\` antes.`);
  }
  // Limpa saída anterior pra garantir consistência.
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const db = new duckdb.Database(':memory:');
  const glob = `${inDir}/**/*.parquet`;

  // 1) `uf-totals.parquet`: agregado nacional.
  process.stderr.write('→ emit uf-totals.parquet (agregado nacional)\n');
  const totalsFile = resolve(outDir, 'uf-totals.parquet');
  await runSql(
    db,
    `COPY (
       SELECT
         ufSigla,
         loinc,
         competencia,
         SUM(volumeExames) AS volumeExames,
         SUM(valorAprovadoBRL) AS valorAprovadoBRL
       FROM read_parquet('${glob}', hive_partitioning=1)
       GROUP BY ufSigla, loinc, competencia
       ORDER BY competencia, ufSigla, loinc
     ) TO '${totalsFile}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
  );
  process.stderr.write(`  ✓ ${totalsFile}\n`);

  // 2) Um Parquet por UF consolidando todos os anos.
  const ufDirs = readdirSync(inDir)
    .filter((d) => d.startsWith('ano='))
    .flatMap((d) => readdirSync(resolve(inDir, d)).map((u) => u.slice(3)))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

  for (const uf of ufDirs) {
    const ufOutDir = resolve(outDir, `uf=${uf}`);
    mkdirSync(ufOutDir, { recursive: true });
    const outFile = resolve(ufOutDir, 'part.parquet');
    process.stderr.write(`→ emit uf=${uf}/part.parquet... `);
    await runSql(
      db,
      `COPY (
         SELECT
           ano,
           municipioCode,
           municipioNome,
           loinc,
           competencia,
           volumeExames,
           valorAprovadoBRL
         FROM read_parquet('${inDir}/**/*.parquet', hive_partitioning=1)
         WHERE uf = '${uf}'
         ORDER BY competencia, municipioCode, loinc
       ) TO '${outFile}' (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
    process.stderr.write('✓\n');
  }

  await new Promise<void>((res) => db.close(() => res()));
  process.stderr.write(`✓ Consolidação completa em ${outDir}\n`);
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Erro: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
