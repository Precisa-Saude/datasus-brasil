#!/usr/bin/env bash
# Smoke test end-to-end do CLI `datasus-brasil cnes`.
#
# Roda três cenários contra o FTP DATASUS real:
#   1. golden path — agregação top-N por tipo
#   2. labeled — um punhado de registros projetados em pt-BR
#   3. streaming JSONL — agregação ad-hoc via jq
#
# Requer: build do CLI (`pnpm turbo run build --filter=@precisa-saude/datasus-cli`)
#          + jq instalado no PATH.
#
# Uso:
#   examples/cnes-smoke-test.sh [UF] [YEAR] [MONTH]
# Default: AC 2024 1 (arquivo pequeno, termina em ~5s).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="node $REPO_ROOT/packages/cli/dist/index.js"

UF="${1:-AC}"
YEAR="${2:-2024}"
MONTH="${3:-1}"

if ! command -v jq >/dev/null 2>&1; then
  echo "erro: jq é requisito (brew install jq | apt-get install jq)" >&2
  exit 1
fi

if [[ ! -f "$REPO_ROOT/packages/cli/dist/index.js" ]]; then
  echo "erro: CLI não está buildada. Rode pnpm turbo run build antes." >&2
  exit 1
fi

echo "=== 1. Golden path — top-5 tipos de unidade em $UF/$YEAR/$(printf %02d "$MONTH") ==="
$CLI cnes --uf "$UF" --year "$YEAR" --month "$MONTH" --top 5
echo

echo "=== 2. Labeled — 3 estabelecimentos decodificados em pt-BR ==="
$CLI cnes --uf "$UF" --year "$YEAR" --month "$MONTH" --labeled --format json --limit 3
echo

echo "=== 3. Streaming JSONL → jq — contagem por gestão (primeiros 200 registros) ==="
$CLI cnes --uf "$UF" --year "$YEAR" --month "$MONTH" --raw --format jsonl --limit 200 \
  | jq -s 'group_by(.TPGESTAO) | map({gestao: .[0].TPGESTAO, count: length})'

echo
echo "smoke test OK"
