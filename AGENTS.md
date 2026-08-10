# AGENTS.md

## Purpose

This repository is a private, read-only YouTube MCP for public video context and bounded comment retrieval.

## Working Rules

- Keep the tool surface small and workflow-oriented.
- Do not add POST, PUT, PATCH, DELETE, OAuth, persistence, caching, transcript extraction, or write actions without an explicit product decision.
- Keep all YouTube Data API access in the centralized GET-only request client.
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
