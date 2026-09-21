// Generates the iOS launch screens (`apple-touch-startup-image`) into
// public/splash/: `node scripts/splash.ts` (also `pnpm splash`). Without
// them a Home Screen app opens on a blank white sheet for a second. One
// image per iPhone size and colour scheme: the app's background with the
// icon centred, so the first frame of the UI is a continuation of it.
// Prints the <link> tags for index.html.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pub = resolve(fileURLToPath(import.meta.url), "..", "..", "public");
const out = join(pub, "splash");
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "cp-splash-"));

// CSS points and pixel ratio; portrait only, the app is a phone app.
const DEVICES: [number, number, number][] = [
  [440, 956, 3],
  [430, 932, 3],
  [428, 926, 3],
  [414, 896, 3],
  [414, 896, 2],
  [402, 874, 3],
  [393, 852, 3],
  [390, 844, 3],
  [375, 812, 3],
  [375, 667, 2],
];
const SCHEMES = { light: "#ffffff", dark: "#111111" };
const ICON_PT = 120;

const icon = readFileSync(join(pub, "icon.svg"), "utf8");
const inner = icon.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const links: string[] = [];
for (const [w, h, dpr] of DEVICES) {
  for (const [scheme, bg] of Object.entries(SCHEMES)) {
    const W = w * dpr;
    const H = h * dpr;
    const size = ICON_PT * dpr;
    // qlmanage renders onto a square canvas, so draw a square with the
    // icon in the middle and crop the device size out of its centre.
    const S = Math.max(W, H);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
      `<rect width="${S}" height="${S}" fill="${bg}"/>` +
      `<g transform="translate(${(S - size) / 2} ${(S - size) / 2}) scale(${size / 64})">${inner}</g></svg>`;
    const name = `${w}x${h}@${dpr}-${scheme}`;
    const src = join(work, `${name}.svg`);
    writeFileSync(src, svg);
    execFileSync("qlmanage", ["-t", "-s", String(S), "-o", work, src], { stdio: "ignore" });
    // JPEG: a flat field with one icon is ~40 KB, against ~160 KB as the
    // unpalettised PNG sips writes; twenty of them live in the repo.
    execFileSync("sips", ["--cropToHeightWidth", String(H), String(W), join(work, `${name}.svg.png`)], { stdio: "ignore" });
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "90", join(work, `${name}.svg.png`), "--out", join(out, `${name}.jpg`)], { stdio: "ignore" });
    const media = `screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)${scheme === "dark" ? " and (prefers-color-scheme: dark)" : ""}`;
    links.push(`    <link rel="apple-touch-startup-image" href="/splash/${name}.jpg" media="${media}" />`);
  }
}
// Dark entries must come after light ones for the same size so they win.
console.log(links.join("\n"));
