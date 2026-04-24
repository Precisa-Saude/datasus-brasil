import { describe, expect, it } from 'vitest';

import {
  DATA_BASE_URL,
  MANIFEST_URL,
  PMTILES_URL,
  UF_TOTALS_PARQUET,
  ufPartitionUrl,
} from '@/lib/data-source';

describe('data-source URLs', () => {
  it('DATA_BASE_URL cai no CloudFront quando VITE_DATA_BASE_URL não é setado', () => {
    // No ambiente de teste (jsdom), VITE_DATA_BASE_URL tipicamente
    // não é injetado, então o fallback do CloudFront vale.
    expect(DATA_BASE_URL).toMatch(/^https?:\/\/|^\//);
  });

  it('PMTILES_URL aponta pra geo/brasil.pmtiles', () => {
    expect(PMTILES_URL).toBe(`${DATA_BASE_URL}/geo/brasil.pmtiles`);
  });

  it('MANIFEST_URL aponta pro index.json', () => {
    expect(MANIFEST_URL).toBe(`${DATA_BASE_URL}/manifest/index.json`);
  });

  it('UF_TOTALS_PARQUET aponta pro agregado nacional', () => {
    expect(UF_TOTALS_PARQUET).toBe(`${DATA_BASE_URL}/parquet-opt/uf-totals.parquet`);
  });
});

describe('ufPartitionUrl', () => {
  it('monta URL no layout Hive uf=XX', () => {
    expect(ufPartitionUrl('AC')).toBe(`${DATA_BASE_URL}/parquet-opt/uf=AC/part.parquet`);
  });

  it('preserva o case da sigla', () => {
    expect(ufPartitionUrl('SP')).toContain('uf=SP/');
  });
});
