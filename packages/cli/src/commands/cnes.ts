/**
 * `datasus-brasil cnes` — baixa CNES-ST (estabelecimentos) UF × ano × mês
 * em streaming.
 *
 * Modos:
 *   default    → agrega top-N tipos de unidade com label pt-BR
 *   --labeled  → projeta cada registro via `labelEstabelecimento` (pt-BR legível)
 *   --raw      → emite registros brutos do DATASUS (códigos)
 */

import type { CnesEstabelecimentoRecord } from '@precisa-saude/datasus';
import { cnes, labelEstabelecimento, labelTipoUnidade, topN } from '@precisa-saude/datasus';

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

export const CNES_USAGE = `datasus-brasil cnes --uf <UF> --year <YYYY> --month <MM> [--top N] [--limit N] [--raw|--labeled] [--format json|jsonl]

  Baixa CNES-ST (estabelecimentos) em streaming.

  Default:   emite os N tipos de unidade mais frequentes com label pt-BR.
  --labeled: emite cada estabelecimento com todos os códigos decodificados
             (tipo, gestão, esfera, natureza jurídica, leitos agregados,
             serviços de apoio, matriz atividade × convênio, ...).
  --raw:     emite registros brutos do DATASUS (150+ colunas com códigos).

  Flags:
    --uf       Sigla da UF (ex: SP, AC). Obrigatório.
    --year     Ano >= 2005. Obrigatório.
    --month    Mês 1..12. Obrigatório.
    --top      Número de tipos no modo agregado (default: 15).
    --limit    Para de ler após N registros.
    --labeled  Projeta cada registro via labelEstabelecimento.
    --raw      Emite registros brutos (mutuamente exclusivo com --labeled).
    --format   json (default) ou jsonl. --raw/--labeled defaultam para jsonl.

  Exemplos:
    datasus-brasil cnes --uf AC --year 2024 --month 1
    datasus-brasil cnes --uf AC --year 2024 --month 1 --labeled --limit 3
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

  if (stream.raw || stream.labeled) {
    const project: (r: CnesEstabelecimentoRecord) => unknown = stream.labeled
      ? labelEstabelecimento
      : (r) => r;
    const projected: AsyncIterable<unknown> = map(source, project);

    if (stream.format === 'jsonl') {
      const n = await consumeStream(projected, stream.limit, emitJsonlRecord);
      process.stderr.write(`Emitidos ${n} registros.\n`);
      return;
    }
    const n = await emitJsonArrayStream(projected, stream.limit);
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

async function* map<T, U>(source: AsyncIterable<T>, fn: (item: T) => U): AsyncIterable<U> {
  for await (const item of source) yield fn(item);
}
