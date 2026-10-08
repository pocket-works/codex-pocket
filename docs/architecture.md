# Architecture and code guide

This guide is for contributors. For installation, pairing and troubleshooting, start with [README.md](../README.md). Code conventions are in [AGENTS.md](../AGENTS.md).

## Package map

| Package | Responsibility | Useful entry points |
| :--- | :--- | :--- |
| `packages/web` | React PWA that speaks the Codex protocol and presents threads, files, approvals and per-computer state. | [UI](../packages/web/src/ui/), [session](../packages/web/src/state/session.ts), [computer registry](../packages/web/src/state/computers.ts), [RPC client](../packages/web/src/rpc/client.ts) |
| `packages/host` | Mac-side authenticated proxy, phone pairing, uploads, push notifications and dictation forwarding. | [server](../packages/host/src/server/lan-server.ts), [proxy](../packages/host/src/proxy/codex-proxy.ts), [Codex connection](../packages/host/src/codex/), [CLI](../packages/host/src/cli.ts) |
| `packages/desktop` | Electron menu bar app that starts and stops the Pocket host, exposes pairing and desktop sharing, and packages the PWA. | [main](../packages/desktop/src/main.ts), [menu](../packages/desktop/src/menu.ts), [supervisor](../packages/desktop/src/supervisor.ts), [packaging scripts](../packages/desktop/scripts/) |
| `packages/protocol` | Types generated from the Codex CLI and exported for the other packages. Contains no runtime code. | [generator](../packages/protocol/scripts/generate.sh), [exports](../packages/protocol/src/index.ts) |

## Where to start

- Phone layout and interaction: `packages/web/src/ui/` and `packages/web/src/styles.css`.
- Thread operations and protocol events: `packages/web/src/state/session.ts` and `packages/web/src/rpc/client.ts`.
- Pairing and phone endpoints: `packages/host/src/server/lan-server.ts` and `packages/host/src/auth/`.
- Notifications: `packages/host/src/push/` generates events; `packages/web/src/state/push.ts` manages subscriptions and `packages/web/src/push-worker.ts` displays them.
- Dictation: `packages/web/src/state/dictation.ts` streams audio to `packages/host/src/dictation/`.
- App menu, host lifecycle and builds: `packages/desktop/src/` and `packages/desktop/scripts/`.

Tests live in each package's `test/` directory. Host protocol tests can use the fake app-server in [helpers.ts](../packages/host/test/helpers.ts). Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for setup and validation commands.

## State and process boundaries

The PWA speaks the Codex protocol directly. The host is a thin authenticated proxy and does not recreate chat state server-side. Codex owns thread history, task execution and the official daemon process; Pocket owns phone access and its own configuration.

The menu bar app supervises the Pocket host only. Quitting Pocket stops phone access but does not stop the official Codex daemon. Desktop sharing uses a separate user LaunchAgent, so its local bridge outlives the menu bar app until unlinked.

Codex uses cross-process writer locks in `~/.codex/thread-writer-locks/`. A different app-server cannot take over a thread already held by the desktop app. Shared desktop access puts both clients in the same daemon instead of taking its lock.

## Daemon connection and desktop sharing

`serve` connects to the official Codex daemon (`codex app-server daemon start`, reachable on `~/.codex/app-server-control/app-server-control.sock`). Pocket uses the CLI bundled in ChatGPT when `CODEX_BIN` is unset and that app is installed; otherwise it uses the CLI on your shell's `PATH`. `link-desktop` installs a user LaunchAgent for a small bridge from `ws://127.0.0.1:7355` to that socket. The bridge uses Pocket's bundled Electron runtime, checks an app-server connection before setting `CODEX_APP_SERVER_WS_URL` for the desktop app, and `link-desktop` waits for it to be ready. It works on first link even if Pocket is closed. The bridge keeps running after Pocket quits and is removed by `unlink-desktop`; the daemon remains owned by Codex. Both clients end up in that one daemon, so desktop threads continue on the phone and stay in sync.

The bridge starts Codex through your interactive login shell, so the daemon sees the same `PATH`, proxy variables and provider API keys as your terminal. `link-desktop` first checks that the daemon's `account/read` reports `workspaceRouting`: the desktop app routes every backend call (sign-in lookup, dictation) through it and silently loses both when it is missing, which is the case with standalone codex 0.155.1 while the copy bundled in ChatGPT.app already has it. The field ships in codex 0.156.0 (openai/codex#45529); until the daemon runs that, the command refuses (`--force` overrides) and the desktop keeps its private app-server. `codex-pocket desktop` runs the same check, so after a Codex update it says whether linking will work.

The desktop app's own tools for Codex (create or hand off threads, automations; the bundled `codex_app` MCP server) reach it through a unix socket the app opens at each launch. The bridge keeps `~/.codex-pocket/app-tools.sock` pointed at that socket and has the MCP server run under the app's own signed node, which the socket requires; a daemon started before this may be restarted once by `link-desktop` (running turns are interrupted).

`codex-pocket unlink-desktop` restores the desktop's private app-server after restarting ChatGPT. `"codex": {"port": N}` in `~/.codex-pocket/config.json` changes the bridge port; run `link-desktop` again after changing it.

## Protocol updates

`packages/protocol` is types-only. Regenerate declarations with the installed Codex CLI when updating the protocol:

```bash
pnpm --filter @codex-pocket/protocol generate
```

The generator invokes `codex` from `PATH`, while the host can prefer the CLI bundled in ChatGPT or one selected with `CODEX_BIN`. Use the intended CLI version when regenerating; `packages/protocol/src/generated/CODEX_VERSION` records the generator's version.

Never edit `packages/protocol/src/generated` by hand or add runtime code to this package. Keep protocol changes and the behavior that uses them reviewable together.
