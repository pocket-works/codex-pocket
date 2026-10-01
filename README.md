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
- Multiple computers in one installed PWA, with separate credentials, drafts, pins and notification subscriptions

## Screenshots

| Threads | Conversation | Approval |
| :---: | :---: | :---: |
| <img src="./docs/screenshots/threads.jpg" width="240" alt="Chats and project threads on a phone"> | <img src="./docs/screenshots/conversation.jpg" width="240" alt="Conversation with reasoning, a command and a final answer"> | <img src="./docs/screenshots/approval.jpg" width="240" alt="Command approval sheet on a phone"> |

These screens use sample conversations and paths; no personal thread content or pairing credentials are shown.

## Requirements

- **A Mac with Apple silicon.** The published DMG and locally built app target arm64.
- **Codex already signed in on that Mac.** For the DMG, install and sign in to the ChatGPT desktop app first; Pocket can use its bundled Codex CLI. A source build can also use an installed `codex` CLI. The host inherits Codex's login session rather than signing in itself.
- **Node 22 and pnpm only for source builds.** The DMG contains the menu bar app, host and PWA; it needs neither at runtime.
- **A phone that can reach the Mac**, over Tailscale or the LAN. On iOS, add the PWA to the Home Screen: web push does not arrive in a Safari tab.

## Quick start

### Install the DMG

1. On an Apple silicon Mac, install and sign in to the ChatGPT desktop app.
2. Download the signed and notarized Apple silicon DMG from the [latest release](https://github.com/pocket-works/codex-pocket/releases/latest). Open it, drag **Codex Pocket** to **Applications**, then launch it from Applications. The app appears in the menu bar.
3. For notifications on iPhone, set up [Tailscale HTTPS](#deploying-https-via-tailscale) before pairing. Otherwise, connect the phone and Mac to the same LAN. Choose **Pair a phone…** from the Pocket menu and scan the QR code, or open the displayed address and enter the code manually. The code expires after 10 minutes.
4. In Safari, open the PWA at the address you intend to keep (the HTTPS address if you want notifications), then choose **Add to Home Screen**. Open the installed PWA and pair again from the Pocket menu: iOS keeps its storage separate from Safari. For Web Push, open **Menu → Computers**, open your Mac's details using its information button, and enable **Notifications**.

To share active threads with the ChatGPT desktop app, choose **Desktop sharing > Link desktop…** in the Pocket menu, then quit and reopen ChatGPT. If the existing Codex daemon lacks the desktop tools environment, linking restarts it once and interrupts active turns. You can use Pocket without linking, but a thread held by a separate desktop app-server cannot be opened for writing from the phone.

![Codex Pocket pairing screen on a phone](./docs/screenshots/pairing.jpg)

### Build from source

With Codex signed in, Node 22+ and pnpm installed on an Apple silicon Mac:

```bash
pnpm install --frozen-lockfile
make app
make open-app
```

Pair the phone from the menu as above. `make app` produces an unsigned development build; use the release DMG for a signed, notarized installation. The older v0.1.0 zip was unsigned; v0.1.1 and later releases use a DMG.

This is an Apple silicon build. Desktop app sharing through `link-desktop` additionally requires a Codex daemon whose `account/read` response includes `workspaceRouting` (Codex CLI 0.156.0 or newer); `codex-pocket desktop` checks that capability. Dictation depends on an undocumented ChatGPT endpoint and may stop working when that endpoint changes.

## Multiple computers

1. Run an updated Codex Pocket on each Mac and configure a separate [Tailscale HTTPS](#deploying-https-via-tailscale) address for each one.
2. Keep one installed phone PWA. Open **Menu → Computers**, choose **Add computer**, and scan the other Mac's pairing QR inside that PWA. Manual pairing takes the other Mac's HTTPS address and its code.
3. Select a computer from **Computers** to switch. Threads, projects, files and tasks belong to that computer. Switching saves drafts and does not stop running turns; an in-progress send or upload finishes before switching is available.
4. Open a computer's information button to rename, pair again, remove, or toggle its notifications. Technical pairing information is always visible under **Connection details** at the bottom of the computer page. Returning from details restores your chat or draft. Removing revokes this phone's access when the Mac is reachable. **Remove locally** only forgets the phone's credentials; revoke the old pairing on the Mac afterward. **Menu → About** shows the phone app version.

The installed PWA keeps its original address. Once its resources have been cached, it can open and connect to another Mac while the entry Mac is unavailable. Initial installation, updates and registration of new notification workers require the entry address to be reachable. Each computer uses its own scoped Web Push subscription; notification clicks select that computer and thread. Concurrent notifications from multiple computers still require verification on an installed iPhone PWA.

An upgrade migrates the existing pairing and local data at this PWA's origin. Storage from separate browser origins or Home Screen apps cannot be imported automatically: add those Macs again from the PWA you keep. An address change requires a fresh pairing; existing tokens are never sent to an edited address.

## Security model

The host is a **transparent proxy**: a paired phone gets everything the Codex app-server can do, including running commands and reading or writing files on the Mac. The only two boundaries are network reachability and the pairing code, so:

- Reach it over Tailscale (or the LAN) only. With `bindHost 127.0.0.1` the port is not exposed on the LAN at all. **Do not** put it on the public internet (Cloudflare Tunnel, port forwarding, …) without an extra layer of authentication.
- Pairing codes are 8 characters, valid for 10 minutes, and voided after 5 wrong guesses. Device tokens are stored hashed and can be revoked at any time; the admin endpoints accept loopback plus an admin token only.
- Browser pairings are bound to the PWA origin. Cross-origin phone APIs require that pairing's token and origin; admin APIs have no cross-origin access. The phone retains a separate token for each computer.
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
2. On the Mac, proxy the tailnet name to the host:

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:7333
   ```

   If you installed the DMG, add these fields to `~/.codex-pocket/config.json` (preserve any existing fields), replacing the sample tailnet name, then quit and reopen Pocket:

   ```json
   {
     "publicUrl": "https://<mac>.<tailnet>.ts.net",
     "bindHost": "127.0.0.1"
   }
   ```

   For a source build, use the equivalent CLI commands below, replacing the sample tailnet name. Restart the host afterward (`make restart` if you started it with `make start`):

   ```bash
   pnpm dev:host config set publicUrl "https://<mac>.<tailnet>.ts.net"
   pnpm dev:host config set bindHost 127.0.0.1   # loopback only: nothing else on the LAN can reach 7333
   ```

3. In the Pocket menu choose **Pair a phone…**; the QR points at `https://<mac>.<tailnet>.ts.net/#pair=…`. Scan it on the phone with Tailscale connected. Source-build users can also run `pnpm dev:host pair`. Tailscale issues and renews the certificate.
4. For the full-screen experience use "Add to Home Screen" in Safari. The installed PWA needs its own pairing: choose **Pair a phone…** again, then scan inside the PWA or type the 8-character code.
5. Open **Menu → Computers**, open your Mac's details, and turn on **Notifications**. The host pushes when a turn finishes, Codex asks for approval or input, or a turn fails — unless the app is open on that thread.

For source builds, `pnpm dev:host config` shows the current settings and `config unset <key>` restores a default. For DMG installations, edit `~/.codex-pocket/config.json` and restart Pocket to apply changes.

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

Versioned macOS builds are available from [GitHub Releases](https://github.com/pocket-works/codex-pocket/releases). Versions follow Semantic Versioning across all workspace packages; changes are tracked in [CHANGELOG.md](./CHANGELOG.md). A `v<version>` tag creates a draft Release after CI. Signed, notarized DMGs are built and verified on the maintainer's Mac before upload and publication. See the [release process](./docs/releasing.md).

## License

MIT. The files under `packages/protocol/src/generated` are produced by `codex app-server generate-ts` from the OpenAI Codex CLI (Apache-2.0) and redistributed unchanged; see [packages/protocol/NOTICE](./packages/protocol/NOTICE).
