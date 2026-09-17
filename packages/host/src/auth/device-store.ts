import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
}

interface StoredDevice extends Device {
  tokenHash: string;
}

interface PairingCode {
  expiresAt: number;
}

export interface PairedDevice {
  deviceId: string;
  token: string;
}

export interface DeviceStoreOptions {
  now?: () => number;
}

const DEFAULT_CODE_TTL_MS = 10 * 60 * 1000;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Paired phones and the one-shot codes that create them. Devices live in a
// JSON file (token hashes only); pairing codes are in-memory because they
// only make sense for the running server that printed the QR code.
export class DeviceStore {
  private readonly path: string;
  private readonly now: () => number;
  private readonly codes = new Map<string, PairingCode>();
  private devices: StoredDevice[] | null = null;

  constructor(path: string, opts: DeviceStoreOptions = {}) {
    this.path = path;
    this.now = opts.now ?? Date.now;
  }

  createPairingCode(opts: { ttlMs?: number } = {}): string {
    this.pruneCodes();
    const code = randomBytes(16).toString("base64url");
    this.codes.set(code, { expiresAt: this.now() + (opts.ttlMs ?? DEFAULT_CODE_TTL_MS) });
    return code;
  }

  async redeemPairingCode(code: string, deviceName: string): Promise<PairedDevice | null> {
    this.pruneCodes();
    if (!this.codes.delete(code)) return null;
    const token = randomBytes(32).toString("base64url");
    const device: StoredDevice = {
      id: randomBytes(8).toString("hex"),
      name: deviceName.trim().slice(0, 64) || "Unnamed device",
      createdAt: this.now(),
      lastSeenAt: this.now(),
      tokenHash: sha256(token),
    };
    const devices = await this.load();
    devices.push(device);
    await this.save(devices);
    return { deviceId: device.id, token };
  }

  async verifyToken(token: string): Promise<Device | null> {
    if (typeof token !== "string" || token.length < 16) return null;
    const hash = sha256(token);
    const devices = await this.load();
    const found = devices.find((d) => safeEqualHex(d.tokenHash, hash));
    if (!found) return null;
    found.lastSeenAt = this.now();
    // Best-effort touch; a failed write must not fail authentication.
    this.save(devices).catch(() => {});
    return publicView(found);
  }

  async list(): Promise<Device[]> {
    return (await this.load()).map(publicView);
  }

  async revoke(deviceId: string): Promise<boolean> {
    const devices = await this.load();
    const idx = devices.findIndex((d) => d.id === deviceId);
    if (idx < 0) return false;
    devices.splice(idx, 1);
    await this.save(devices);
    return true;
  }

  private pruneCodes(): void {
    const t = this.now();
    for (const [code, entry] of this.codes) if (entry.expiresAt <= t) this.codes.delete(code);
  }

  private async load(): Promise<StoredDevice[]> {
    if (this.devices) return this.devices;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as { devices?: StoredDevice[] };
      this.devices = Array.isArray(parsed.devices) ? parsed.devices : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.devices = [];
    }
    return this.devices;
  }

  private async save(devices: StoredDevice[]): Promise<void> {
    this.devices = devices;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify({ devices }, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
  }
}

function publicView(d: StoredDevice): Device {
  return { id: d.id, name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt };
}
