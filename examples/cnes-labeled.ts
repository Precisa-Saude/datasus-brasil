#!/usr/bin/env tsx
/**
 * Exemplo: CNES-ST → estabelecimentos labeled (pt-BR) → JSON.
 *
 * Similar a `cnes-establishments.ts`, mas em vez de agregar por tipo,
 * projeta cada registro via `labelEstabelecimento`, emitindo objetos
 * ricos com tipo, gestão, esfera, natureza jurídica, leitos, serviços
 * de apoio e matriz atividade×convênio — todos decodificados em pt-BR.
 *
 * Uso:
 *   pnpm exec tsx examples/cnes-labeled.ts [UF] [YEAR] [MONTH] [LIMIT]
 *
 * Default: AC 2024 1 5.
 */

import { cnes, labelEstabelecimento } from '@precisa-saude/datasus';

const uf = process.argv[2] ?? 'AC';
const year = Number(process.argv[3] ?? '2024');
const month = Number(process.argv[4] ?? '1');
const limit = Number(process.argv[5] ?? '5');

process.stderr.write(`Baixando CNES-ST ${uf}/${year}/${String(month).padStart(2, '0')}...\n`);

const labeled = [];
let n = 0;
for await (const record of cnes.streamEstabelecimentos({ month, uf, year })) {
  labeled.push(labelEstabelecimento(record));
  n++;
  if (n >= limit) break;
}
process.stderr.write(`Projetados ${n} estabelecimentos.\n`);
process.stdout.write(`${JSON.stringify(labeled, null, 2)}\n`);
