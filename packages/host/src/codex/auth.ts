import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The ChatGPT login Codex itself uses. `codex login` writes it to
// ~/.codex/auth.json and refreshes the access token in place, so callers
// re-read the file whenever they need a fresh token instead of caching it.
export interface CodexAuth {
  accessToken: string;
  accountId: string | null;
}

export function defaultCodexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

/** Returns null when Codex is not logged in with ChatGPT (missing file or API-key mode). */
export function readCodexAuth(codexHome = defaultCodexHome()): CodexAuth | null {
  let raw: string;
  try {
    raw = readFileSync(join(codexHome, "auth.json"), "utf8");
  } catch {
    return null;
  }
  let parsed: { tokens?: { access_token?: unknown; account_id?: unknown } };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return null;
  }
  const accessToken = parsed.tokens?.access_token;
  if (typeof accessToken !== "string" || !accessToken) return null;
  const accountId = parsed.tokens?.account_id;
  return { accessToken, accountId: typeof accountId === "string" && accountId ? accountId : null };
}
