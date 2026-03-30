#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_LIB_DIR="$ROOT_DIR/src/vendor/elementary/js/packages/core/lib"
PACKAGE_DIR="$ROOT_DIR/packages/core/src"

cp "$VENDOR_LIB_DIR/core.ts" "$PACKAGE_DIR/core.ts"
cp "$VENDOR_LIB_DIR/math.ts" "$PACKAGE_DIR/math.ts"
cp "$VENDOR_LIB_DIR/filters.ts" "$PACKAGE_DIR/filters.ts"
cp "$VENDOR_LIB_DIR/oscillators.ts" "$PACKAGE_DIR/oscillators.ts"
cp "$VENDOR_LIB_DIR/signals.ts" "$PACKAGE_DIR/signals.ts"
cp "$VENDOR_LIB_DIR/dynamics.ts" "$PACKAGE_DIR/dynamics.ts"
cp "$VENDOR_LIB_DIR/envelopes.ts" "$PACKAGE_DIR/envelopes.ts"
cp "$VENDOR_LIB_DIR/mc.ts" "$PACKAGE_DIR/mc.ts"

cat > "$PACKAGE_DIR/index.ts" <<'EOF'
import * as core from "./core";
import * as dynamics from "./dynamics";
import * as envelopes from "./envelopes";
import * as filters from "./filters";
import * as math from "./math";
import * as oscillators from "./oscillators";
import * as signals from "./signals";
import * as mc from "./mc";

export { createCore, withKey } from "./shared";
export type { GraphNode, GraphValue, RefPair, RefSetter, Transport } from "./shared";

export const el = {
  ...core,
  ...dynamics,
  ...envelopes,
  ...filters,
  ...math,
  ...oscillators,
  ...signals,
  mc,
  "const": core.constant,
  "in": math.identity,
};

export default el;
EOF

printf 'Regenerated core from vendor helpers\n'
