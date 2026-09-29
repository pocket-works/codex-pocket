# codex-pocket

A phone-sized PWA that talks straight to the Codex app-server on your Mac, over Tailscale or the LAN. Scan a QR code to pair; reconnects in a second.

[中文说明](./README.zh-CN.md)

## Features

- Thread list grouped by the desktop app's real projects (`project/list`), so adding or deleting a project on the Mac shows up here immediately instead of leaving a stale folder behind; streamed replies with collapsible reasoning and tool calls; diff view
- Approvals (with policy switching), interrupt, `turn/steer`, the server-side follow-up queue (`thread/queue/*`, shared with the desktop app), model and reasoning effort, Fast tier
- New thread: project or project-less chat, work locally or in a new worktree, pick a branch
- Image attachments, `@file` mentions, `/skills`, dictation (streamed through the host to the same ChatGPT speech backend the desktop app's dictation uses, so identifiers and mixed-language speech come out right), model questions, plan and usage display
- Rename, archive (swipe), fork and review threads
- Shares one app-server with the ChatGPT desktop app, so phone and desktop see the same threads
- Web Push notifications for finished turns, approvals, questions and errors (iOS: add to Home Screen first)

## Requirements

- **A Mac with Apple silicon.** `make app` builds an arm64 bundle, and the icon is rendered with macOS's own `qlmanage`, `sips` and `iconutil`.
- **Codex already signed in on that Mac** — the ChatGPT desktop app or the `codex` CLI, whichever you use. The host never signs in to OpenAI itself: it connects to the app-server Codex runs and inherits that session.
- **Node 22 and pnpm**, to build it. The packaged menu bar app carries its own Node, so nothing is needed at runtime.
- **A phone that can reach the Mac**, over Tailscale or the LAN. On iOS, add the PWA to the Home Screen: web push does not arrive in a Safari tab.

## Quick start

On the Mac, with Codex already signed in:

```bash
pnpm install --frozen-lockfile
make app
make open-app
```

Open **Pair a phone...** from the Codex Pocket menu bar icon, then scan its QR code with a phone on the same LAN. You can also open the displayed address on the phone and enter the pairing code. For access away from home, set up [Tailscale HTTPS](#deploying-https-via-tailscale). Locally built apps remain unsigned; the v0.1.0 zip is also unsigned. Signed and notarized releases will be distributed as DMGs.

For a DMG installation, install and sign in to ChatGPT on the Mac first, then open Codex Pocket. Its host starts the official Codex daemon on demand using the CLI bundled with ChatGPT; no separate Codex CLI, Node, or pnpm install is required. Choose **Desktop sharing > Link desktop…** in the Pocket menu, then quit and reopen ChatGPT. If a daemon is already running without the desktop tools environment, linking restarts it once and interrupts active turns; a fresh daemon needs no restart.

![Codex Pocket pairing screen on a phone](./docs/screenshots/pairing.jpg)

This is an Apple silicon build. Desktop app sharing through `link-desktop` additionally requires a Codex daemon whose `account/read` response includes `workspaceRouting` (Codex CLI 0.156.0 or newer); `codex-pocket desktop` checks that capability. Dictation depends on an undocumented ChatGPT endpoint and may stop working when that endpoint changes.

## Security model

The host is a **transparent proxy**: a paired phone gets everything the Codex app-server can do, including running commands and reading or writing files on the Mac. The only two boundaries are network reachability and the pairing code, so:

- Reach it over Tailscale (or the LAN) only. With `bindHost 127.0.0.1` the port is not exposed on the LAN at all. **Do not** put it on the public internet (Cloudflare Tunnel, port forwarding, …) without an extra layer of authentication.
- Pairing codes are 8 characters, valid for 10 minutes, and voided after 5 wrong guesses. Device tokens are stored hashed and can be revoked at any time; the admin endpoints accept loopback plus an admin token only.
- Dictation reuses the ChatGPT login in `~/.codex/auth.json` against an undocumented backend (`backend-api/dictation/stream`, the one the Codex desktop app's own dictation button talks to). Audio from the phone goes to OpenAI; nothing is stored on the host. If OpenAI changes that endpoint, dictation stops working until this project catches up. The host dials chatgpt.com directly and does not read `HTTPS_PROXY`; if your Mac needs a proxy for that, set `config set outboundProxy http://127.0.0.1:1082`. Dictation start errors such as "did not answer session.start in time" usually mean exactly that.

## Running it: the menu bar app

The host runs inside **Codex Pocket**, a small macOS menu bar app in `packages/desktop`. Opening the app starts the host and quitting it stops the host. If desktop sharing is linked, its separate local bridge stays running until `unlink-desktop`. The dot in the menu bar shows the state (grey stopped, yellow starting, green running, red error) and the menu shows the address, whether the Codex daemon is connected, the paired phones (with revoke), and **Pair a phone…**, which shows the QR code and the typed code. **Keep this Mac awake** holds off idle sleep while the host runs, so a phone can start a turn and a running turn is not cut short (the display still sleeps; closing the lid on battery still sleeps the Mac). The choice is kept in `~/.codex-pocket/desktop.json`.

`make app` builds `packages/desktop/release/mac-arm64/Codex Pocket.app`; you can also drag it to `/Applications`. The app bundles the host and the PWA, so it does not need a system Node. The Codex app-server itself is the official daemon (`codex app-server daemon start`) and belongs to Codex, so the app only reports its connection state and never stops it.

## Development

```bash
pnpm install
pnpm test
pnpm dev:host info      # app-server connection details
pnpm dev:host threads   # recent threads from the desktop Codex
pnpm dev:host serve     # serve; prints a pairing QR on first start
pnpm dev:host pair      # pair another phone
pnpm dev:host devices   # paired phones
pnpm dev:host revoke <id>
```

A `Makefile` wraps the common tasks (`make app`, `make start`, `make pair`, `make status`, …); run `make help` for the list. `pnpm --filter @codex-pocket/desktop dev` runs the menu bar app from the workspace (it bundles the host from source first); after changing host code, run it again or pick **Restart host** in the menu after `pnpm --filter @codex-pocket/desktop bundle`.

To contribute, start with [CONTRIBUTING.md](./CONTRIBUTING.md); package boundaries and code conventions are in [AGENTS.md](./AGENTS.md).
For maintainers, the manual macOS packaging and release checks are in [docs/releasing.md](./docs/releasing.md).

State lives in `~/.codex-pocket/` (override with `CODEX_POCKET_HOME`): `devices.json` (token hashes and push subscriptions), `admin.token`, `vapid.json` (Web Push key pair), `runtime.json`, `config.json`, `certs/`, `uploads/` (images sent from the phone), `host.log`, and `desktop-bridge.log` when desktop sharing is linked.

## Deploying: HTTPS via Tailscale

The host itself speaks plain HTTP; `tailscale serve` terminates TLS in front of it, so one URL works at home and away (on the same LAN, Tailscale takes the direct path):

1. Install Tailscale on the Mac and the phone with the same account, and enable **HTTPS Certificates** in the [admin console](https://login.tailscale.com/admin/dns) (the first `tailscale serve` prints the link).
2. On the Mac, proxy the tailnet name to the host and tell the host which origin phones should use (stored in `~/.codex-pocket/config.json`, picked up by every `serve`):

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:7333
   pnpm dev:host config set publicUrl https://<mac>.<tailnet>.ts.net
   pnpm dev:host config set bindHost 127.0.0.1   # loopback only: nothing else on the LAN can reach 7333
   ```

3. `pnpm dev:host pair` now prints a QR pointing at `https://<mac>.<tailnet>.ts.net/#pair=…`; scan it on the phone (Tailscale connected). Tailscale issues and renews the certificate.
4. For the full-screen experience use "Add to Home Screen" in Safari. iOS gives home-screen apps their own storage, so the installed app asks to pair once more: run `pair` again and scan the QR from inside the app, or type the 8-character code it prints.
5. In the app's Settings, turn on **Notifications**. The host pushes when a turn finishes, Codex asks for approval or input, or a turn fails — unless the app is open on that thread.

`pnpm dev:host config` shows the current settings; `config unset <key>` restores a default.

Without Tailscale, drop your own PEMs into `~/.codex-pocket/certs/fullchain.pem` and `certs/privkey.pem` and the host serves HTTPS itself (`--no-tls` forces plain HTTP). On a trusted LAN you can skip HTTPS altogether — leave `bindHost` unset and open `http://<LAN IP>:7333` — at the cost of features that need a secure context, such as push notifications.

Logs go to `~/.codex-pocket/host.log`; the Codex daemon logs to `~/.codex/app-server-control/app-server.log`.

Once the PWA is built, `serve` picks it up from `packages/web/dist`:

```bash
pnpm --filter @codex-pocket/web build
pnpm dev:host serve
```

## Sharing threads with the desktop app (recommended)

Codex's writer lock is a cross-process file lock: the ChatGPT desktop app spawns a private `app-server` by default, so a phone connected to a different process cannot open threads the desktop has open. The fix is to put both in the same process:

```bash
codex-pocket link-desktop   # starts a persistent local bridge, then links ChatGPT to it
# quit and reopen ChatGPT
codex-pocket desktop        # show the link status, and whether the daemon is ready to be linked
```

`serve` connects to the official Codex daemon (`codex app-server daemon start`, reachable on `~/.codex/app-server-control/app-server-control.sock`). Pocket uses the CLI bundled in ChatGPT when `CODEX_BIN` is unset and that app is installed; otherwise it uses the CLI on your shell's `PATH`. `link-desktop` installs a user LaunchAgent for a small bridge from `ws://127.0.0.1:7355` to that socket. The bridge uses Pocket's bundled Electron runtime, checks an app-server connection before setting `CODEX_APP_SERVER_WS_URL` for the desktop app, and `link-desktop` waits for it to be ready. It works on first link even if Pocket is closed. The bridge keeps running after Pocket quits and is removed by `unlink-desktop`; the daemon remains owned by Codex. Both clients end up in that one daemon, so desktop threads continue on the phone and stay in sync. The bridge starts Codex through your interactive login shell, so the daemon sees the same `PATH`, proxy variables and provider API keys as your terminal. `link-desktop` first checks that the daemon's `account/read` reports `workspaceRouting`: the desktop app routes every backend call (sign-in lookup, dictation) through it and silently loses both when it is missing, which is the case with standalone codex 0.155.1 while the copy bundled in ChatGPT.app already has it. The field ships in codex 0.156.0 (openai/codex#45529); until the daemon runs that, the command refuses (`--force` overrides) and the desktop keeps its private app-server. `codex-pocket desktop` runs the same check, so after a Codex update it says whether linking will work. The desktop app's own tools for Codex (create or hand off threads, automations; the bundled `codex_app` MCP server) reach it through a unix socket the app opens at each launch. The bridge keeps `~/.codex-pocket/app-tools.sock` pointed at that socket and has the MCP server run under the app's own signed node, which the socket requires; a daemon started before this may be restarted once by `link-desktop` (running turns are interrupted). `codex-pocket unlink-desktop` restores the desktop's private app-server after restarting ChatGPT. `"codex": {"port": N}` in `~/.codex-pocket/config.json` changes the bridge port; run `link-desktop` again after changing it.

When upgrading from a version that ran its own `com.codex-pocket.shared-app-server` LaunchAgent, `link-desktop` removes it before installing the bridge; finish active desktop turns first.
After upgrading from a version where the host owned the desktop bridge, restart Pocket and run `link-desktop` again to install the independent bridge before quitting Pocket.

After upgrading Codex, regenerate the protocol types:

```bash
pnpm --filter @codex-pocket/protocol generate
```

## Releases

Versioned macOS builds are available from [GitHub Releases](https://github.com/jerryan999/codex-pocket/releases). Versions follow Semantic Versioning across all workspace packages; changes are tracked in [CHANGELOG.md](./CHANGELOG.md). A `v<version>` tag creates a draft Release after CI. Signed, notarized DMGs are built and verified on the maintainer's Mac before upload and publication. See the [release process](./docs/releasing.md).

## License

MIT. The files under `packages/protocol/src/generated` are produced by `codex app-server generate-ts` from the OpenAI Codex CLI (Apache-2.0) and redistributed unchanged; see [packages/protocol/NOTICE](./packages/protocol/NOTICE).
