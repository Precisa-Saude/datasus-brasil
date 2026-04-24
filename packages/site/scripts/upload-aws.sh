#!/usr/bin/env bash
#
# Publica `build/parquet-opt/**` + `build/geo/brasil.pmtiles` +
# manifest no bucket S3 público do projeto
# (`precisa-saude-datasus-brasil`, sa-east-1).
#
# Convenção de URL (o site lê só do parquet-opt — consolidado):
#   https://precisa-saude-datasus-brasil.s3.sa-east-1.amazonaws.com/
#     geo/brasil.pmtiles
#     parquet-opt/uf-totals.parquet            ← agregado nacional
#     parquet-opt/uf=XX/part.parquet           ← UF consolidada (todos anos)
#     manifest/index.json
#
# Cache-Control generoso (1 ano immutable) pra Parquet + PMTiles;
# manifest é menor TTL (1 hora) pra permitir recarregar após aggregate.

set -euo pipefail

BUCKET="${BUCKET:-precisa-saude-datasus-brasil}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$SITE_DIR/build"

echo "→ upload PMTiles"
if [[ -f "$BUILD_DIR/geo/brasil.pmtiles" ]]; then
  aws s3 cp "$BUILD_DIR/geo/brasil.pmtiles" "s3://$BUCKET/geo/brasil.pmtiles" \
    --content-type "application/vnd.pmtiles" \
    --cache-control "public, max-age=31536000, immutable"
fi

echo "→ upload Parquet consolidado (parquet-opt/)"
if [[ -d "$BUILD_DIR/parquet-opt" ]]; then
  aws s3 sync "$BUILD_DIR/parquet-opt" "s3://$BUCKET/parquet-opt" \
    --delete \
    --cache-control "public, max-age=31536000, immutable"
fi

echo "→ upload manifest"
if [[ -f "$BUILD_DIR/manifest/index.json" ]]; then
  aws s3 cp "$BUILD_DIR/manifest/index.json" "s3://$BUCKET/manifest/index.json" \
    --content-type "application/json" \
    --cache-control "public, max-age=3600"
fi

echo "✓ upload concluído"
echo "  Base URL: https://$BUCKET.s3.sa-east-1.amazonaws.com/"
