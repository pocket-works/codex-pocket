import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Dependency = {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  homepage?: string;
};

const desktop = resolve(fileURLToPath(import.meta.url), "..", "..");
const root = resolve(desktop, "..", "..");
const legal = resolve(desktop, "build", "legal");
const dependencies = resolve(legal, "dependencies");
rmSync(legal, { recursive: true, force: true });
mkdirSync(dependencies, { recursive: true });
copyFileSync(resolve(root, "LICENSE"), resolve(legal, "LICENSE"));
copyFileSync(resolve(root, "packages", "protocol", "NOTICE"), resolve(legal, "PROTOCOL-NOTICE"));
copyFileSync(resolve(root, "packages", "protocol", "LICENSE-APACHE-2.0"), resolve(legal, "PROTOCOL-LICENSE-APACHE-2.0"));

const electron = resolve(desktop, "node_modules", "electron", "dist");
copyFileSync(resolve(electron, "LICENSE"), resolve(legal, "ELECTRON-LICENSE"));
copyFileSync(resolve(electron, "LICENSES.chromium.html"), resolve(legal, "LICENSES.chromium.html"));

const output = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], { cwd: root, encoding: "utf8" });
const groups = JSON.parse(output) as Record<string, Dependency[]>;
const entries: string[] = [];
for (const group of Object.values(groups)) {
  for (const dependency of group) {
    if (dependency.paths.length !== 1 || dependency.versions.length !== 1) {
      throw new Error(`Unexpected installations for ${dependency.name}`);
    }
    const source = dependency.paths[0];
    const files = readdirSync(source).filter((name) => /^(?:licen[cs]e|copying|notice)(?:[.\-_]|$)/i.test(name));
    // The published http_ece 1.2.0 tarball omits its upstream MIT license file.
    if (files.length === 0 && dependency.name === "http_ece" && dependency.versions[0] === "1.2.0") {
      files.push("LICENSE");
    } else if (files.length === 0 && dependency.name.startsWith("@napi-rs/canvas-")) {
      // These optional platform binaries are only for Node.js canvas, not the browser PDF viewer.
      continue;
    } else if (files.length === 0) {
      throw new Error(`No license file found for ${dependency.name}@${dependency.versions[0]}`);
    }
    const folder = `${dependency.name.replaceAll("/", "-")}-${dependency.versions[0]}`;
    const target = resolve(dependencies, folder);
    mkdirSync(target, { recursive: true });
    for (const name of files) {
      const from = dependency.name === "http_ece" ? resolve(desktop, "third-party", "http_ece-LICENSE") : resolve(source, name);
      copyFileSync(from, resolve(target, basename(name)));
    }
    entries.push(`${dependency.name}@${dependency.versions[0]} | ${dependency.license} | ${dependency.homepage ?? ""} | dependencies/${folder}/${files.join(", ")}`);
  }
}
entries.sort();
writeFileSync(resolve(legal, "THIRD-PARTY-NOTICES.txt"), [
  "Codex Pocket third-party notices",
  "",
  "The license files named below are included with this application.",
  "Electron and Chromium notices are in ELECTRON-LICENSE and LICENSES.chromium.html.",
  "Codex protocol attribution and license are in PROTOCOL-NOTICE and PROTOCOL-LICENSE-APACHE-2.0.",
  "",
  ...entries,
  "",
].join("\n"));
console.log(`Collected licenses for ${entries.length} production dependencies`);
