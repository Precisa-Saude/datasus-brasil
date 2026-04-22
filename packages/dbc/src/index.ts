/**
 * @precisa-saude/datasus-dbc — decoder puro TS/JS de arquivos `.dbc` do DATASUS.
 *
 * Zero dependências runtime, browser + Node compatível. Três camadas:
 *
 * - `implodeDecompress` — descompressão pura PKWARE DCL Implode
 * - `dbcToDbf` — parse do envelope DBC + descompressão → bytes DBF completos
 * - `readDbcRecords` — iterador assíncrono sobre registros como objetos JS
 *
 * Referências:
 * - Mark Adler, `blast.c`: https://github.com/madler/zlib/blob/master/contrib/blast/blast.c
 * - Daniela Petruzalek, `DBC_FORMAT.md`: https://github.com/danicat/read.dbc/blob/master/DBC_FORMAT.md
 */

import { dbcToDbf } from './dbc.js';
import type { DbfRecord, ReadDbfOptions } from './dbf.js';
import { readDbfRecords } from './dbf.js';

export type { DbfHeaderInfo } from './dbc.js';
export { dbcToDbf, readDbcMetadata } from './dbc.js';
export type { DbfField, DbfHeader, DbfRecord, DbfValue, ReadDbfOptions } from './dbf.js';
export { readDbfHeader, readDbfRecords } from './dbf.js';
export { implodeDecompress } from './implode.js';

export const VERSION = '0.1.0';

/**
 * End-to-end: DBC bytes → stream of records as JS objects.
 *
 * Equivalent to `dbcToDbf` followed by `readDbfRecords`, but the composed
 * function is the primary entry point for consumers.
 *
 * @param dbc - raw bytes of a DATASUS `.dbc` file
 * @param options - encoding and delete-inclusion flags
 */
export async function* readDbcRecords(
  dbc: Uint8Array,
  options: ReadDbfOptions = {},
): AsyncIterable<DbfRecord> {
  const dbf = dbcToDbf(dbc);
  yield* readDbfRecords(dbf, options);
}
