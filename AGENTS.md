# Project Rules

- TypeScript everywhere; ESM; `moduleResolution: bundler`. Node 22+, pnpm workspaces.
- `packages/protocol` is types-only and generated (`pnpm --filter @codex-pocket/protocol generate`). Never edit `src/generated`; never put runtime code in that package.
- `packages/host` talks to Codex over a WebSocket app-server connection (`perMessageDeflate: false`) to the official daemon's unix socket (`~/.codex/app-server-control/app-server-control.sock`, started with `codex app-server daemon start` through the user's interactive login shell so it inherits the terminal environment). Codex owns that process; the host never spawns or supervises an app-server itself. That socket already speaks WebSocket, so `daemon-bridge.ts` relays `ws://127.0.0.1:7355` onto it byte-for-byte and `link-desktop` points the ChatGPT desktop app there via `CODEX_APP_SERVER_WS_URL`; phone and desktop then live in one process and every connection may subscribe to every thread. Codex's writer lock is a cross-process `flock` in `~/.codex/thread-writer-locks/`; never try to steal it.
- The host is a thin authenticated proxy. Do not re-model chat state server-side; the PWA speaks the Codex protocol directly.
- Code comments, commit messages, user-facing strings and README.md in English; README.zh-CN.md mirrors it in Chinese. Conversation with the maintainer in Chinese.
- Commits follow the Angular convention (`feat(host): ...`). Never commit unless asked. No `Co-Authored-By` lines.
- Tests: vitest, next to each package in `test/`. Fake app-server helper lives in `packages/host/test/helpers.ts`.
