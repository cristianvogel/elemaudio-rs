import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const wasmPath = resolve(__dirname, "../../src/vendor/elementary/js/packages/web-renderer/raw/elementary-wasm.js");
const workletPath = resolve(__dirname, "../../src/vendor/elementary/js/packages/web-renderer/raw/WorkletProcessor.js");

function virtualVendorAssets() {
  return {
    name: "virtual-vendor-assets",
    resolveId(id: string) {
      if (id === "virtual:elementary-wasm" || id === "virtual:worklet-processor") {
        return id;
      }

      return null;
    },
    load(id: string) {
      if (id === "virtual:elementary-wasm") {
        return `export default ${JSON.stringify(readFileSync(wasmPath, "utf8"))};`;
      }

      if (id === "virtual:worklet-processor") {
        return `export default ${JSON.stringify(readFileSync(workletPath, "utf8").replace(/__PKG_VERSION__/g, JSON.stringify("dev")))};`;
      }

      return null;
    },
  };
}

export default defineConfig({
  plugins: [virtualVendorAssets()],
  resolve: {
    alias: [
      {
        find: "@elemaudio/core",
        replacement: resolve(__dirname, "../../src/vendor/elementary/js/packages/core/index.ts"),
      },
      {
        find: "invariant",
        replacement: resolve(__dirname, "node_modules/invariant/invariant.js"),
      },
      {
        find: "eventemitter3",
        replacement: resolve(__dirname, "node_modules/eventemitter3/index.mjs"),
      },
      {
        find: "shallowequal",
        replacement: resolve(__dirname, "node_modules/shallowequal/index.js"),
      },
      {
        find: /^rescript\/lib\/es6\/(.*)$/, 
        replacement: resolve(__dirname, "shims/rescript/lib/es6/$1"),
      },
    ],
  },
  define: {
    "process.env.PKG_VERSION": JSON.stringify("dev"),
  },
});
