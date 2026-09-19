# codex-pocket

A phone-sized PWA that talks straight to the Codex app-server on your Mac, over Tailscale or the LAN. Scan a QR code to pair; reconnects in a second.

[中文说明](./README.zh-CN.md)

## Features

- Thread list grouped by project, updated live as the desktop works; streamed replies with collapsible reasoning and tool calls; diff view
- Approvals (with policy switching), interrupt, `turn/steer`, the server-side follow-up queue (`thread/queue/*`, shared with the desktop app), model and reasoning effort, Fast tier
- New thread: project or project-less chat, work locally or in a new worktree, pick a branch
- Image attachments, `@file` mentions, `/skills`, dictation (Safari's built-in speech recognition), model questions, plan and usage display
- Rename, archive (swipe), fork and review threads
- Shares one app-server with the ChatGPT desktop app, so phone and desktop see the same threads
- Web Push notifications for finished turns, approvals, questions and errors (iOS: add to Home Screen first)

## Security model

The host is a **transparent proxy**: a paired phone gets everything the Codex app-server can do, including running commands and reading or writing files on the Mac. The only two boundaries are network reachability and the pairing code, so:

- Reach it over Tailscale (or the LAN) only. With `bindHost 127.0.0.1` the port is not exposed on the LAN at all. **Do not** put it on the public internet (Cloudflare Tunnel, port forwarding, …) without an extra layer of authentication.
- Pairing codes are 8 characters, valid for 10 minutes, and voided after 5 wrong guesses. Device tokens are stored hashed and can be revoked at any time; the admin endpoints accept loopback plus an admin token only.

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

A `Makefile` wraps the common tasks (`make start`, `make pair`, `make status`, …); run `make help` for the list.

State lives in `~/.codex-pocket/` (override with `CODEX_POCKET_HOME`): `devices.json` (token hashes and push subscriptions), `admin.token`, `vapid.json` (Web Push key pair), `runtime.json`, `config.json`, `certs/`, `uploads/` (images sent from the phone) and `host.log` (launchd mode).

## Deploying: HTTPS via Tailscale, run at login

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

Run at login (launchd):

```bash
pnpm build                                   # builds packages/host/dist and packages/web/dist
node packages/host/dist/cli.js install       # writes ~/Library/LaunchAgents/com.codex-pocket.host.plist and starts it
node packages/host/dist/cli.js uninstall     # remove
```

Logs go to `~/.codex-pocket/host.log`. After updating the code, `pnpm build` and `install` again to reload.

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
codex-pocket desktop        # show the link status
```

`serve` starts (or reuses) one shared app-server on `ws://127.0.0.1:7355` using the binary bundled with the desktop app; desktop and phone both connect to it, threads open on the desktop continue on the phone, and both stay in sync. `codex-pocket unlink-desktop` restores the default. Setting `"codex": {"mode": "daemon"}` in `~/.codex-pocket/config.json` switches back to the official daemon mode, where threads open on the desktop show as locked.

After upgrading Codex, regenerate the protocol types:

```bash
pnpm --filter @codex-pocket/protocol generate
```

## License

MIT. The files under `packages/protocol/src/generated` are produced by `codex app-server generate-ts` from the OpenAI Codex CLI (Apache-2.0) and redistributed unchanged; see [packages/protocol/NOTICE](./packages/protocol/NOTICE).
