#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="${ELEMAUDIO_RESOURCES_DIR:-$ROOT_DIR/../elemaudio-resources}"

if [[ ! -f "$RESOURCES_DIR/Cargo.toml" ]]; then
  echo "elemaudio-resources repo not found at: $RESOURCES_DIR" >&2
  echo "Set ELEMAUDIO_RESOURCES_DIR to the repo path if needed." >&2
  exit 1
fi

cargo run --manifest-path "$RESOURCES_DIR/Cargo.toml" --bin resource-manager-server
