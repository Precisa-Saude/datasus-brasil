/**
 * Configuração do backend de dados.
 *
 * Em prod, os agregados vivem num bucket S3 público (sa-east-1) com
 * CORS permissivo. Em dev local, setar `VITE_DATA_BASE_URL=/data-local`
 * pra apontar pra `public/data-local/` durante iteração sem rede.
 */
export const DATA_BASE_URL =
  import.meta.env.VITE_DATA_BASE_URL ??
  'https://precisa-saude-datasus-brasil.s3.sa-east-1.amazonaws.com';

export const PMTILES_URL = `${DATA_BASE_URL}/geo/brasil.pmtiles`;
export const MANIFEST_URL = `${DATA_BASE_URL}/manifest/index.json`;

// Camada consolidada pelo `consolidate-parquet.ts` pra minimizar GETs
// S3: um arquivo nacional pequeno + um por UF (18 anos inline).
export const UF_TOTALS_PARQUET = `${DATA_BASE_URL}/parquet-opt/uf-totals.parquet`;
export function ufPartitionUrl(ufSigla: string): string {
  return `${DATA_BASE_URL}/parquet-opt/uf=${ufSigla}/part.parquet`;
}
