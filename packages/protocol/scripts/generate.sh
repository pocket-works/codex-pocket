#!/usr/bin/env bash
# Regenerate protocol types from the locally installed codex CLI.
# Run this whenever the Codex desktop app / CLI is upgraded.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=src/generated
rm -rf "$OUT"
mkdir -p "$OUT"
codex app-server generate-ts --out "$OUT"
codex --version | tr -d '\n' > "$OUT/CODEX_VERSION"
echo "Generated into $OUT for $(cat "$OUT/CODEX_VERSION")"
