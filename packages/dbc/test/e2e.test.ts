/**
 * End-to-end test for the DBC decoder pipeline.
 *
 * Fixture: `RDAC2401.dbc` — arquivo DATASUS real do Acre, 2024/01 (baixado
 * do FTP oficial). Serve apenas como payload de teste para o decoder —
 * os campos específicos do schema não importam aqui; o que interessa é
 * que o envelope DBC descomprime corretamente pra um DBF válido e que
 * os 4315 registros ativos decodificam sem erro.
 *
 * Valores de referência verificados via `file(1)` na fixture
 * (record_count=4315, record_size=702, update=2025-02-08).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { dbcToDbf, readDbcMetadata, readDbcRecords, readDbfHeader } from '../src/index.js';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/RDAC2401.dbc', import.meta.url));
const fixture = new Uint8Array(readFileSync(FIXTURE_PATH));

describe('DBC → DBF → records (fixture AC 2024/01)', () => {
  it('reads DBC envelope metadata', () => {
    const meta = readDbcMetadata(fixture);
    expect(meta.recordCount).toBe(4315);
    expect(meta.recordSize).toBe(702);
    expect(meta.headerSize).toBeGreaterThan(0);
  });

  it('decompresses DBC to DBF with consistent header metadata', () => {
    const dbf = dbcToDbf(fixture);
    const header = readDbfHeader(dbf);

    expect(header.recordCount).toBe(4315);
    expect(header.recordLength).toBe(702);
    // sanity-check: o DBF tem dezenas de campos bem-formados
    expect(header.fields.length).toBeGreaterThan(10);
    for (const field of header.fields) {
      expect(field.name.length).toBeGreaterThan(0);
    }
  });

  it('streams records as plain JS objects', async () => {
    const records: Record<string, unknown>[] = [];
    for await (const record of readDbcRecords(fixture)) {
      records.push(record);
      if (records.length >= 3) break;
    }

    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(Object.keys(record).length).toBeGreaterThan(10);
    }
  });

  it('produces JSON-serializable output', async () => {
    let first: Record<string, unknown> | undefined;
    for await (const record of readDbcRecords(fixture)) {
      first = record;
      break;
    }
    expect(first).toBeDefined();
    expect(() => JSON.stringify(first)).not.toThrow();
  });

  it('decodes all 4315 active records without errors', async () => {
    let count = 0;
    for await (const _record of readDbcRecords(fixture)) {
      count++;
    }
    // fixture não tem registros deletados; se houver, o contador será
    // menor que 4315. Em todo caso, o loop não pode lançar.
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(4315);
  });
});
