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

## Security model

The host is a **transparent proxy**: a paired phone gets everything the Codex app-server can do, including running commands and reading or writing files on the Mac. The only two boundaries are network reachability and the pairing code, so:

- Reach it over Tailscale (or the LAN) only. With `bindHost 127.0.0.1` the port is not exposed on the LAN at all. **Do not** put it on the public internet (Cloudflare Tunnel, port forwarding, …) without an extra layer of authentication.
- Pairing codes are 8 characters, valid for 10 minutes, and voided after 5 wrong guesses. Device tokens are stored hashed and can be revoked at any time; the admin endpoints accept loopback plus an admin token only.
- Dictation reuses the ChatGPT login in `~/.codex/auth.json` against an undocumented backend (`backend-api/dictation/stream`, the one the Codex desktop app's own dictation button talks to). Audio from the phone goes to OpenAI; nothing is stored on the host. If OpenAI changes that endpoint, dictation stops working until this project catches up. The host dials chatgpt.com directly and does not read `HTTPS_PROXY`; if your Mac needs a proxy for that, set `config set outboundProxy http://127.0.0.1:1082`. Dictation start errors such as "did not answer session.start in time" usually mean exactly that.

## Running it: the menu bar app

The host runs inside **Codex Pocket**, a small macOS menu bar app in `packages/desktop`. Opening the app starts the host and quitting it stops the host; nothing stays behind in the background. The dot in the menu bar shows the state (grey stopped, yellow starting, green running, red error) and the menu shows the address, whether the Codex daemon is connected, the paired phones (with revoke), and **Pair a phone…**, which shows the QR code and the typed code. **Keep this Mac awake** holds off idle sleep while the host runs, so a phone can start a turn and a running turn is not cut short (the display still sleeps; closing the lid on battery still sleeps the Mac). The choice is kept in `~/.codex-pocket/desktop.json`.

```bash
pnpm install
make app            # builds packages/desktop/release/mac-arm64/Codex Pocket.app
make open-app       # or drag the .app to /Applications and open it from there
```

The app bundles the host and the PWA, so it does not need a system Node. It is unsigned; on first launch use right-click → Open. The Codex app-server itself is the official daemon (`codex app-server daemon start`) and belongs to Codex, so the app only reports its connection state and never stops it.

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

State lives in `~/.codex-pocket/` (override with `CODEX_POCKET_HOME`): `devices.json` (token hashes and push subscriptions), `admin.token`, `vapid.json` (Web Push key pair), `runtime.json`, `config.json`, `certs/`, `uploads/` (images sent from the phone), `host.log`.

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
codex-pocket link-desktop   # sets CODEX_APP_SERVER_WS_URL=ws://127.0.0.1:7355/ via a login-time LaunchAgent
# quit and reopen ChatGPT
codex-pocket desktop        # show the link status, and whether the daemon is ready to be linked
```

`serve` connects to the official Codex daemon (`codex app-server daemon start`, reachable on `~/.codex/app-server-control/app-server-control.sock`) and relays `ws://127.0.0.1:7355` onto that socket for the desktop app. Codex owns the daemon process: it starts it on demand, keeps its pid, and self-updates. The host starts it through your interactive login shell, exactly as the desktop app does over SSH, so the daemon sees the same `PATH`, proxy variables and provider API keys your terminal has. Desktop and phone both end up in that one process, threads open on the desktop continue on the phone, and both stay in sync. `link-desktop` first checks that the daemon's `account/read` reports `workspaceRouting`: the desktop app routes every backend call (sign-in lookup, dictation) through it and silently loses both when it is missing, which is the case with standalone codex 0.155.1 while the copy bundled in ChatGPT.app already has it. The field ships in codex 0.156.0 (openai/codex#45529); until the daemon runs that, the command refuses (`--force` overrides) and the desktop keeps its private app-server. `codex-pocket desktop` runs the same check, so after a Codex update it says whether linking will work. The desktop app's own tools for Codex (create or hand off threads, automations; the bundled `codex_app` MCP server) reach it through a unix socket the app opens at each launch and normally hands to the app-server it spawns. For a linked desktop the host starts the daemon with a fixed path, `~/.codex-pocket/app-tools.sock`, keeps that symlink pointed at the running app's socket (found in its log), and has the MCP server run under the app's own signed node, which the socket requires; a daemon started before this is restarted once by `link-desktop` (running turns are interrupted). `codex-pocket unlink-desktop` restores the desktop's private app-server. `"codex": {"port": N}` in `~/.codex-pocket/config.json` changes the relay port.

When upgrading from a version that ran its own `com.codex-pocket.shared-app-server` LaunchAgent, the next `serve` removes that agent and takes over the port; finish active desktop turns first.

After upgrading Codex, regenerate the protocol types:

```bash
pnpm --filter @codex-pocket/protocol generate
```

## License

MIT. The files under `packages/protocol/src/generated` are produced by `codex app-server generate-ts` from the OpenAI Codex CLI (Apache-2.0) and redistributed unchanged; see [packages/protocol/NOTICE](./packages/protocol/NOTICE).
