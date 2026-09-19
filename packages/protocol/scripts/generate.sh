#!/usr/bin/env bash
# Regenerate protocol types from the locally installed codex CLI.
# Run this whenever the Codex desktop app / CLI is upgraded.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=src/generated
rm -rf "$OUT"
mkdir -p "$OUT"
# --experimental keeps the project/* methods (project/list, project/changed)
# that the phone needs to show the same projects as the desktop app. The
# handshake already advertises the capability they are gated behind.
codex app-server generate-ts --experimental --out "$OUT"
codex --version | tr -d '\n' > "$OUT/CODEX_VERSION"
echo "Generated into $OUT for $(cat "$OUT/CODEX_VERSION")"
