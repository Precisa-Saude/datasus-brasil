/**
 * Unit tests para os caminhos de erro e branches do decoder DBC/DBF.
 *
 * O teste e2e cobre o happy path. Este arquivo foca em rejeições de
 * input malformado e nos ramos dos decoders por tipo (L, D, I, etc.)
 * que só exercitam com buffers construídos à mão.
 */

import { describe, expect, it } from 'vitest';

import { dbcToDbf, readDbcMetadata } from '../src/dbc.js';
import type { DbfField } from '../src/dbf.js';
import { readDbfHeader, readDbfRecords } from '../src/dbf.js';

/**
 * Constrói um header DBF mínimo com 1 campo. O caller pode truncar ou
 * adulterar o resultado para simular corrupções específicas.
 */
function buildDbfHeader(field: {
  decimalCount?: number;
  length: number;
  name: string;
  type: string;
}): Uint8Array {
  const headerLength = 32 + 32 + 1; // fixed header + 1 field descriptor + 0x0D terminator
  const buf = new Uint8Array(headerLength);
  const view = new DataView(buf.buffer);

  buf[0] = 0x03; // dBase III
  buf[1] = 125; // 2025
  buf[2] = 1;
  buf[3] = 1;
  view.setUint32(4, 0, true); // recordCount
  view.setUint16(8, headerLength, true);
  view.setUint16(10, field.length + 1, true); // +1 for delete marker

  // Field descriptor at offset 32
  for (let i = 0; i < field.name.length && i < 11; i++) {
    buf[32 + i] = field.name.charCodeAt(i);
  }
  buf[32 + 11] = field.type.charCodeAt(0);
  buf[32 + 16] = field.length;
  buf[32 + 17] = field.decimalCount ?? 0;

  buf[64] = 0x0d; // terminator
  return buf;
}

describe('readDbcMetadata — input rejection', () => {
  it('throws on files smaller than the minimum DBF header', () => {
    const tiny = new Uint8Array(10);
    expect(() => readDbcMetadata(tiny)).toThrow(/too small/);
  });

  it('throws when the header claims more bytes than the envelope contains', () => {
    // 32 bytes total, but header declares headerSize=200 → envelope truncated.
    const buf = new Uint8Array(32);
    const view = new DataView(buf.buffer);
    view.setUint16(8, 200, true);
    expect(() => readDbcMetadata(buf)).toThrow(/truncated/);
  });
});

describe('readDbfHeader — input rejection', () => {
  it('throws on DBFs smaller than 32 bytes', () => {
    expect(() => readDbfHeader(new Uint8Array(10))).toThrow(/too small/);
  });

  it('throws on unsupported field types', () => {
    const header = buildDbfHeader({ length: 4, name: 'WEIRD', type: 'Y' });
    expect(() => readDbfHeader(header)).toThrow(/unsupported type 'Y'/);
  });

  it('throws when field descriptors run off the end of the buffer', () => {
    // headerLength declared 100 but only 50 bytes supplied → field descriptor
    // parser runs past end.
    const buf = new Uint8Array(50);
    const view = new DataView(buf.buffer);
    view.setUint16(8, 100, true);
    // Deixa offset 32 com um byte qualquer diferente de 0x0D e 0x00 para
    // forçar entrada no loop de descritores.
    buf[32] = 0x41;
    expect(() => readDbfHeader(buf)).toThrow(/truncated reading field descriptors/);
  });

  it('stops field iteration on 0x00 padding (DATASUS CNES variant)', () => {
    // Valid header with 0x00 at field-descriptor start → empty field list.
    const buf = new Uint8Array(65);
    const view = new DataView(buf.buffer);
    buf[0] = 0x03;
    view.setUint16(8, 65, true);
    view.setUint16(10, 1, true);
    // offset 32 fica 0x00 → loop sai sem erro
    buf[64] = 0x0d;

    const header = readDbfHeader(buf);
    expect(header.fields).toHaveLength(0);
  });
});

describe('readDbfRecords — record-region rejection', () => {
  it('throws when the record region is truncated mid-stream', async () => {
    const header = buildDbfHeader({ length: 4, name: 'F', type: 'C' });
    // Declara 5 registros mas não fornece bytes para eles.
    const view = new DataView(header.buffer);
    view.setUint32(4, 5, true);

    await expect(async () => {
      for await (const _ of readDbfRecords(header)) void _;
    }).rejects.toThrow(/DBF truncated/);
  });
});

describe('decodeField — per-type edge cases', () => {
  async function decodeOneRecord(field: DbfField, valueBytes: Uint8Array): Promise<unknown> {
    // Monta um DBF completo com 1 field + 1 record contendo o valor dado.
    const header = buildDbfHeader(field);
    const view = new DataView(header.buffer);
    view.setUint32(4, 1, true); // recordCount = 1

    const record = new Uint8Array(1 + field.length);
    record[0] = 0x20; // ' ' = active
    record.set(valueBytes, 1);

    const full = new Uint8Array(header.length + record.length);
    full.set(header, 0);
    full.set(record, header.length);

    for await (const r of readDbfRecords(full)) {
      return (r as Record<string, unknown>)[field.name];
    }
    throw new Error('no record yielded');
  }

  it('returns null for an empty C field', async () => {
    const v = await decodeOneRecord(
      { decimalCount: 0, length: 4, name: 'C', type: 'C' },
      new Uint8Array([0x20, 0x20, 0x20, 0x20]),
    );
    expect(v).toBeNull();
  });

  it('returns null for an empty N field', async () => {
    const v = await decodeOneRecord(
      { decimalCount: 0, length: 4, name: 'N', type: 'N' },
      new Uint8Array([0x20, 0x20, 0x20, 0x20]),
    );
    expect(v).toBeNull();
  });

  it('returns null for a N field containing "*" (DATASUS sentinel)', async () => {
    const v = await decodeOneRecord(
      { decimalCount: 0, length: 1, name: 'N', type: 'N' },
      new Uint8Array([0x2a]),
    );
    expect(v).toBeNull();
  });

  it('returns null for a non-numeric N field', async () => {
    const v = await decodeOneRecord(
      { decimalCount: 0, length: 3, name: 'N', type: 'N' },
      new TextEncoder().encode('abc'),
    );
    expect(v).toBeNull();
  });

  it('parses a valid D field as UTC date', async () => {
    const v = await decodeOneRecord(
      { decimalCount: 0, length: 8, name: 'D', type: 'D' },
      new TextEncoder().encode('20240315'),
    );
    expect(v).toBeInstanceOf(Date);
    expect((v as Date).toISOString()).toBe('2024-03-15T00:00:00.000Z');
  });

  it('returns null for an empty D field', async () => {
    const v = await decodeOneRecord(
      { decimalCount: 0, length: 8, name: 'D', type: 'D' },
      new Uint8Array([0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]),
    );
    expect(v).toBeNull();
  });

  it('returns null for a malformed D field (non-digits)', async () => {
    const v = await decodeOneRecord(
      { decimalCount: 0, length: 8, name: 'D', type: 'D' },
      new TextEncoder().encode('20XX0315'),
    );
    expect(v).toBeNull();
  });

  it.each([
    ['T', true],
    ['t', true],
    ['Y', true],
    ['y', true],
    ['F', false],
    ['f', false],
    ['N', false],
    ['n', false],
    ['?', null],
    [' ', null],
  ])('decodes L field %s → %s', async (ch, expected) => {
    const v = await decodeOneRecord(
      { decimalCount: 0, length: 1, name: 'L', type: 'L' },
      new Uint8Array([ch.charCodeAt(0)]),
    );
    expect(v).toBe(expected);
  });

  it('decodes an I (VFP integer) field', async () => {
    // 4 bytes LE signed — 0x01000000 = 1
    const v = await decodeOneRecord(
      { decimalCount: 0, length: 4, name: 'I', type: 'I' },
      new Uint8Array([0x01, 0x00, 0x00, 0x00]),
    );
    expect(v).toBe(1);
  });
});

describe('dbcToDbf — envelope-level checks', () => {
  it('propagates readDbcMetadata rejection', () => {
    expect(() => dbcToDbf(new Uint8Array(5))).toThrow(/too small/);
  });
});
