/**
 * Minimal xBase DBF reader, in-memory and browser-compatible.
 *
 * Built to consume the output of `dbcToDbf` — i.e. the subset of DBF features
 * DATASUS actually produces (dBase III / Visual FoxPro with C / N / D / L / I
 * field types). We intentionally do NOT support memo fields, writing, or the
 * full dBase IV/VFP9 surface — those are outside DATASUS's scope.
 *
 * Reference: xBase DBF format spec (public domain, documented widely). Field
 * layout at offset 32 onwards, terminator 0x0D, records use space prefix for
 * active and asterisk for deleted.
 */

/** Supported DBF field types. DATASUS uses only these. */
export type DbfFieldType = 'C' | 'N' | 'F' | 'D' | 'L' | 'I';

export interface DbfField {
  /** Decimal count (only meaningful for N and F). */
  decimalCount: number;
  /** Field length in bytes. */
  length: number;
  /** Field name (uppercase, up to 10 chars). */
  name: string;
  /** xBase field type code. */
  type: DbfFieldType;
}

export interface DbfHeader {
  /** Date of last update, as a JS Date at UTC midnight. */
  dateOfLastUpdate: Date;
  /** Field descriptors in declaration order. */
  fields: DbfField[];
  /** Length of the header in bytes (including field descriptors + terminator). */
  headerLength: number;
  /** Total number of records (including deleted). */
  recordCount: number;
  /** Length of one record in bytes (including the 1-byte delete marker). */
  recordLength: number;
  /** xBase version byte (e.g. 0x03 for dBase III, 0x30 for Visual FoxPro). */
  version: number;
}

export interface ReadDbfOptions {
  /** Text encoding for character fields. Defaults to 'windows-1252' (DATASUS convention). */
  encoding?: 'windows-1252' | 'iso-8859-1' | 'utf-8';
  /** Include records marked deleted (prefix '*'). Defaults to false. */
  includeDeleted?: boolean;
}

/** A decoded DBF record — plain JS object with field names as keys. */
export type DbfRecord = Record<string, DbfValue>;

/** The possible decoded values for DATASUS's field types. */
export type DbfValue = string | number | Date | boolean | null;

const TERMINATOR = 0x0d;

/**
 * Parse the DBF header (offsets 0..headerLength-1) from a byte buffer.
 * Throws if the header is malformed or uses unsupported field types.
 */
export function readDbfHeader(dbf: Uint8Array): DbfHeader {
  if (dbf.length < 32) {
    throw new Error(`DBF too small: ${dbf.length} bytes (need >= 32 for header)`);
  }

  const view = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const version = dbf[0]!;
  const year = dbf[1]!;
  const month = dbf[2]!;
  const day = dbf[3]!;
  const recordCount = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);

  // dBase II-IV stored years as YY with 1900 base; VFP stores as years since
  // 1900 too. For DATASUS (dBase III / VFP) this is consistent.
  const dateOfLastUpdate = new Date(Date.UTC(1900 + year, month - 1, day));

  const fields: DbfField[] = [];
  let offset = 32;
  // dBase III termina descritores com 0x0D; algumas variantes do DATASUS (CNES)
  // usam padding 0x00 antes do final do header. Qualquer dos dois encerra
  // a iteração — um "nome de campo" começando em 0x00 não existe.
  while (offset < headerLength - 1 && dbf[offset] !== TERMINATOR && dbf[offset] !== 0x00) {
    if (offset + 32 > dbf.length) {
      throw new Error(`DBF header truncated reading field descriptors at offset ${offset}`);
    }
    const name = decodeFieldName(dbf.subarray(offset, offset + 11));
    const type = String.fromCharCode(dbf[offset + 11]!) as DbfFieldType;
    const length = dbf[offset + 16]!;
    const decimalCount = dbf[offset + 17]!;

    if (!isSupportedFieldType(type)) {
      throw new Error(
        `DBF field '${name}' has unsupported type '${type}' (only C/N/F/D/L/I are supported)`,
      );
    }

    fields.push({ decimalCount, length, name, type });
    offset += 32;
  }

  return { dateOfLastUpdate, fields, headerLength, recordCount, recordLength, version };
}

/**
 * Async iterable over DBF records as JS objects. Skips deleted records by
 * default. The yielded objects are JSON-serializable without modification.
 *
 * @param dbf - complete DBF bytes (header + records), as produced by `dbcToDbf`
 * @param options - encoding and delete-inclusion flags
 */
export async function* readDbfRecords(
  dbf: Uint8Array,
  options: ReadDbfOptions = {},
): AsyncIterable<DbfRecord> {
  const header = readDbfHeader(dbf);
  const encoding = options.encoding ?? 'windows-1252';
  const includeDeleted = options.includeDeleted ?? false;
  const decoder = new TextDecoder(encoding);

  let offset = header.headerLength;
  for (let i = 0; i < header.recordCount; i++) {
    if (offset + header.recordLength > dbf.length) {
      // EOF reached before all records consumed — some DBF writers omit the
      // final EOF byte; others truncate. Log-ish behavior here would hide
      // real corruption, so we fail loudly.
      throw new Error(
        `DBF truncated: expected ${header.recordCount} records, read ${i} before running out of bytes`,
      );
    }
    const marker = dbf[offset]!;
    const isDeleted = marker === 0x2a; // '*'

    if (!isDeleted || includeDeleted) {
      const record = decodeRecord(
        dbf.subarray(offset + 1, offset + header.recordLength),
        header.fields,
        decoder,
      );
      if (isDeleted) {
        Object.defineProperty(record, '__deleted', { enumerable: true, value: true });
      }
      yield record;
    }

    offset += header.recordLength;
  }
}

function isSupportedFieldType(type: string): type is DbfFieldType {
  return (
    type === 'C' || type === 'N' || type === 'F' || type === 'D' || type === 'L' || type === 'I'
  );
}

function decodeFieldName(bytes: Uint8Array): string {
  // Field names are ASCII, null-terminated within 11 bytes.
  let end = bytes.indexOf(0);
  if (end === -1) end = bytes.length;
  let name = '';
  for (let i = 0; i < end; i++) {
    name += String.fromCharCode(bytes[i]!);
  }
  return name;
}

function decodeRecord(bytes: Uint8Array, fields: DbfField[], decoder: TextDecoder): DbfRecord {
  const record: DbfRecord = {};
  let offset = 0;
  for (const field of fields) {
    const raw = bytes.subarray(offset, offset + field.length);
    record[field.name] = decodeField(raw, field, decoder);
    offset += field.length;
  }
  return record;
}

function decodeField(raw: Uint8Array, field: DbfField, decoder: TextDecoder): DbfValue {
  switch (field.type) {
    case 'C': {
      // Character: trim trailing spaces (DBF convention). Empty → null.
      const text = decoder.decode(raw).replace(/ +$/, '');
      return text === '' ? null : text;
    }
    case 'N':
    case 'F': {
      // Numeric / Float: stored as ASCII decimal, right-aligned, space-padded.
      const text = decoder.decode(raw).trim();
      if (text === '' || text === '*') return null;
      const num = Number(text);
      return Number.isFinite(num) ? num : null;
    }
    case 'I': {
      // Integer: 4-byte little-endian signed int (Visual FoxPro).
      if (raw.length < 4) return null;
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      return view.getInt32(0, true);
    }
    case 'D': {
      // Date: 8 bytes ASCII "YYYYMMDD". Empty → null.
      const text = decoder.decode(raw).trim();
      if (text === '' || text.length !== 8 || !/^\d{8}$/.test(text)) return null;
      const year = Number(text.slice(0, 4));
      const month = Number(text.slice(4, 6));
      const day = Number(text.slice(6, 8));
      return new Date(Date.UTC(year, month - 1, day));
    }
    case 'L': {
      // Logical: 1 byte, T/t/Y/y = true; F/f/N/n = false; ?/space = null.
      const c = String.fromCharCode(raw[0]!).toUpperCase();
      if (c === 'T' || c === 'Y') return true;
      if (c === 'F' || c === 'N') return false;
      return null;
    }
  }
}
