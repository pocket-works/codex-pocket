# Linux server deployment (experimental)

Codex Pocket v0.3.0 adds a headless Linux x86_64 host. The archive includes the host, built phone PWA, launcher, systemd user unit and license notices. Node.js and Codex are installed separately; running the archive needs no pnpm, Electron or source checkout.

Debian 13 x86_64 with Node.js 22.23.3 and Codex CLI 0.161.0 was tested with an installed iPhone PWA: pairing, streamed replies, notifications and notification navigation, and microphone dictation worked. Automated and browser checks also covered files, Git/worktrees, approvals, queues, history, offline shell and reconnects. ARM64, other distributions, Android and a Linux desktop app are unverified. Dictation uses an undocumented ChatGPT endpoint; an iPhone tester reported a delay before text appeared. This release does not resolve that latency.

## Prerequisites

- Linux x86_64, Node.js **22.12+**, and an installed, signed-in Codex CLI supporting `codex app-server daemon start` (tested with **0.161.0**).
- A bash, zsh, dash or sh login shell. Codex is invoked through your interactive login shell to inherit its PATH, provider keys and proxy configuration. Configure those as you do for Codex in your terminal. Set `CODEX_BIN` to the CLI's absolute path if needed.
- The server can reach its model provider and, for notifications/dictation, the relevant push services and ChatGPT endpoints. Dictation requires a ChatGPT login. Its optional HTTP proxy is configured separately with `codex-pocket config set outboundProxy <url>`.
- A phone that can reach the server. Use HTTPS for the installed PWA, push and microphone access. The example below uses Tailscale on both devices; there is no need to open a public firewall port.

Use your regular non-root Codex account for Pocket. Do not copy a login token into the deployment archive or a service unit.

## Install and configure

Download `codex-pocket-v0.3.0-linux-x64.tar.gz` and its `.sha256` from [GitHub Releases](https://github.com/pocket-works/codex-pocket/releases). In their download directory:

```bash
sha256sum -c codex-pocket-v0.3.0-linux-x64.tar.gz.sha256
mkdir -p "$HOME/.local/share/codex-pocket" "$HOME/.local/bin"
tar -xzf codex-pocket-v0.3.0-linux-x64.tar.gz -C "$HOME/.local/share/codex-pocket"
ln -sfn codex-pocket-v0.3.0-linux-x64 "$HOME/.local/share/codex-pocket/current"
ln -sfn "$HOME/.local/share/codex-pocket/current/bin/codex-pocket" "$HOME/.local/bin/codex-pocket"
```

Add `$HOME/.local/bin` to your shell PATH, then check `node --version`, `codex --version`, `codex login status` and `codex app-server daemon start`. Codex owns the daemon; Pocket connects to its Unix socket and does not supervise or stop it.

Configure Tailscale MagicDNS and HTTPS certificates for your tailnet. Replace the example hostname below with the server's Tailscale DNS name:

```bash
codex-pocket config set bindHost 127.0.0.1
codex-pocket config set publicUrl https://server.example-tailnet.ts.net
sudo tailscale serve --bg --https=443 http://127.0.0.1:7333
codex-pocket serve --no-tls
```

The host serves plain HTTP on loopback; Tailscale terminates HTTPS. Pocket otherwise detects certificates in `~/.codex-pocket/certs/`. Keep that directory empty for this proxy setup, or use `--no-tls` in the service's `ExecStart` if certificates are present. Verify the HTTPS `/api/health` endpoint from your phone; it should report `ok: true` and `upstream: true`.

For other HTTPS reverse proxies, preserve WebSocket upgrades on `/ws` (including dictation messages) and use the same public origin. A direct trusted-LAN HTTP connection supports basic chat but lacks secure browser features.

## Pair an iPhone

1. Connect the iPhone to Tailscale and open the configured HTTPS URL in Safari.
2. Choose **Share → Add to Home Screen**, then open the installed PWA. It has separate storage from Safari.
3. In a second server terminal run `codex-pocket pair`. Scan its QR code inside the PWA, or use **Enter code instead** with the 10-minute code. Keep pairing codes private.
4. Send a message. For notifications, open **Menu → Computers → information button → Notifications**, allow permission and place the app in the background before a task completes. Tap a notification to open that thread.
5. Tap the composer microphone and allow access to test dictation.

One installed PWA can pair with both Mac and Linux hosts through **Add computer**. Threads and files live on the selected computer. Desktop linking and the menu bar application are macOS features; Linux needs neither to use the phone.

## Run as a systemd user service

On a machine with a running systemd user manager, stop the foreground Pocket host before enabling the unit:

```bash
mkdir -p "$HOME/.config/systemd/user"
cp "$HOME/.local/share/codex-pocket/current/deploy/codex-pocket.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now codex-pocket
systemctl --user status codex-pocket
journalctl --user -u codex-pocket -f
```

The unit expects Node on `~/.local/bin`, `/usr/local/bin`, `/usr/bin` or `/bin` and uses bash. If you use nvm or another version manager, run `systemctl --user edit codex-pocket` and override `Environment="PATH=..."` with the absolute Node directory plus the default PATH; set `Environment="SHELL=/bin/zsh"` if your Codex environment is in zsh's startup files. You can also set `Environment="CODEX_BIN=/absolute/path/to/codex"`. Run `systemctl --user daemon-reload` and restart Pocket after changes.

To start the user service at boot and keep it after logout, an administrator can enable lingering with `sudo loginctl enable-linger "$USER"`. Validate it on your machine by rebooting and checking the service and phone reconnection. The unit syntax and a minimal service environment were tested; a real boot was not tested because the validation host uses tini, not a running systemd manager. Containers without systemd can run the launcher in the foreground under their existing process manager.

`KillMode=process` stops only Pocket. Codex owns its daemon and updater, which may keep running after Pocket stops. Manage their lifecycle explicitly with the Codex CLI when needed; restarting Pocket should preserve running Codex tasks.

## Upgrade, rollback and remove

Verify and extract the new version beside the previous directory, stop Pocket, switch the `current` symlink to the new directory, then restart it. For systemd:

```bash
systemctl --user stop codex-pocket
ln -sfn codex-pocket-v0.3.0-linux-x64 "$HOME/.local/share/codex-pocket/current"
systemctl --user start codex-pocket
```

Replace the version with the one you installed. To roll back, select the previous directory and restart. Preserve `~/.codex-pocket/` (pairings, VAPID keys, settings and uploads), `~/.codex/` (Codex login/history), and the public URL. Open the phone PWA while its original installation host is reachable to refresh its cached interface. Existing pairing tokens survive a host upgrade and restart at the same origin.

To remove Pocket, revoke phones while the host is running (`codex-pocket devices`, `codex-pocket revoke <id>`), disable the unit with `systemctl --user disable --now codex-pocket`, and remove the unit, launcher symlink and installed bundle directories. Reload systemd. Remove only Pocket's Tailscale Serve mapping if no longer needed. Removing `~/.codex-pocket/` is optional and deletes uploads referenced by chats. Codex's own installation and data are managed separately.

## Build from source

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm package:linux
pnpm package:linux:check # Linux x86_64; exercises the extracted archive with a fake daemon
```

The archive and checksum are written under `release/linux/`. `pnpm build` also builds the macOS desktop app, so use `package:linux` for Linux packaging.
