#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="${ELEMAUDIO_RESOURCES_DIR:-$ROOT_DIR/../elemaudio-resources}"
VITE_PID=""
SERVER_PID=""

cleanup() {
  if [[ -n "$VITE_PID" ]]; then
    kill "$VITE_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if [[ ! -f "$RESOURCES_DIR/Cargo.toml" ]]; then
  echo "elemaudio-resources repo not found at: $RESOURCES_DIR" >&2
  echo "Set ELEMAUDIO_RESOURCES_DIR to the repo path if needed." >&2
  exit 1
fi

cargo update -p elemaudio-resources

cargo run --manifest-path "$RESOURCES_DIR/Cargo.toml" --bin resource-manager-server &
SERVER_PID=$!

VITE_ELEMAUDIO_RESOURCES=1 npm --prefix "$ROOT_DIR/examples/web-ui" run dev &
VITE_PID=$!

wait "$SERVER_PID" "$VITE_PID"
