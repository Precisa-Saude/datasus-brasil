/**
 * Configuração do backend de dados.
 *
 * Em prod, os agregados vivem num bucket S3 público (sa-east-1) com
 * CORS permissivo. Em dev local, setar `VITE_DATA_BASE_URL=/data-local`
 * pra apontar pra `public/data-local/` durante iteração sem rede.
 */
// CloudFront distribution (dfdu08vi8wsus) serve do bucket S3
// `precisa-saude-datasus-brasil` via Origin Access Control. CDN
// absorve cache hits e corta custo/latência de Range Requests
// repetidos.
const RAW_BASE_URL = import.meta.env.VITE_DATA_BASE_URL ?? 'https://dfdu08vi8wsus.cloudfront.net';

// DuckDB WASM + httpfs precisa de URL absoluta — caminhos relativos
// (ex.: `/data-local`) caem no filesystem local do WASM e falham.
// Prepend origin quando o valor é relativo.
export const DATA_BASE_URL: string = RAW_BASE_URL.startsWith('/')
  ? `${typeof window === 'undefined' ? '' : window.location.origin}${RAW_BASE_URL}`
  : RAW_BASE_URL;

export const PMTILES_URL = `${DATA_BASE_URL}/geo/brasil.pmtiles`;
export const MANIFEST_URL = `${DATA_BASE_URL}/manifest/index.json`;

// Versão do prefixo `parquet-opt/` lida do manifest no boot do app.
// Mutável porque o valor não existe no tempo de import (manifest é
// async); inicializa vazia → URL legacy sem versionamento; após
// `setParquetOptVersion`, URLs viram `parquet-opt/<v>/...`. Ver
// postmortem 2026-05-18 em `aggregates.ts` AggregateIndex.parquetOptVersion.
let parquetOptVersion: string = '';

export function setParquetOptVersion(v: string | undefined): void {
  parquetOptVersion = v ?? '';
}

function parquetOptPrefix(): string {
  return parquetOptVersion === ''
    ? `${DATA_BASE_URL}/parquet-opt`
    : `${DATA_BASE_URL}/parquet-opt/${parquetOptVersion}`;
}

// Camada consolidada pelo `consolidate-parquet.ts` pra minimizar GETs
// S3: um arquivo nacional pequeno + um por UF (18 anos inline).
export function ufTotalsUrl(): string {
  return `${parquetOptPrefix()}/uf-totals.parquet`;
}
export function ufPartitionUrl(ufSigla: string): string {
  return `${parquetOptPrefix()}/uf=${ufSigla}/part.parquet`;
}

// Parquet bruto SIA-PA (1:1 com o DBC original do FTP DATASUS), exposto
// pelo mesmo CDN sob o prefixo `/sia-pa/`. Usado pelos detalhamentos
// que precisam de granularidade abaixo do agregado (ex.: quebra por
// CNES — coluna `PA_CODUNI` — não está no parquet-opt).
export function rawSiaPaUrl(ano: number, ufSigla: string, mes: number): string {
  const mesStr = String(mes).padStart(2, '0');
  return `${DATA_BASE_URL}/sia-pa/ano=${ano}/uf=${ufSigla}/mes=${mesStr}/part.parquet`;
}

// Artefatos pré-computados pelo `compute-anomalies.ts` — top-N hits
// por detector. Ficam committed em `site/public/anomalies/` e são
// regenerados a cada refresh do pipeline (semanal). Mesma origem que
// o site (relative URL) — não usa CDN porque é parte do bundle.
export function anomaliesUrl(kind: string): string {
  return `/anomalies/${kind}.json`;
}
