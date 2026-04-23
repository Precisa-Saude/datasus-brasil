/**
 * `datasus-brasil sia` — baixa SIA-PA (Produção Ambulatorial) UF × ano
 * × mês em streaming.
 *
 * Modos:
 *   default            → agrega top-N procedimentos (SIGTAP) com rótulo
 *   --labeled          → projeta cada registro via `labelProducaoAmbulatorial`
 *   --raw              → emite registros brutos do DATASUS (60 colunas)
 *
 * Flags opt-in para biomarcadores:
 *   --laboratory       → filtra só SIGTAP grupo 02.02 (laboratório clínico)
 *   --enrich-loinc     → anexa `{ loinc, biomarker }` quando SIGTAP
 *                        tiver equivalência no catálogo
 */

import type { SiaProducaoAmbulatorialRecord } from '@precisa-saude/datasus';
import {
  enrichWithLoinc,
  isSigtapLaboratorio,
  labelProducaoAmbulatorial,
  lookupSigtap,
  sia,
  sigtapToLoinc,
  topN,
} from '@precisa-saude/datasus';

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

export const SIA_USAGE = `datasus-brasil sia --uf <UF> --year <YYYY> --month <MM> [--top N] [--limit N] [--raw|--labeled] [--laboratory] [--enrich-loinc] [--format json|jsonl]

  Baixa SIA-PA (Produção Ambulatorial) em streaming.

  Default:         emite os N procedimentos (SIGTAP) mais frequentes
                   com rótulo pt-BR. Quando combinado com --enrich-loinc,
                   anexa LOINC/biomarcador ao agregado.
  --labeled:       emite cada registro com campos decodificados em pt-BR
                   (estabelecimento, município, procedimento, CBO, ...).
  --raw:           emite registros brutos do DATASUS (60 colunas PA_*).

  Flags:
    --uf             Sigla da UF (ex: SP, AC). Obrigatório.
    --year           Ano >= 2008. Obrigatório.
    --month          Mês 1..12. Obrigatório.
    --top            Número de procedimentos no modo agregado (default: 15).
    --limit          Para de ler após N registros.
    --labeled        Projeta cada registro via labelProducaoAmbulatorial.
    --raw            Emite registros brutos (mutuamente exclusivo com --labeled).
    --laboratory     Filtra só SIGTAP grupo 02.02 (laboratório clínico).
    --enrich-loinc   Anexa mapeamento LOINC quando SIGTAP tiver equivalência.
    --format         json (default) ou jsonl. --raw/--labeled defaultam para jsonl.

  Exemplos:
    datasus-brasil sia --uf AC --year 2024 --month 1
    datasus-brasil sia --uf AC --year 2024 --month 1 --laboratory --enrich-loinc --top 10
    datasus-brasil sia --uf SP --year 2024 --month 1 --labeled --limit 3`;

export async function runSia(args: ParsedArgs): Promise<void> {
  const uf = requireOpt(args, 'uf');
  const year = requireInt(args, 'year');
  const month = requireInt(args, 'month');
  const top = optInt(args, 'top', 15);
  const laboratory = args.bools.has('laboratory');
  const enrichLoinc = args.bools.has('enrich-loinc');
  const stream = parseStreamOptions(args);

  const label = `SIA-PA ${uf}/${year}/${String(month).padStart(2, '0')}`;
  const onProgress = createProgressReporter(label);
  const raw = sia.streamProducaoAmbulatorial({ ftp: { onProgress }, month, uf, year });
  const source = laboratory ? filterLaboratorioStream(raw) : raw;

  if (stream.raw || stream.labeled) {
    const project = buildProjector({ enrichLoinc, labeled: stream.labeled });
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

  // Modo agregado: top-N procedimentos por SIGTAP com rótulo.
  const counts: Record<string, number> = {};
  const n = await consumeStream(source, stream.limit, (r) => {
    const proc = typeof r.PA_PROC_ID === 'string' ? r.PA_PROC_ID : null;
    if (!proc) return;
    counts[proc] = (counts[proc] ?? 0) + 1;
  });
  process.stderr.write(`Processados ${n} registros.\n`);

  const aggregated = topN(counts, top).map((entry) => {
    const rotulo = lookupSigtap(entry.key)?.name ?? null;
    if (!enrichLoinc) {
      return { count: entry.count, procedimento: entry.key, rotulo };
    }
    const mapping = sigtapToLoinc(entry.key);
    return {
      biomarker: mapping?.biomarker ?? null,
      count: entry.count,
      loinc: mapping?.loinc ?? null,
      procedimento: entry.key,
      rotulo,
    };
  });

  emit(aggregated, stream.format);
}

function buildProjector(options: {
  enrichLoinc: boolean;
  labeled: boolean;
}): (r: SiaProducaoAmbulatorialRecord) => unknown {
  const { enrichLoinc, labeled } = options;
  if (labeled) {
    if (enrichLoinc) {
      return (r) => enrichWithLoinc({ ...labelProducaoAmbulatorial(r), PA_PROC_ID: r.PA_PROC_ID });
    }
    return labelProducaoAmbulatorial;
  }
  if (enrichLoinc) return (r) => enrichWithLoinc(r);
  return (r) => r;
}

async function* filterLaboratorioStream(
  source: AsyncIterable<SiaProducaoAmbulatorialRecord>,
): AsyncIterable<SiaProducaoAmbulatorialRecord> {
  for await (const record of source) {
    if (isSigtapLaboratorio(record.PA_PROC_ID)) yield record;
  }
}

async function* map<T, U>(source: AsyncIterable<T>, fn: (item: T) => U): AsyncIterable<U> {
  for await (const item of source) yield fn(item);
}
