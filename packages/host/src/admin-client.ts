import { adminToken, readRuntimeInfo } from "./config/paths.js";

// Talks to the running `serve` process over loopback using the admin token.
export async function adminRequest<T>(method: string, path: string): Promise<T> {
  const runtime = readRuntimeInfo();
  if (!runtime) throw new Error("codex-pocket serve is not running (no runtime.json)");
  // Always loopback: the admin endpoints refuse anything else, and a TLS
  // cert for the public name would not cover 127.0.0.1.
  const scheme = runtime.tls ? "https" : "http";
  const res = await fetch(`${scheme}://127.0.0.1:${runtime.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${adminToken()}` },
  }).catch((err: Error) => {
    throw new Error(`cannot reach codex-pocket serve on port ${runtime.port}: ${err.message}`);
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}
