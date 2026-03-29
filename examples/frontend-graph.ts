import { Renderer, el } from "../src/vendor/elementary/js/packages/core/index.ts";

async function sendInstructions(instructions: unknown[]) {
  // In a real app, forward this array to elemaudio-rs over IPC, FFI, or your host bridge.
  console.log(JSON.stringify(instructions, null, 2));
}

const core = new Renderer(sendInstructions);

async function main() {
  // This is the JS/TS-side graph. It is declarative, and the reconciler lowers it to instructions.
  const graph = el.sin(el.const({ value: 240 }));
  await core.render(graph);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
