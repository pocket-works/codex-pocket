import { join } from "node:path";
import { pocketHome } from "../config/paths.js";
import { codexSettings, type CodexSettings } from "../config/settings.js";
import { CodexClient } from "./codex-client.js";
import { ensureSharedAppServer } from "./shared-app-server.js";

export function sharedAppServerLog(): string {
  return join(pocketHome(), "shared-app-server.log");
}

// Turns the configured codex mode into a connect function for the proxy and
// the CLI. In shared mode this also (re)starts the shared app-server.
export function codexConnector(settings: CodexSettings = codexSettings(), log?: (m: string) => void): () => Promise<CodexClient> {
  if (settings.mode === "daemon") return () => CodexClient.connect();
  return async () => {
    const url = await ensureSharedAppServer({ port: settings.port, binary: settings.binary, logFile: sharedAppServerLog(), log });
    return CodexClient.connect({ url });
  };
}
