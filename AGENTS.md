# AGENTS.md

## Purpose

This repository is a local YouTube MCP for public discovery, bounded comment retrieval, local caption-track research, and explicitly scoped owned-playlist management. It is published as source code, but each installation uses its own local credentials and OAuth session.

## Working Rules

- Keep the tool surface small and workflow-oriented.
- Do not add account-library tools, media downloads, ASR/Whisper fallback, caching, persistence beyond the local OAuth token store, or write actions outside owned-playlist management without an explicit product decision.
- Keep API-key public reads in the centralized GET-only request client. Keep OAuth-authenticated playlist reads and writes in the separate authenticated request client.
- Keep `yt-dlp` caption extraction local, explicit, read-only, and separate from the Data API client. Never use it to download media or persist transcript data.
- For a transient caption fetch failure, refresh metadata and retry once only; preserve safe failure detail without exposing caption URLs or retrying permanent failures.
- Do not add transcript export, caching, or artifact persistence to the MCP. If an external assistant creates a user-requested transcript export, keep it outside the repository under `~/.config/youtube-mcp/artifacts/` as user-local output, not server state.
- Keep OAuth interactive and local through the auth CLI. Store tokens only in the private user-scoped token file; never expose them through MCP tools or Git.
- Authenticate playlist writes with OAuth and reject playlists not owned by the resolved authenticated channel. Require `confirm: true` for removal and reordering.
- Verify every playlist mutation through an observed-state readback before reporting success. Cleanup planning is deterministic and read-only; do not infer subjective sequencing.
- Batch cleanup executes only explicit, confirm-gated planner removals after preflight; stop and report exact partial state on a write failure. Playlist cloning stays caller-bounded (five pages maximum), preserves source order, and never rolls back a partial target.
- Batch video adds are append-only, preflight every requested public video before the first write, and retain exact completed, remaining, and indeterminate IDs. Batch ordering requires a complete reviewed item-ID order for an owned playlist of at most 250 items; reject stale/incomplete orders before mutation and read back the final order.
- Keep transcript search bounded to the requested cursor window and state its retrieved-segments-only scope.
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
