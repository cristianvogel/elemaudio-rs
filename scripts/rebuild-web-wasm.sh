#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/src/vendor/elementary"
BUILD_DIR="${ELEMAUDIO_WASM_BUILD_DIR:-$VENDOR_DIR/build/local-wasm}"
OUTPUT_FILE="$VENDOR_DIR/js/packages/web-renderer/raw/elementary-wasm.js"

if ! command -v emcmake >/dev/null 2>&1; then
  echo "emcmake is not installed or not on PATH" >&2
  exit 1
fi

if ! command -v emmake >/dev/null 2>&1; then
  echo "emmake is not installed or not on PATH" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"

emcmake cmake \
  -DONLY_BUILD_WASM=ON \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_FLAGS="-O3" \
  -B "$BUILD_DIR" \
  -S "$VENDOR_DIR"

emmake make -C "$BUILD_DIR"

for candidate in \
  "$BUILD_DIR/wasm/elementary-wasm.js" \
  "$BUILD_DIR/elementary-wasm.js"; do
  if [[ -f "$candidate" ]]; then
    cp "$candidate" "$OUTPUT_FILE"
    echo "Copied $candidate -> $OUTPUT_FILE"
    exit 0
  fi
done

echo "Could not find built elementary-wasm.js under $BUILD_DIR" >&2
exit 1
