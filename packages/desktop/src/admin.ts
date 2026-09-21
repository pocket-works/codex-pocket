import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HostStatus } from "./supervisor.js";

// Loopback client for the host's admin endpoints. `serve` writes
// runtime.json when it is listening and admin.token on first use; both live
// in the same state directory the host uses (see packages/host config/paths).

export function pocketHome(): string {
  return process.env.CODEX_POCKET_HOME ?? join(homedir(), ".codex-pocket");
}

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  push: boolean;
}

interface RuntimeInfo {
  pid: number;
  port: number;
  tls: boolean;
  publicUrl: string;
}

export class AdminClient {
  constructor(private readonly home = pocketHome()) {}

  /** null until `serve` has written runtime.json and answers on it. */
  async status(): Promise<HostStatus | null> {
    try {
      return await this.request<HostStatus>("GET", "/api/admin/status");
    } catch {
      return null;
    }
  }

  pairingCode(): Promise<{ code: string; url: string }> {
    return this.request("POST", "/api/admin/pairing-code");
  }

  async devices(): Promise<Device[]> {
    return (await this.request<{ devices: Device[] }>("GET", "/api/admin/devices")).devices;
  }

  async revoke(id: string): Promise<void> {
    await this.request("DELETE", `/api/admin/devices/${encodeURIComponent(id)}`);
  }

  private async request<T>(method: string, path: string): Promise<T> {
    const runtime = JSON.parse(readFileSync(join(this.home, "runtime.json"), "utf8")) as RuntimeInfo;
    const token = readFileSync(join(this.home, "admin.token"), "utf8").trim();
    const scheme = runtime.tls ? "https" : "http";
    const res = await fetch(`${scheme}://127.0.0.1:${runtime.port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}
