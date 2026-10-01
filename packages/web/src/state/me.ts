import { getToken } from "./auth.js";
import type { HostClient } from "./host-client.js";

/** What the host knows about this pairing: the Mac's name and home folder. */
export interface Me {
  host: string;
  home: string;
  dictation?: boolean;
}

let cached: Promise<Me> | null = null;

/** GET /api/me, once per page: the answer does not change while paired. */
export function fetchMe(host?: HostClient): Promise<Me> {
  if (host) return host.me();
  if (!cached) {
    cached = fetch("/api/me", { headers: { Authorization: `Bearer ${getToken() ?? ""}` } })
      .then((res) => {
        if (!res.ok) throw new Error(`Could not reach the host (HTTP ${res.status})`);
        return res.json() as Promise<Me>;
      })
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}
