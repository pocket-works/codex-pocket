// The device token is a credential for this phone, not a user setting, so
// localStorage is the right place for it.
const TOKEN_KEY = "codex-pocket.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function pairingCodeFromUrl(): string | null {
  const m = location.hash.match(/^#pair=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** The code from a scanned QR: either the #pair= link `pair` prints, or a bare code. */
export function pairingCodeFromScan(text: string): string | null {
  const m = text.match(/#pair=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return /^[A-Za-z0-9-]{8,12}$/.test(text.trim()) ? text.trim() : null;
}

export async function redeemPairingCode(code: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, deviceName: deviceName(navigator.userAgent, isStandalone()) }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error("Can't reach your Mac. Make sure Codex Pocket is running and try pairing again.");
  }
  if (!res.ok) throw new Error(res.status === 403 ? "Pairing code is invalid or expired. Run `codex-pocket pair` again." : `Pairing failed (HTTP ${res.status})`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

// The Home Screen app and the browser tab on the same phone keep separate
// storage and so pair separately; say which one this is so the Mac can tell
// them apart.
export function deviceName(userAgent: string, standalone: boolean): string {
  const kind = /iPhone/.test(userAgent) ? "iPhone" : /iPad/.test(userAgent) ? "iPad" : /Android/.test(userAgent) ? "Android phone" : /Macintosh/.test(userAgent) ? "Mac" : "Device";
  return `${kind} (${standalone ? "Home Screen" : "browser"})`;
}

export function wsUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws`;
}
