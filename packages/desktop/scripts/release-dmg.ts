import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Arch, Platform, build, type Configuration } from "electron-builder";

const desktop = resolve(fileURLToPath(import.meta.url), "..", "..");
const root = resolve(desktop, "..", "..");
const manifest = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")) as { version: string; build: Configuration };
const profile = process.env.APPLE_KEYCHAIN_PROFILE;

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Release packaging requires an Apple silicon Mac");
if (!profile) throw new Error("Set APPLE_KEYCHAIN_PROFILE to a notarytool Keychain profile");
if (["CSC_LINK", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"].some((name) => process.env[name])) {
  throw new Error("This local release path uses only a Keychain signing identity and notarytool profile");
}
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("status", "--porcelain=v1") || git("branch", "--show-current") !== "main" || git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) {
  throw new Error("Sign only from a clean main checkout already pushed to origin");
}
const notesDir = mkdtempSync(join(tmpdir(), "codex-pocket-notes-"));
try {
  execFileSync(process.execPath, [join(root, "scripts", "check-release.ts"), "--tag", `v${manifest.version}`, "--notes-file", join(notesDir, "notes.md")], { cwd: root, stdio: "pipe" });
} finally {
  rmSync(notesDir, { recursive: true, force: true });
}
const dmg = resolve(desktop, "release", "signed", `codex-pocket-v${manifest.version}-macos-arm64.dmg`);
if (existsSync(dmg)) throw new Error("A DMG for this version already exists; preserve or move it before rebuilding");

const keychain = join(homedir(), "Library", "Keychains", "login.keychain-db");
const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning", keychain], { encoding: "utf8" });
const matches = identities.split("\n").flatMap((line) => {
  const match = /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"Developer ID Application: .* \(([A-Z0-9]{10})\)"$/.exec(line);
  return match ? [{ hash: match[1], team: match[2] }] : [];
});
const selected = process.env.CODEX_POCKET_TEAM_ID ? matches.filter((identity) => identity.team === process.env.CODEX_POCKET_TEAM_ID) : matches;
if (selected.length !== 1) throw new Error("Expected one Developer ID Application identity in the login Keychain; set CODEX_POCKET_TEAM_ID locally if multiple exist");
const { hash: identityHash, team } = selected[0];
process.env.CSC_NAME = identityHash;

execFileSync(process.execPath, [join(desktop, "scripts", "bundle.ts")], { cwd: desktop, stdio: "inherit" });
const config: Configuration = {
  ...manifest.build,
  directories: { ...manifest.build.directories, output: "release/signed" },
  forceCodeSigning: true,
  mac: {
    ...manifest.build.mac,
    identity: identityHash,
    target: ["dmg"],
    type: "distribution",
    hardenedRuntime: true,
    notarize: true,
    entitlements: "entitlements.mac.plist",
    entitlementsInherit: "entitlements.mac.plist",
  },
  dmg: {
    ...manifest.build.dmg,
    sign: true,
    title: "Codex Pocket",
    artifactName: `codex-pocket-v${manifest.version}-macos-arm64.dmg`,
  },
};
const artifacts = await build({ projectDir: desktop, targets: Platform.MAC.createTarget(["dmg"], Arch.arm64), config, publish: "never" });
if (!artifacts.includes(dmg)) throw new Error("The signed DMG was not produced");

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr || result.stdout}`);
  return `${result.stdout}${result.stderr}`;
}

function verifyApp(app: string): void {
  const signature = run("codesign", ["-dv", "--verbose=4", app]);
  if (!signature.includes("Authority=Developer ID Application:") || !signature.includes(`TeamIdentifier=${team}`)) {
    throw new Error("The app is not signed by the expected Developer ID organization");
  }
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  run("xcrun", ["stapler", "validate", app]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
}

const app = resolve(desktop, "release", "signed", "mac-arm64", "Codex Pocket.app");
const resources = join(app, "Contents", "Resources");
const payloads = [join(resources, "app.asar"), join(resources, "host", "cli.js")];
function addWebFiles(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) addWebFiles(path);
    else if (/\.(?:js|html|css|json|map|webmanifest)$/.test(entry.name)) payloads.push(path);
  }
}
addWebFiles(join(resources, "web"));
const sensitive = /\/Users\/[A-Za-z0-9._-]+|-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}/;
for (const payload of payloads) {
  if (sensitive.test(readFileSync(payload, "utf8"))) throw new Error(`Potential personal path or credential in ${relative(app, payload)}`);
}
verifyApp(app);
run("codesign", ["--verify", "--strict", dmg]);
run("hdiutil", ["verify", dmg]);
const submission = JSON.parse(execFileSync("xcrun", ["notarytool", "submit", dmg, "--wait", "--keychain-profile", profile, "--output-format", "json"], { encoding: "utf8" })) as { status?: string };
if (submission.status !== "Accepted") throw new Error(`DMG notarization returned ${submission.status ?? "no status"}`);
run("xcrun", ["stapler", "staple", dmg]);
run("xcrun", ["stapler", "validate", dmg]);
run("codesign", ["--verify", "--strict", dmg]);
run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", dmg]);

const mount = mkdtempSync(join(tmpdir(), "codex-pocket-release-"));
let attached = false;
try {
  run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]);
  attached = true;
  verifyApp(join(mount, "Codex Pocket.app"));
  if (!lstatSync(join(mount, "Applications")).isSymbolicLink()) throw new Error("DMG is missing the Applications shortcut");
} finally {
  if (attached) run("hdiutil", ["detach", mount]);
  rmSync(mount, { recursive: true, force: true });
}

const hash = createHash("sha256");
for await (const chunk of createReadStream(dmg)) hash.update(chunk);
writeFileSync(`${dmg}.sha256`, `${hash.digest("hex")}  ${basename(dmg)}\n`);
console.log(`Verified signed and notarized release: ${relative(root, dmg)}`);
