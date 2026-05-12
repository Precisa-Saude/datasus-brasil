#!/usr/bin/env tsx
/**
 * Extrai um catálogo mínimo (LOINC → SIGTAPs[]) do
 * `@precisa-saude/datasus-sdk` e escreve em
 * `src/lib/loinc-sigtap-catalog.generated.json`.
 *
 * O SDK agrega FTP/DBC/fs no bundle e não roda no browser. Em vez de
 * stubar essas dependências, extraímos apenas o subset que o site
 * precisa (terminologia) num arquivo estático committed e mantemos o
 * SDK fora do bundle de browser.
 *
 * Re-rodar quando o `@precisa-saude/datasus-sdk` for atualizado:
 *
 *   pnpm -F @datasus-viz/site exec tsx scripts/extract-sigtap-catalog.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listBiomarkers, loincToSigtap } from '@precisa-saude/datasus-sdk';

const OUT_PATH = resolve(
  fileURLToPath(import.meta.url),
  '../../src/lib/loinc-sigtap-catalog.generated.json',
);

const byLoinc = new Map<string, Set<string>>();

for (const mapping of listBiomarkers()) {
  if (mapping.loinc == null || mapping.sigtap == null) continue;
  const set = byLoinc.get(mapping.loinc) ?? new Set<string>();
  set.add(mapping.sigtap);
  byLoinc.set(mapping.loinc, set);
}

// `listBiomarkers()` indexa por biomarker_code (uma entrada por
// biomarcador); o `byLoinc` interno do SDK também só mantém uma
// entrada por LOINC. Reforçamos o resultado consultando o catálogo
// pelo lado direto.
for (const loinc of byLoinc.keys()) {
  const direct = loincToSigtap(loinc);
  if (direct?.sigtap != null) byLoinc.get(loinc)!.add(direct.sigtap);
}

const catalog: Record<string, string[]> = {};
for (const [loinc, sigtaps] of byLoinc) {
  catalog[loinc] = Array.from(sigtaps).sort();
}

const sortedKeys = Object.keys(catalog).sort();
const sorted: Record<string, string[]> = {};
for (const k of sortedKeys) sorted[k] = catalog[k]!;

writeFileSync(OUT_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf-8');
process.stderr.write(`✓ ${OUT_PATH} (${sortedKeys.length} LOINCs)\n`);
