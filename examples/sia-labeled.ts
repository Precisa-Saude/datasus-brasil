#!/usr/bin/env tsx
/**
 * Exemplo: SIA-PA → registros labeled (pt-BR) → JSON.
 *
 * Projeta cada registro de Produção Ambulatorial via
 * `labelProducaoAmbulatorial`, emitindo objetos com estabelecimento,
 * município, procedimento (SIGTAP + rótulo), competência e
 * demográficos decodificados.
 *
 * Uso:
 *   pnpm exec tsx examples/sia-labeled.ts [UF] [YEAR] [MONTH] [LIMIT]
 *
 * Default: AC 2024 1 5.
 */

import { labelProducaoAmbulatorial, sia } from '@precisa-saude/datasus';

const uf = process.argv[2] ?? 'AC';
const year = Number(process.argv[3] ?? '2024');
const month = Number(process.argv[4] ?? '1');
const limit = Number(process.argv[5] ?? '5');

process.stderr.write(`Baixando SIA-PA ${uf}/${year}/${String(month).padStart(2, '0')}...\n`);

const labeled = [];
let n = 0;
for await (const record of sia.streamProducaoAmbulatorial({ month, uf, year })) {
  labeled.push(labelProducaoAmbulatorial(record));
  n++;
  if (n >= limit) break;
}

process.stdout.write(`${JSON.stringify(labeled, null, 2)}\n`);
