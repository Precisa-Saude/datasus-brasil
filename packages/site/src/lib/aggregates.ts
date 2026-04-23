/**
 * Tipos dos agregados SIA-PA consumidos pelo site.
 *
 * Fonte em prod: Parquet particionado em Hive-style
 * (`ano=YYYY/uf=XX/part.parquet`) no bucket S3 público — o site lê
 * via DuckDB WASM + `read_parquet` com pushdown por partição.
 */

/** Linha de agregado por UF × LOINC × competência. */
export interface UfAggregate {
  competencia: string;
  loinc: string;
  ufSigla: string;
  valorAprovadoBRL: number;
  volumeExames: number;
}

/** Linha de agregado por município × LOINC × competência. */
export interface MunicipioAggregate {
  competencia: string;
  loinc: string;
  municipioCode: string;
  municipioNome: string;
  valorAprovadoBRL: number;
  volumeExames: number;
}

/** Manifesto publicado junto com os Parquet (metadados globais). */
export interface AggregateIndex {
  availableUFs: string[];
  biomarkers: Array<{ code: string; display: string; loinc: string }>;
  competencias: string[];
  geradoEm: string;
  years: number[];
}
