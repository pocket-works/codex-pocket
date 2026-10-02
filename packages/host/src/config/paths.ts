import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// All host state lives under one directory (override with CODEX_POCKET_HOME).
export function pocketHome(): string {
  return process.env.CODEX_POCKET_HOME ?? join(homedir(), ".codex-pocket");
}

export function devicesFile(): string {
  return join(pocketHome(), "devices.json");
}

export function hostInstanceId(): string {
  const file = join(pocketHome(), "host.id");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(pocketHome(), { recursive: true, mode: 0o700 });
  const id = randomBytes(16).toString("hex");
  writeFileSync(file, id, { mode: 0o600, flag: "wx" });
  return id;
}

export function certsDir(): string {
  return join(pocketHome(), "certs");
}

export function uploadsDir(): string {
  return join(pocketHome(), "uploads");
}

export function vapidFile(): string {
  return join(pocketHome(), "vapid.json");
}

export interface CertFiles {
  key: string;
  cert: string;
}

// Stage 5 writes fullchain.pem/privkey.pem here; until then the host runs
// plain HTTP. Users may also drop their own PEMs in.
export function findCertFiles(): CertFiles | null {
  const cert = join(certsDir(), "fullchain.pem");
  const key = join(certsDir(), "privkey.pem");
  return existsSync(cert) && existsSync(key) ? { cert, key } : null;
}

// Secret shared between `serve` and the local admin commands (`pair`,
// `devices`, `revoke`). Created on first use, readable only by the user.
export function adminToken(): string {
  const file = join(pocketHome(), "admin.token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(pocketHome(), { recursive: true, mode: 0o700 });
  const token = randomBytes(24).toString("base64url");
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export interface RuntimeInfo {
  pid: number;
  port: number;
  tls: boolean;
  publicUrl: string;
}

const RUNTIME_FILE = "runtime.json";

// `serve` records where it is listening so the admin commands can find it.
export function writeRuntimeInfo(info: RuntimeInfo): void {
  mkdirSync(pocketHome(), { recursive: true, mode: 0o700 });
  writeFileSync(join(pocketHome(), RUNTIME_FILE), JSON.stringify(info, null, 2), { mode: 0o600 });
}

export function readRuntimeInfo(): RuntimeInfo | null {
  try {
    return JSON.parse(readFileSync(join(pocketHome(), RUNTIME_FILE), "utf8")) as RuntimeInfo;
  } catch {
    return null;
  }
}
