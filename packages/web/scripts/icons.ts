// Regenerates the PNG icons from icon.svg with macOS's own rasteriser:
// `node scripts/icons.ts` (also `pnpm icons`).
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pub = resolve(fileURLToPath(import.meta.url), "..", "..", "public");
const work = mkdtempSync(join(tmpdir(), "cp-icons-"));
execFileSync("qlmanage", ["-t", "-s", "1024", "-o", work, join(pub, "icon.svg")], { stdio: "ignore" });
const master = join(work, "icon.svg.png");
for (const size of [180, 512]) {
  execFileSync("sips", ["-z", String(size), String(size), master, "--out", join(work, `icon-${size}.png`)], { stdio: "ignore" });
  renameSync(join(work, `icon-${size}.png`), join(pub, `icon-${size}.png`));
}
