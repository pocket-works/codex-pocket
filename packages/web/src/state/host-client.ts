import { getToken } from "./auth.js";
import type { Computer } from "./computers.js";

export interface HostInfo {
  host: string;
  home: string;
  upstream: boolean;
  dictation?: boolean;
  instanceId?: string | null;
  apiVersion?: number;
  device: { id: string; name: string; createdAt: number; push: boolean };
}

export class HostHttpError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? "Pairing was revoked. Pair this computer again." : `Computer request failed (HTTP ${status}).`);
  }
}

function requestSignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  const abort = () => {
    controller.abort(signals.find((signal) => signal.aborted)?.reason);
    for (const signal of signals) signal.removeEventListener("abort", abort);
  };
  for (const signal of signals) signal.addEventListener("abort", abort, { once: true });
  if (signals.some((signal) => signal.aborted)) abort();
  return controller.signal;
}

export class HostClient {
  readonly computer: Readonly<Computer>;
  private readonly abort = new AbortController();
  private info: Promise<HostInfo> | null = null;

  constructor(computer: Computer) {
    this.computer = Object.freeze({ ...computer });
  }

  get id(): string { return this.computer.id; }
  get origin(): string { return this.computer.origin; }
  get wsUrl(): string { return `${this.origin.replace(/^http/, "ws")}/ws`; }
  get disposed(): boolean { return this.abort.signal.aborted; }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (!path.startsWith("/api/")) throw new Error("Invalid computer API path.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.computer.token}`);
    const signal = requestSignal([this.abort.signal, AbortSignal.timeout(15_000), ...(init.signal ? [init.signal] : [])]);
    return fetch(`${this.origin}${path}`, { ...init, headers, signal, credentials: "omit", redirect: "error" });
  }

  async me(refresh = false): Promise<HostInfo> {
    if (refresh) this.info = null;
    return this.info ??= this.fetch("/api/me").then(async (res) => {
      if (!res.ok) throw new HostHttpError(res.status);
      const info = await res.json() as HostInfo;
      if (this.computer.instanceId && info.instanceId !== this.computer.instanceId) throw new Error("Computer identity changed. Pair it again.");
      return info;
    }).catch((err) => { this.info = null; throw err; });
  }

  dispose(): void { this.abort.abort(); }
}

export function hostClientFor(session: { host?: HostClient }): HostClient {
  return session.host ?? new HostClient({ id: "", instanceId: null, name: location.hostname, origin: location.origin, token: getToken() ?? "", deviceId: null, lastRoute: "#/", notifications: false });
}
