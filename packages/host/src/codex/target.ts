import { CodexClient } from "./codex-client.js";

// Connect function for the proxy and the CLI: the official daemon, started
// on demand through the user's login shell (see locate.ts).
export function codexConnector(): () => Promise<CodexClient> {
  return () => CodexClient.connect();
}
