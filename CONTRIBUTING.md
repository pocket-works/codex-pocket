# Contributing

Thanks for helping improve Codex Pocket. Bug reports, documentation fixes, and focused pull requests are welcome.

## Before you start

- Search existing issues before opening a new one. For a security issue, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.
- For a substantial change, open an issue first to agree on the behavior and scope.
- This project is a personal side project. Reviews and releases may take time.

## Development setup

You need an Apple silicon Mac, Node.js 22.12 or newer, pnpm, and a signed-in Codex installation for end-to-end testing. Most type checks and unit tests also run on Linux.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

`make app` builds the unsigned macOS menu bar app. See [README.md](./README.md#quick-start) for pairing and local use.

## Working on the code

- Read [AGENTS.md](./AGENTS.md) for package boundaries, TypeScript conventions, and test locations.
- Keep changes focused and add tests when behavior changes. Tests live in each package's `test/` directory.
- Add a `CHANGELOG.md` entry for user-visible changes under `Unreleased`.
- `packages/protocol/src/generated` is generated from the Codex CLI. Do not edit those files by hand; regenerate with `pnpm --filter @codex-pocket/protocol generate` when the protocol changes.
- Write code comments, user-facing strings, and commit messages in English. Keep [README.zh-CN.md](./README.zh-CN.md) aligned when changing the English README.
- Use Angular-style commit messages, such as `fix(web): preserve draft after reconnect`.

## Pull requests

Describe the user-visible change, how you tested it, and any macOS or phone behavior you could not verify. Include screenshots for visual changes, with thread content, account details, pairing codes, and local paths removed. Keep unrelated changes in separate pull requests.

Contributions are submitted under the repository's [MIT license](./LICENSE). Generated Codex protocol declarations retain their [Apache-2.0 notice](./packages/protocol/NOTICE).
