import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startFakeAppServer } from "../packages/host/test/helpers.ts";

if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Run the package smoke check on Linux x86_64.");
const root = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(root, "packages/host/package.json"));
const WebSocket = require("ws");
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const name = `codex-pocket-v${version}-linux-x64`;
const temp = mkdtempSync(join(tmpdir(), "cp-package-"));
execFileSync("tar", ["-xzf", resolve(root, `release/linux/${name}.tar.gz`), "-C", temp]);
const bundle = join(temp, name);
assert.ok(existsSync(join(bundle, "legal/THIRD-PARTY-NOTICES.txt")));
assert.ok(!existsSync(join(bundle, "legal/ELECTRON-LICENSE")));
assert.ok(!existsSync(join(bundle, "node_modules")));
const fake = await startFakeAppServer();
fake.wss.on("connection", (ws) => ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id !== undefined && msg.method) ws.send(JSON.stringify({ id: msg.id, result: msg.method === "initialize" ? { userAgent: "package-smoke", codexHome: temp, platformFamily: "unix", platformOs: "linux" } : { echo: msg.method } }));
}));
const codex = join(temp, "codex");
writeFileSync(codex, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ status: "running", socketPath: fake.socketPath })}'\n`, { mode: 0o755 });
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = (listener.address() as { port: number }).port;
await new Promise<void>((done) => listener.close(() => done()));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, CODEX_BIN: codex, CODEX_POCKET_HOME: join(temp, "home") };
delete env.SHELL;
const launcher = join(temp, "pocket");
symlinkSync(join(bundle, "bin/codex-pocket"), launcher);
let child: ChildProcess | undefined;
let output = "";
async function start() {
  child = spawn(launcher, ["serve", "--host", "127.0.0.1", "--port", String(port), "--public-url", base, "--no-tls"], { env, cwd: temp, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (chunk) => { output += chunk; });
  child.stderr!.on("data", (chunk) => { output += chunk; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Package exited: ${output}`);
    try { if ((await (await fetch(`${base}/api/health`)).json()).upstream) return; } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Package did not connect: ${output}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child?.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timeout);
}
try {
  const rejected = spawn(launcher, ["link-desktop"], { env });
  let error = "";
  rejected.stderr.on("data", (chunk) => { error += chunk; });
  const [code] = await once(rejected, "exit");
  assert.equal(code, 1);
  assert.match(error, /requires.*macOS/);
  await start();
  assert.match(await (await fetch(base)).text(), /<html/);
  assert.equal((await fetch(`${base}/sw.js`)).status, 200);
  assert.equal((await fetch(`${base}/api/me`)).status, 401);
  const admin = readFileSync(join(temp, "home/admin.token"), "utf8").trim();
  const pairing = await (await fetch(`${base}/api/admin/pairing-code`, { method: "POST", headers: { Authorization: `Bearer ${admin}` } })).json();
  const response = await fetch(`${base}/api/pair`, { method: "POST", body: JSON.stringify({ code: pairing.code, deviceName: "Package smoke" }) });
  assert.equal(response.status, 200);
  const { token } = await response.json();
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, ["cp1", `tok.${token}`]);
  await once(ws, "open");
  const reply = new Promise<any>((done) => ws.on("message", (raw: Buffer) => { const msg = JSON.parse(raw.toString()); if (msg.id === 42) done(msg); }));
  ws.send(JSON.stringify({ id: 42, method: "thread/list", params: {} }));
  assert.deepEqual((await Promise.race([reply, new Promise((_, reject) => setTimeout(() => reject(new Error("RPC timeout")), 5000))])).result, { echo: "thread/list" });
  ws.close();
  await once(ws, "close");
  await stop();
  await start();
  assert.equal((await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  console.log("Linux archive smoke passed: static PWA, daemon, auth, pairing, RPC, restart persistence and desktop guard.");
} finally {
  await stop();
  await fake.close();
  rmSync(temp, { recursive: true, force: true });
}
