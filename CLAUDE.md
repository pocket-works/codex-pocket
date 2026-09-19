# Project Rules

- TypeScript everywhere; ESM; `moduleResolution: bundler`. Node 22+, pnpm workspaces.
- `packages/protocol` is types-only and generated (`pnpm --filter @codex-pocket/protocol generate`). Never edit `src/generated`; never put runtime code in that package.
- `packages/host` talks to Codex over a WebSocket app-server connection (`perMessageDeflate: false`). Default mode is `shared`: the host runs ONE `codex app-server --listen ws://127.0.0.1:7355` (detached, using the desktop app's bundled binary and flags) and `link-desktop` points the ChatGPT desktop app at it via `CODEX_APP_SERVER_WS_URL`, so phone and desktop live in the same process and every connection may subscribe to every thread. `daemon` mode (the official `~/.codex/app-server-control` socket) is kept as a fallback; threads open in the desktop app stay locked to it there. Codex's writer lock is a cross-process `flock` in `~/.codex/thread-writer-locks/`; never try to steal it.
- The host is a thin authenticated proxy. Do not re-model chat state server-side; the PWA speaks the Codex protocol directly.
- Code comments, commit messages and user-facing strings in English. Conversation and docs (`*.md`) in Chinese.
- Commits follow the Angular convention (`feat(host): ...`). Never commit unless asked. No `Co-Authored-By` lines.
- Tests: vitest, next to each package in `test/`. Fake app-server helper lives in `packages/host/test/helpers.ts`.
