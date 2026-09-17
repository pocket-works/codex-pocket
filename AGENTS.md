# Project Rules

- TypeScript everywhere; ESM; `moduleResolution: bundler`. Node 22+, pnpm workspaces.
- `packages/protocol` is types-only and generated (`pnpm --filter @codex-pocket/protocol generate`). Never edit `src/generated`; never put runtime code in that package.
- `packages/host` talks to the Codex desktop app-server through `~/.codex/app-server-control/app-server-control.sock` (WebSocket over unix, `perMessageDeflate: false`). Use `codex app-server daemon start` to locate/start it; never spawn a private app-server.
- The host is a thin authenticated proxy. Do not re-model chat state server-side; the PWA speaks the Codex protocol directly.
- Clay (`~/Projects/clay`, AGPL) is a reference for ideas and protocol behaviour only. Do not copy its code.
- Code comments, commit messages and user-facing strings in English. Conversation and docs (`*.md`) in Chinese.
- Commits follow the Angular convention (`feat(host): ...`). Never commit unless asked. No `Co-Authored-By` lines.
- Keep `IMPLEMENTATION_PLAN.md` status current; delete it when every stage is complete.
- Tests: vitest, next to each package in `test/`. Fake app-server helper lives in `packages/host/test/helpers.ts`.
