#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/elemaudio/elementary.git"
TARGET_DIR="$(cd "$(dirname "$0")/.." && pwd)/src/vendor/elementary"
REF="${1:-main}"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

git clone --depth 1 "$REPO_URL" "$TMP_DIR"

if [[ "$REF" != "main" ]]; then
  git -C "$TMP_DIR" fetch --depth 1 origin "$REF"
  git -C "$TMP_DIR" checkout FETCH_HEAD
fi

rm -rf "$TARGET_DIR"
mkdir -p "$(dirname "$TARGET_DIR")"
cp -R "$TMP_DIR" "$TARGET_DIR"

"$ROOT_DIR/scripts/regen-elementary-ts.sh"

printf 'Synced Elementary from %s (%s)\n' "$REPO_URL" "$REF"
