# AGENTS.md

## Purpose

This repository is a private YouTube MCP for public discovery, bounded comment retrieval, local caption-track research, and explicitly scoped owned-playlist management.

## Working Rules

- Keep the tool surface small and workflow-oriented.
- Do not add account-library tools, media downloads, ASR/Whisper fallback, caching, persistence beyond the local OAuth token store, or write actions outside owned-playlist management without an explicit product decision.
- Keep all YouTube Data API access in the centralized GET-only request client.
- Keep `yt-dlp` caption extraction local, explicit, read-only, and separate from the Data API client. Never use it to download media or persist transcript data.
- Keep OAuth interactive and local through the auth CLI. Store tokens only in the private user-scoped token file; never expose them through MCP tools or Git.
- Authenticate playlist writes with OAuth and reject playlists not owned by the resolved authenticated channel. Require `confirm: true` for removal and reordering.
- Preserve explicit pagination. Never crawl comment pages implicitly.
- State the retrieved-page-only limit whenever local comment-term matching is used.
- Keep API keys and tunnel credentials outside Git.
- Prefer the built stdio server for normal use. Rebuild after source changes.

## Verification

After meaningful changes, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm smoke` after configuring a YouTube API key.
