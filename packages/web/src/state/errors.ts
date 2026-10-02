import { isConnectionError } from "../rpc/client.js";

// Errors reach the phone as raw RPC messages ("connection closed", "thread
// not ready"). The few that come up in normal use get a sentence a person
// can act on; everything else is shown as-is, since Codex's own messages
// are usually already readable.
const FRIENDLY: [RegExp, string][] = [
  [/^thread not ready$/i, "This thread is still loading. Try again in a moment."],
  [/connection closed before response|proxy stopped|ENOENT|ECONNREFUSED/i, "Codex isn't running on your Mac. Start the Codex app and try again."],
  [/^Compact is disabled while a turn is in progress$/i, "Wait for the current turn to finish before compacting."],
  [/no rollout found/i, "Codex hasn't saved this thread yet. Send a message first."],
];

/** The message to show a person for `err`. */
export function friendlyError(err: unknown): string {
  if (isConnectionError(err)) {
    if (/timed out|outcome may be unknown/.test(err.message)) return "The computer did not confirm this request. Check the thread before sending again.";
    return "Lost the connection to your Mac. Reconnecting…";
  }
  const raw = err instanceof Error ? err.message : String(err);
  for (const [pattern, text] of FRIENDLY) if (pattern.test(raw)) return text;
  return raw;
}
