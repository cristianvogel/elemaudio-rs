#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

exec npm --prefix "$ROOT_DIR/examples/web-ui" run dev
