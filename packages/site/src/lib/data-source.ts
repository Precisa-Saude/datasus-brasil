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

// Camada consolidada pelo `consolidate-parquet.ts` pra minimizar GETs
// S3: um arquivo nacional pequeno + um por UF (18 anos inline).
export const UF_TOTALS_PARQUET = `${DATA_BASE_URL}/parquet-opt/uf-totals.parquet`;
export function ufPartitionUrl(ufSigla: string): string {
  return `${DATA_BASE_URL}/parquet-opt/uf=${ufSigla}/part.parquet`;
}
