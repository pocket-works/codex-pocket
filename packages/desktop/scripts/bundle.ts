// Bundles the desktop main process and the host CLI into single files so the
// packaged app carries no node_modules. Electron's own Node runs both.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// App icon: the PWA's icon.svg, padded the way macOS icons are, rendered
// with the system's own SVG rasteriser and folded into an .icns.
const iconSvg = readFileSync(resolve(here, "..", "web", "public", "icon.svg"), "utf8");
const iconDir = resolve(here, "build", "icon");
const iconset = resolve(iconDir, "icon.iconset");
rmSync(iconDir, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
// 64-unit artwork on an 80-unit canvas: the ~10% margin macOS icons keep.
writeFileSync(resolve(iconDir, "icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 80 80">${iconSvg.replace(/<\/?svg[^>]*>/g, "")}</svg>`);
execFileSync("qlmanage", ["-t", "-s", "1024", "-o", iconDir, resolve(iconDir, "icon.svg")], { stdio: "ignore" });
const master = resolve(iconDir, "icon.svg.png");
for (const [name, px] of [["16x16", 16], ["16x16@2x", 32], ["32x32", 32], ["32x32@2x", 64], ["128x128", 128], ["128x128@2x", 256], ["256x256", 256], ["256x256@2x", 512], ["512x512", 512], ["512x512@2x", 1024]] as const) {
  execFileSync("sips", ["-z", String(px), String(px), master, "--out", resolve(iconset, `icon_${name}.png`)], { stdio: "ignore" });
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", resolve(here, "build", "icon.icns")]);
