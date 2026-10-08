# Contributing

Thanks for helping improve Codex Pocket. Bug reports, documentation fixes, and focused pull requests are welcome.

## Before you start

- Search existing issues before opening a new one. For a security issue, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.
- For a substantial change, open an issue first to agree on the behavior and scope.
- This project is a personal side project. Reviews and releases may take time.

## Development setup

Use Node.js 22.12 or newer and the pnpm version declared in the root `package.json`. Running the desktop app requires an Apple silicon Mac with Codex signed in. A Linux x86_64 host can also serve real phone connections; see [Linux deployment](./docs/linux.md). Type checks, unit tests and separate host/PWA builds also run on Linux.

```bash
git clone https://github.com/pocket-works/codex-pocket.git
cd codex-pocket
pnpm install --frozen-lockfile
pnpm release:check
pnpm typecheck
pnpm test
pnpm --filter @codex-pocket/host build
pnpm --filter @codex-pocket/web build
```

On macOS, `pnpm build` also bundles the desktop app using macOS icon tools. `make app` builds the unsigned menu bar application. See [README.md](./README.md#quick-start) for pairing and local use.

## Local development loop

On the computer, quit an existing Pocket menu bar app or source host before starting another host on port 7333. From the repository root, build the phone interface, then run the host in the foreground:

```bash
pnpm --filter @codex-pocket/web build:dev
pnpm dev:host serve
```

Pair from the displayed address and code. The host uses your existing Pocket network settings; follow the README's [Tailscale setup](./README.md#deploying-https-via-tailscale) when connecting from outside the LAN or testing HTTPS features.

For phone UI changes, run `pnpm --filter @codex-pocket/web build:dev` in another terminal and reload the phone interface when the update banner appears. Development builds show a `dev` suffix and UTC build timestamp in the phone's **About** page; the regular `build` command uses the release version. For host changes, stop and restart the foreground host. This uses the workspace's `packages/web/dist`; an installed release app serves its bundled interface instead.

To work on the menu bar app on macOS, build the phone interface first, then run `pnpm --filter @codex-pocket/desktop dev`. Quit and rerun that command after changing desktop code. After host-only changes, run `pnpm --filter @codex-pocket/desktop bundle`, then choose **Restart host**. Phone UI changes still need a web rebuild and reload.

For a focused check, run a package's test command, such as `pnpm --filter @codex-pocket/web test`. Before opening a PR, run the setup checks above; include phone or desktop checks relevant to your change and say which devices you actually tested.

## Working on the code

- Start with the [architecture and code guide](./docs/architecture.md) to find package responsibilities, entry points and desktop-sharing implementation details.
- Read [AGENTS.md](./AGENTS.md) for package boundaries, TypeScript conventions, and test locations.
- Keep changes focused and add tests when behavior changes. Tests live in each package's `test/` directory.
- Add a `CHANGELOG.md` entry for user-visible changes under `Unreleased`.
- `packages/protocol/src/generated` is generated from the Codex CLI. Do not edit those files by hand; regenerate with `pnpm --filter @codex-pocket/protocol generate` when the protocol changes.
- Write code comments, user-facing strings, and commit messages in English. Keep [README.zh-CN.md](./README.zh-CN.md) aligned when changing the English README.
- Use Angular-style commit messages, such as `fix(web): preserve draft after reconnect`.

## Pull requests

Describe the user-visible change, how you tested it, and any platform or phone behavior you could not verify. Include screenshots for visual changes, with thread content, account details, pairing codes, and local paths removed. Keep unrelated changes in separate pull requests.

Contributions are submitted under the repository's [MIT license](./LICENSE). Generated Codex protocol declarations retain their [Apache-2.0 notice](./packages/protocol/NOTICE).
