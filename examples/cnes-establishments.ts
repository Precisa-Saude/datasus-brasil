#!/usr/bin/env tsx
/**
 * Exemplo: CNES-ST → estabelecimentos por tipo de unidade → JSON.
 *
 * Uso:
 *   pnpm exec tsx examples/cnes-establishments.ts [UF] [YEAR] [MONTH]
 *
 * Default: AC 2024 1.
 */

import { cnes, countBy, labelTipoUnidade, topN } from '@precisa-saude/datasus';

const uf = process.argv[2] ?? 'AC';
const year = Number(process.argv[3] ?? '2024');
const month = Number(process.argv[4] ?? '1');

process.stderr.write(`Baixando CNES-ST ${uf}/${year}/${String(month).padStart(2, '0')}...\n`);
const records = await cnes.loadEstabelecimentos({ month, uf, year });
process.stderr.write(`Carregados ${records.length} estabelecimentos.\n`);

const byTipo = countBy(records, (r) => labelTipoUnidade(r.TP_UNID) ?? 'Desconhecido');
const top = topN(byTipo, 15);

process.stdout.write(`${JSON.stringify(top, null, 2)}\n`);
