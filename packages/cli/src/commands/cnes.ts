/**
 * `datasus-brasil cnes` — baixa CNES-ST (estabelecimentos) UF × ano × mês
 * em streaming.
 *
 * Modos:
 *   default  → agrega top-N tipos de unidade com label pt-BR
 *   --raw    → emite registros brutos como JSONL
 */

import { cnes, labelTipoUnidade, topN } from '@precisa-saude/datasus';

import type { ParsedArgs } from '../args.js';
import { optInt, requireInt, requireOpt } from '../args.js';
import { emit } from '../output.js';
import { createProgressReporter } from '../progress.js';
import {
  consumeStream,
  emitJsonArrayStream,
  emitJsonlRecord,
  parseStreamOptions,
} from '../stream.js';

export const CNES_USAGE = `datasus-brasil cnes --uf <UF> --year <YYYY> --month <MM> [--top N] [--limit N] [--raw] [--format json|jsonl]

  Baixa CNES-ST (estabelecimentos) em streaming.

  Default: emite os N tipos de unidade mais frequentes com label pt-BR.
  Com --raw: emite registros brutos como JSONL.

  Flags:
    --uf       Sigla da UF (ex: SP, AC). Obrigatório.
    --year     Ano >= 2005. Obrigatório.
    --month    Mês 1..12. Obrigatório.
    --top      Número de tipos no modo agregado (default: 15).
    --limit    Para de ler após N registros.
    --raw      Emite registros brutos.
    --format   json (default) ou jsonl. --raw defaulta para jsonl.

  Exemplos:
    datasus-brasil cnes --uf AC --year 2024 --month 1
    datasus-brasil cnes --uf SP --year 2024 --month 1 --raw --limit 20`;

export async function runCnes(args: ParsedArgs): Promise<void> {
  const uf = requireOpt(args, 'uf');
  const year = requireInt(args, 'year');
  const month = requireInt(args, 'month');
  const top = optInt(args, 'top', 15);
  const stream = parseStreamOptions(args);

  const label = `CNES-ST ${uf}/${year}/${String(month).padStart(2, '0')}`;
  const onProgress = createProgressReporter(label);
  const source = cnes.streamEstabelecimentos({ ftp: { onProgress }, month, uf, year });

  if (stream.raw && stream.format === 'jsonl') {
    const n = await consumeStream(source, stream.limit, emitJsonlRecord);
    process.stderr.write(`Emitidos ${n} registros.\n`);
    return;
  }

  if (stream.raw) {
    const n = await emitJsonArrayStream(source, stream.limit);
    process.stderr.write(`Emitidos ${n} registros.\n`);
    return;
  }

  const counts: Record<string, number> = {};
  const n = await consumeStream(source, stream.limit, (r) => {
    const key = labelTipoUnidade(r.TP_UNID) ?? 'Desconhecido';
    counts[key] = (counts[key] ?? 0) + 1;
  });
  process.stderr.write(`Processados ${n} estabelecimentos.\n`);

  emit(topN(counts, top), stream.format);
}
