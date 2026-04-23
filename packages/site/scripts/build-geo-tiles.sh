#!/usr/bin/env bash
#
# Gera um único .pmtiles com UFs + municípios do Brasil a partir de
# GeoJSON oficiais do IBGE. Saída fica em `packages/site/build/`.
#
# Pré-requisitos:
#   brew install tippecanoe pmtiles
#
# Uso:
#   ./scripts/build-geo-tiles.sh
#
# O resultado (`brasil.pmtiles`) é um arquivo único que, hospedado em
# S3 com Range Requests habilitados, serve tiles vetoriais sob
# demanda pra Mapbox GL JS (via o protocolo `pmtiles://`).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$SITE_DIR/build/geo"
SRC_DIR="$SITE_DIR/build/geo-src"

mkdir -p "$BUILD_DIR" "$SRC_DIR"

UFS=(AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO)
UF_CODES=(12 27 13 16 29 23 53 32 52 21 31 50 51 15 25 26 22 41 33 24 11 14 43 42 28 35 17)

# UFs — fonte click_that_hood (já simplificado, 3.3 MB). mapshaper pra
# reforçar a simplificação a 8% mantendo topologia.
if [[ ! -f "$SRC_DIR/brasil-ufs.geojson" ]]; then
  curl -sSL -o "$SRC_DIR/brasil-ufs.geojson" \
    "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/brazil-states.geojson"
fi

# Municípios — API IBGE v4 por UF (formato GeoJSON, qualidade intermediária).
# 27 requisições, ~5-15 MB cada.
for i in "${!UFS[@]}"; do
  uf="${UFS[$i]}"
  code="${UF_CODES[$i]}"
  out="$SRC_DIR/municipios-$uf.geojson"
  if [[ ! -f "$out" ]]; then
    echo "Baixando municípios de $uf (código $code)..." >&2
    curl -sSL -o "$out" \
      "https://servicodados.ibge.gov.br/api/v4/malhas/estados/$code?formato=application/vnd.geo%2Bjson&qualidade=intermediaria&intrarregiao=municipio"
    # Adiciona propriedade `uf` pra poder filtrar no tileset.
    jq --arg uf "$uf" '.features |= map(.properties += {uf: $uf})' \
      "$out" > "$out.tmp" && mv "$out.tmp" "$out"
  fi
done

# Merge de todos os municípios num único GeoJSON.
echo "Merging municípios de 27 UFs..." >&2
node --input-type=module -e "
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const src = '$SRC_DIR';
const out = { type: 'FeatureCollection', features: [] };
for (const f of readdirSync(src)) {
  if (!f.startsWith('municipios-') || !f.endsWith('.geojson')) continue;
  const d = JSON.parse(readFileSync(\`\${src}/\${f}\`, 'utf-8'));
  out.features.push(...d.features);
}
writeFileSync('$SRC_DIR/municipios-brasil.geojson', JSON.stringify(out));
console.error(\`Total: \${out.features.length} municípios\`);
"

# tippecanoe: gera MVT num mbtiles com dois layers (ufs + municipios),
# detalhe adaptativo por zoom. `--coalesce-densest-as-needed` e
# `--extend-zooms-if-still-dropping` garantem que polígonos pequenos
# não somem em zoom baixo.
echo "Rodando tippecanoe..." >&2
tippecanoe \
  --output="$BUILD_DIR/brasil.mbtiles" \
  --force \
  --minimum-zoom=2 --maximum-zoom=10 \
  --base-zoom=5 \
  --coalesce-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --no-tile-size-limit \
  --detect-shared-borders \
  --named-layer=ufs:"$SRC_DIR/brasil-ufs.geojson" \
  --named-layer=municipios:"$SRC_DIR/municipios-brasil.geojson"

# Converte mbtiles → pmtiles (single file, Range Requests friendly).
echo "Convertendo mbtiles → pmtiles..." >&2
pmtiles convert "$BUILD_DIR/brasil.mbtiles" "$BUILD_DIR/brasil.pmtiles" --force

echo "--- build concluído ---" >&2
ls -lh "$BUILD_DIR/brasil.pmtiles" >&2
