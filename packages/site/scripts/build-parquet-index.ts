#!/usr/bin/env tsx
/**
 * Escaneia `build/parquet/` e emite um manifesto `index.json` com:
 * - lista de anos, UFs, competências cobertas
 * - catálogo de biomarcadores (loinc → display)
 * - UFs com dados municipais disponíveis (sempre que tem Parquet)
 *
 * O site lê esse index no boot pra alimentar os selects e gatear o
 * drill-down, sem precisar query SQL pra metadados.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listBiomarkers } from '@precisa-saude/datasus-sdk';
import duckdb from 'duckdb';

interface IndexOut {
  availableUFs: string[];
  biomarkers: Array<{ code: string; display: string; loinc: string }>;
  competencias: string[];
  geradoEm: string;
  years: number[];
}

async function query(db: duckdb.Database, sql: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((res, rej) => {
    db.all(sql, (err, rows) => (err ? rej(err) : res(rows ?? [])));
  });
}

async function main(): Promise<void> {
  const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const parquetDir = resolve(siteRoot, 'build/parquet');
  const outDir = resolve(siteRoot, 'build/manifest');
  mkdirSync(outDir, { recursive: true });

  const years = readdirSync(parquetDir)
    .filter((d) => d.startsWith('ano='))
    .map((d) => Number(d.slice(4)))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);

  const availableUFs = new Set<string>();
  for (const y of years) {
    const yd = resolve(parquetDir, `ano=${y}`);
    for (const uf of readdirSync(yd)) {
      if (uf.startsWith('uf=')) availableUFs.add(uf.slice(3));
    }
  }

  const db = new duckdb.Database(':memory:');
  const competenciasRows = await query(
    db,
    `SELECT DISTINCT competencia FROM read_parquet('${parquetDir}/**/*.parquet', hive_partitioning=1) ORDER BY competencia`,
  );

  const biomarkersRaw = listBiomarkers();
  const seenLoinc = new Set(
    (
      await query(
        db,
        `SELECT DISTINCT loinc FROM read_parquet('${parquetDir}/**/*.parquet', hive_partitioning=1)`,
      )
    ).map((r) => String(r.loinc)),
  );

  const biomarkers = biomarkersRaw
    .filter((b) => b.loinc && seenLoinc.has(b.loinc))
    .map((b) => ({ code: b.biomarker.code, display: b.biomarker.display, loinc: b.loinc! }))
    .sort((a, b) => a.display.localeCompare(b.display));

  db.close(() => {});

  const index: IndexOut = {
    availableUFs: [...availableUFs].sort(),
    biomarkers,
    competencias: competenciasRows.map((r) => String(r.competencia)),
    geradoEm: new Date().toISOString(),
    years,
  };

  const outFile = resolve(outDir, 'index.json');
  writeFileSync(outFile, `${JSON.stringify(index, null, 2)}\n`);
  process.stderr.write(
    `✓ ${outFile}: ${biomarkers.length} biomarcadores, ${years.length} anos, ${availableUFs.size} UFs, ${competenciasRows.length} competências\n`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Erro: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
