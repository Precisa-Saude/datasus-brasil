/**
 * Helpers de consumo de streams de registros com limite opcional e
 * emissão JSONL incremental pro modo `--raw`.
 */

import type { ParsedArgs } from './args.js';
import { UsageError } from './args.js';
import type { OutputFormat } from './output.js';
import { parseFormat } from './output.js';

export interface StreamOptions {
  format: OutputFormat;
  /** null = sem limite. */
  limit: null | number;
  raw: boolean;
}

export function parseStreamOptions(args: ParsedArgs): StreamOptions {
  const rawLimit = args.opts.get('limit');
  let limit: null | number = null;
  if (rawLimit !== undefined) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n <= 0) {
      throw new UsageError(
        `--limit deve ser inteiro positivo (ex: '--limit 100'), recebido: '${rawLimit}'`,
      );
    }
    limit = n;
  }
  const raw = args.bools.has('raw');
  // `--raw` sem `--format` defaulta pra jsonl (streaming-friendly).
  const formatRaw = args.opts.get('format') ?? (raw ? 'jsonl' : undefined);
  return { format: parseFormat(formatRaw), limit, raw };
}

/**
 * Consome um async iterable com limite opcional, invocando o callback
 * `onRecord` por registro. Retorna o total de registros consumidos.
 */
export async function consumeStream<T>(
  source: AsyncIterable<T>,
  limit: null | number,
  onRecord: (record: T) => void,
): Promise<number> {
  let n = 0;
  for await (const record of source) {
    onRecord(record);
    n++;
    if (limit !== null && n >= limit) break;
  }
  return n;
}

/**
 * Emite um registro como linha JSONL no stdout. Usado no modo `--raw
 * --format jsonl` (default do `--raw`) para saída de memória constante.
 */
export function emitJsonlRecord(record: unknown): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/**
 * Emite os registros do source como um único array JSON, streamando os
 * elementos incrementalmente para manter memória constante. Usado no
 * modo `--raw --format json`, que exige um array válido em stdout mas
 * não pode bufferizar todos os registros (CNES-ST chega a centenas de
 * milhares de linhas).
 */
export async function emitJsonArrayStream<T>(
  source: AsyncIterable<T>,
  limit: null | number,
): Promise<number> {
  let first = true;
  let n = 0;
  process.stdout.write('[');
  try {
    n = await consumeStream(source, limit, (record) => {
      process.stdout.write(first ? '' : ',');
      process.stdout.write(JSON.stringify(record));
      first = false;
    });
  } finally {
    // Fecha o array mesmo em erro mid-stream, produzindo JSON válido
    // (ainda que truncado) em vez de `[{...},{...}` sem fechamento.
    process.stdout.write(']\n');
  }
  return n;
}
