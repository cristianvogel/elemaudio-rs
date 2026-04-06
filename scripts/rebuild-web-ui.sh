#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT_DIR/scripts/rebuild-web-wasm.sh"
npm --prefix "$ROOT_DIR/examples/web-ui" run build
