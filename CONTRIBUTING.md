# Contributing

## Scope

This project is a local YouTube MCP for bounded research and owned-playlist management. Keep changes focused, explicit, and easy to maintain.

## Setup

1. Copy `.env.example` to `.env`.
2. Configure a restricted `YOUTUBE_API_KEY` for public API tools.
3. Run `pnpm install`.
4. Run `pnpm build` and `pnpm start` for normal local use. Use `pnpm dev` only while editing.

Authenticated playlist work also needs a local OAuth desktop-client configuration and `pnpm auth:login`. Never commit credentials, tokens, or generated configuration.

## Verification

Run before opening or updating a pull request:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm transcript:doctor
```

`pnpm smoke` makes live read-only YouTube requests. Run it only with intentionally configured local credentials and smoke targets; never turn it into an unscoped playlist mutation test.

## Change guidelines

- Keep public API-key reads and OAuth playlist operations in their separate request clients.
- Preserve explicit pagination and the retrieved-page-only limit for comment matching.
- Keep caption retrieval local, bounded, and free of media downloads, ASR fallback, caching, or persistence.
- Do not add transcript export or artifact persistence to the MCP. User-requested exports created by an external assistant belong outside the repository under `~/.config/youtube-mcp/artifacts/`, not in server state.
- Limit playlist writes to playlists owned by the authenticated channel. Removal and reordering must remain confirm-gated.
- Update tests and README/AGENTS.md whenever behavior changes.
- Use conventional commits where practical, such as `feat(youtube): ...` or `fix(youtube): ...`.
