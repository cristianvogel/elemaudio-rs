#!/usr/bin/env bash
# Build and install the stride-delay CLAP plugin example.
# Usage: ./bundle.sh [--install]
#   --install  copies the .clap to ~/Library/Audio/Plug-Ins/CLAP/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="stride-delay-example"
BUNDLE_DIR="$SCRIPT_DIR/target/bundle"
CLAP_BUNDLE="$BUNDLE_DIR/$PLUGIN_NAME.clap"

echo "[bundle] building release..."
cargo build --release --manifest-path "$SCRIPT_DIR/Cargo.toml"

# Find the dylib
DYLIB="$SCRIPT_DIR/target/release/libstride_delay_plugin.dylib"
if [[ ! -f "$DYLIB" ]]; then
  echo "[bundle] ERROR: dylib not found at $DYLIB" >&2
  exit 1
fi

# Assemble .clap bundle
echo "[bundle] assembling $PLUGIN_NAME.clap..."
rm -rf "$CLAP_BUNDLE"
mkdir -p "$CLAP_BUNDLE/Contents/MacOS"

cp "$DYLIB" "$CLAP_BUNDLE/Contents/MacOS/"

cat > "$CLAP_BUNDLE/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>libstride_delay_plugin.dylib</string>
    <key>CFBundleIdentifier</key>
    <string>com.elemaudio-rs.stride-delay-example</string>
    <key>CFBundleName</key>
    <string>Stride Delay Example</string>
    <key>CFBundleVersion</key>
    <string>0.1.0</string>
    <key>CFBundlePackageType</key>
    <string>BNDL</string>
</dict>
</plist>
EOF

echo "[bundle] output: $CLAP_BUNDLE"

# Optional install
if [[ "${1:-}" == "--install" ]]; then
  CLAP_DIR="$HOME/Library/Audio/Plug-Ins/CLAP"
  mkdir -p "$CLAP_DIR"
  rm -rf "$CLAP_DIR/$PLUGIN_NAME.clap"
  cp -R "$CLAP_BUNDLE" "$CLAP_DIR/"
  echo "[bundle] installed to $CLAP_DIR/$PLUGIN_NAME.clap"
fi

echo "[bundle] done."
