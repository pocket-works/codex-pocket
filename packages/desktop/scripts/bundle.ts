// Bundles the desktop main process and the host CLI into single files so the
// packaged app carries no node_modules. Electron's own Node runs both.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = resolve(fileURLToPath(import.meta.url), "..", "..");
const nodeRequireShim = `import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);`;

await build({
  entryPoints: [resolve(here, "src", "main.ts")],
  outfile: resolve(here, "build", "main.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron"],
  banner: { js: nodeRequireShim },
  sourcemap: true,
  logLevel: "warning",
});

await build({
  entryPoints: [resolve(here, "..", "host", "src", "cli.ts")],
  outfile: resolve(here, "build", "host", "cli.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Optional native accelerators for ws; it falls back to JS without them.
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: nodeRequireShim },
  sourcemap: true,
  logLevel: "warning",
});
