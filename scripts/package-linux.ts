import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string };
const name = `codex-pocket-v${version}-linux-x64`;
const output = resolve(root, "release", "linux");
const staging = resolve(output, name);
rmSync(staging, { recursive: true, force: true });
mkdirSync(resolve(staging, "host"), { recursive: true });
await build({
  entryPoints: [resolve(root, "packages/host/src/cli.ts")],
  outfile: resolve(staging, "host/cli.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  logLevel: "warning",
});
writeFileSync(resolve(staging, "package.json"), JSON.stringify({ name: "codex-pocket-linux", version, private: true, type: "module" }, null, 2) + "\n");
cpSync(resolve(root, "packages/web/dist"), resolve(staging, "web"), { recursive: true });
cpSync(resolve(root, "deploy/linux"), resolve(staging, "deploy"), { recursive: true });
mkdirSync(resolve(staging, "bin"));
cpSync(resolve(root, "deploy/linux/codex-pocket"), resolve(staging, "bin/codex-pocket"));
chmodSync(resolve(staging, "bin/codex-pocket"), 0o755);
for (const [source, target] of [["docs/linux.md", "README.md"], ["docs/linux.zh-CN.md", "README.zh-CN.md"], ["CHANGELOG.md", "CHANGELOG.md"]]) {
  cpSync(resolve(root, source), resolve(staging, target));
}
execFileSync(process.execPath, [resolve(root, "packages/desktop/scripts/collect-licenses.ts"), "--no-electron", "--output", resolve(staging, "legal")], { cwd: root, stdio: "inherit" });
const archive = `${name}.tar.gz`;
execFileSync("tar", [...(process.platform === "darwin" ? ["--no-xattrs"] : []), "-czf", resolve(output, archive), "-C", output, name], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
const hash = createHash("sha256").update(readFileSync(resolve(output, archive))).digest("hex");
writeFileSync(resolve(output, `${archive}.sha256`), `${hash}  ${archive}\n`);
console.log(`Linux package: ${resolve(output, archive)}`);
