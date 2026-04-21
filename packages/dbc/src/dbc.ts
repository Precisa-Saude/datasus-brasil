/**
 * Envelope parser for DATASUS `.dbc` files.
 *
 * The DBC format is a thin wrapper around a standard xBase DBF: the DBF
 * header is stored uncompressed (so consumers can inspect the schema without
 * decompressing records), and the record data is compressed with PKWARE DCL
 * Implode.
 *
 * Layout (verified against real DATASUS DBC files via hex inspection — Petruzalek's
 * `DBC_FORMAT.md` offsets are shifted by 10 relative to what the files actually
 * contain; the DBF header occupies the start of the DBC, not starting at offset 10):
 *
 * ```
 *   offset        | size | field
 *   --------------+------+-----------------------------------------
 *   0             | H    | uncompressed DBF header — same bytes as a
 *                 |      | normal DBF header: version, date, record
 *                 |      | count (offset 4), header size H (offset 8,
 *                 |      | LE uint16), record length (offset 10),
 *                 |      | field descriptors, 0x0D terminator
 *   H             | 4    | padding / checksum (ignored)
 *   H+4           | ...  | DCL-imploded record data
 * ```
 *
 * Output: a complete DBF byte stream that any xBase reader can consume.
 */

import { implodeDecompress } from './implode.js';

/**
 * Parsed DBF header metadata extracted from the first 32 bytes of the DBF
 * header (which live in the DBC envelope uncompressed).
 */
export interface DbfHeaderInfo {
  /** Size of the full DBF header in bytes, from bytes 8..9 (LE uint16). */
  headerSize: number;
  /** Number of records, from bytes 4..7 of the DBF header (LE uint32). */
  recordCount: number;
  /** Size of one record in bytes, from bytes 10..11 of the DBF header (LE uint16). */
  recordSize: number;
}

/**
 * Extract DBF metadata from a `.dbc` envelope without decompressing records.
 * Useful for inspecting the schema of large DBC files cheaply.
 */
export function readDbcMetadata(dbc: Uint8Array): DbfHeaderInfo {
  if (dbc.length < 32) {
    throw new Error(`DBC file too small (${dbc.length} bytes) — cannot contain a DBF header`);
  }

  // The DBF header starts at DBC offset 0 (same layout as a plain DBF).
  const view = new DataView(dbc.buffer, dbc.byteOffset, dbc.byteLength);
  const headerSize = view.getUint16(8, /* littleEndian */ true);

  if (dbc.length < headerSize + 4) {
    throw new Error(
      `DBC file truncated: header declares ${headerSize} bytes but envelope is only ${dbc.length} bytes`,
    );
  }

  const recordCount = view.getUint32(4, true);
  const recordSize = view.getUint16(10, true);

  return { headerSize, recordCount, recordSize };
}

/**
 * Decompress a `.dbc` file to its equivalent `.dbf` byte stream.
 *
 * The resulting buffer can be written to disk and opened by any xBase tool,
 * or fed to a DBF reader in memory (e.g. `dbffile`).
 *
 * @param dbc - raw bytes of a `.dbc` file
 * @returns the full decompressed DBF: header + records
 */
export function dbcToDbf(dbc: Uint8Array): Uint8Array {
  const { headerSize, recordCount, recordSize } = readDbcMetadata(dbc);

  const dbfHeader = dbc.subarray(0, headerSize);
  const compressed = dbc.subarray(headerSize + 4);

  // DBF record region = N records of recordSize bytes each + 1 byte EOF (0x1A).
  const expectedRecordsSize = recordCount * recordSize + 1;
  const records = implodeDecompress(compressed, expectedRecordsSize);

  const output = new Uint8Array(dbfHeader.length + records.length);
  output.set(dbfHeader, 0);
  output.set(records, dbfHeader.length);
  return output;
}
