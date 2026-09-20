// The ChatGPT desktop app only works against an app-server whose
// `account/read` carries `workspaceRouting`: it routes every backend call
// (account lookup, dictation connect-info, telemetry) through that field and
// fails all of them with "Workspace routing is unavailable" when it is
// missing. The codex bundled inside ChatGPT.app has it; the standalone
// release the official daemon runs may lag behind. Check before linking so
// the desktop is not left half signed-in.

export interface DesktopCompat {
  ok: boolean;
  /** Human-readable explanation when `ok` is false. */
  reason?: string;
}

export function desktopCompat(accountRead: unknown, appServerVersion?: string): DesktopCompat {
  const result = accountRead as { account?: unknown; workspaceRouting?: unknown } | null | undefined;
  if (!result || typeof result !== "object") {
    return { ok: false, reason: "account/read returned nothing; is the daemon signed in?" };
  }
  if (result.account == null) {
    return { ok: false, reason: "the daemon is not signed in to Codex (run `codex login`)" };
  }
  if (result.workspaceRouting == null) {
    const ver = appServerVersion ? ` (${appServerVersion})` : "";
    return {
      ok: false,
      reason: `the daemon's codex${ver} does not report workspaceRouting in account/read; the ChatGPT desktop app needs it and would lose sign-in and dictation. Wait for a newer codex release before linking.`,
    };
  }
  return { ok: true };
}
