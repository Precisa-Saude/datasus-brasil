/**
 * Emissores de saída — JSON-first (default) e JSONL para streaming.
 * CSV não é suportado neste MVP de CLI (ver CLAUDE.md).
 */

import { UsageError } from './args.js';

export type OutputFormat = 'json' | 'jsonl';

export function parseFormat(raw: string | undefined): OutputFormat {
  if (raw === undefined) return 'json';
  if (raw === 'json' || raw === 'jsonl') return raw;
  throw new UsageError(`--format inválido: '${raw}' (esperado: json, jsonl)`);
}

export function emit(records: unknown[], format: OutputFormat): void {
  if (format === 'jsonl') {
    for (const r of records) {
      process.stdout.write(`${JSON.stringify(r)}\n`);
    }
  } else {
    process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
  }
}
