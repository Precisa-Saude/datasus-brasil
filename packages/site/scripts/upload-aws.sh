#!/usr/bin/env bash
#
# Publica `build/parquet/**` + `build/geo/brasil.pmtiles` + manifest
# no bucket S3 público do projeto (`precisa-saude-datasus-brasil`, sa-east-1).
#
# Convenção de URL:
#   https://precisa-saude-datasus-brasil.s3.sa-east-1.amazonaws.com/
#     geo/brasil.pmtiles
#     parquet/ano=YYYY/uf=XX/part.parquet
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

echo "→ upload Parquet particionado"
if [[ -d "$BUILD_DIR/parquet" ]]; then
  aws s3 sync "$BUILD_DIR/parquet" "s3://$BUCKET/parquet" \
    --delete \
    --cache-control "public, max-age=31536000, immutable" \
    --exclude "*.ndjson"
fi

echo "→ upload manifest"
if [[ -f "$BUILD_DIR/manifest/index.json" ]]; then
  aws s3 cp "$BUILD_DIR/manifest/index.json" "s3://$BUCKET/manifest/index.json" \
    --content-type "application/json" \
    --cache-control "public, max-age=3600"
fi

echo "✓ upload concluído"
echo "  Base URL: https://$BUCKET.s3.sa-east-1.amazonaws.com/"
