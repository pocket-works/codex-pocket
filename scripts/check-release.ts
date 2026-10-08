import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifests = ["package.json", ...["desktop", "host", "protocol", "web"].map((name) => `packages/${name}/package.json`)];
const versions = manifests.map((file) => ({ file, version: (JSON.parse(readFileSync(resolve(root, file), "utf8")) as { version: string }).version }));
const version = versions[0].version;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/;

if (!semver.test(version)) throw new Error(`Invalid release version: ${version}`);
for (const entry of versions) {
  if (entry.version !== version) throw new Error(`${entry.file} has version ${entry.version}; expected ${version}`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`Workspace version: ${version}`);
} else {
  if (args.length !== 4 || args[0] !== "--tag" || args[2] !== "--notes-file") {
    throw new Error("Usage: check-release.ts [--tag v<version> --notes-file <path>]");
  }
  const tag = args[1];
  if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match workspace version v${version}`);

  const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
  const heading = `## [${version}] - `;
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(lines[start].slice(heading.length))) {
    throw new Error(`CHANGELOG.md needs a dated ## [${version}] - YYYY-MM-DD heading`);
  }
  const endOffset = lines.slice(start + 1).findIndex((line) => line.startsWith("## ["));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  const notes = lines.slice(start + 1, end).join("\n").trim();
  if (!notes) throw new Error(`CHANGELOG.md has no notes for ${version}`);
  writeFileSync(args[3], `${notes}\n\nThe macOS DMG targets Apple silicon; drag Codex Pocket to Applications. The experimental Linux x86_64 archive requires Node.js 22.12+ and a signed-in Codex CLI (tested with 0.161.0). See [Linux deployment](https://github.com/pocket-works/codex-pocket/blob/${tag}/docs/linux.md) / [中文部署](https://github.com/pocket-works/codex-pocket/blob/${tag}/docs/linux.zh-CN.md).\n`);
  console.log(`Release ${tag} validated; notes written to ${args[3]}`);
}
