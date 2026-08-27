# youtube-mcp

Local YouTube MCP server for Codex. It turns public video, channel, and playlist URLs into structured context, bounded public-comment retrieval, timestamped caption research, and owned-playlist management.

The repository is public, but the server is intentionally local and single-user: bring your own Google Cloud credentials, authenticate your own YouTube channel, and keep credentials and tokens on your machine. It is not a hosted service or a multi-user connector.

## Tools

- `youtube_get_video`
- `youtube_get_comments`
- `youtube_get_comment_replies`
- `youtube_find_comments`
- `youtube_get_channel`
- `youtube_get_channel_videos`
- `youtube_search_videos`
- `youtube_search_channels`
- `youtube_search_playlists`
- `youtube_get_playlist_items`
- `youtube_find_playlist_items`
- `youtube_plan_playlist_cleanup`
- `youtube_apply_playlist_cleanup`
- `youtube_list_transcript_languages`
- `youtube_get_transcript`
- `youtube_search_transcript`
- `youtube_get_authenticated_channel`
- `youtube_list_owned_playlists`
- `youtube_get_owned_playlist_items`
- `youtube_create_playlist`
- `youtube_update_playlist`
- `youtube_add_playlist_video`
- `youtube_remove_playlist_item`
- `youtube_reorder_playlist_item`
- `youtube_clone_playlist`

Public research tools remain read-only. Authenticated V2 tools manage only playlists owned by the locally authenticated channel; the server does not expose account-library reads, media downloads, ASR generation, or background processing.

## Requirements

- Node.js 22+
- `pnpm`
- A Google Cloud project with YouTube Data API v3 enabled
- A restricted YouTube Data API key for public read tools
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) on `PATH` for transcript tools (or `YT_DLP_PATH`)

Authenticated playlist tools additionally require a Google OAuth desktop client. ChatGPT access through an OpenAI Secure MCP Tunnel is optional; it is not needed for local Codex use.

## Authenticated playlist setup

In Google Cloud, enable YouTube Data API v3, create an OAuth **Desktop app** client, and configure the loopback redirect URI from `YOUTUBE_REDIRECT_URI` (by default `http://127.0.0.1:8787/callback`) as required by that client configuration. Configure its client ID and optional client secret in `.env`, then run the local PKCE flow once:

```bash
pnpm auth:login
pnpm auth:status
```

Tokens are saved outside the repository at `~/.config/youtube-mcp/tokens.json` with private filesystem permissions. `pnpm auth:logout` revokes the local session when possible and removes that file.

`youtube_list_owned_playlists` and `youtube_get_owned_playlist_items` use explicit pagination. `youtube_create_playlist` defaults to private. Update and add operations apply directly; removal and reorder require `confirm: true`. Only playlists owned by the authenticated channel can be read through the owned workflow or changed.

Set `YOUTUBE_SMOKE_OWNED_PLAYLIST_URL` only for a private test playlist you own to add an authenticated, read-only ownership smoke check. It does not create, update, add, remove, or reorder items.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `YOUTUBE_API_KEY` to a restricted YouTube Data API key.
3. Install and build:

```bash
pnpm install
pnpm build
```

4. Run the stable local stdio server:

```bash
pnpm start
```

For contributor development only, run `pnpm dev`.

## Codex setup

Build the server, then add a local MCP entry to your Codex configuration:

```toml
[mcp_servers.youtube]
command = "node"
args = ["--env-file=/absolute/path/to/youtube-mcp/.env", "/absolute/path/to/youtube-mcp/dist/server.js"]
```

Replace `/absolute/path/to/youtube-mcp` with your clone path. Rebuild after source changes before using the stable server.

## Tool behavior

`youtube_get_video` accepts normal watch, Shorts, live, embed, and `youtu.be` URLs. It returns public metadata only.

`youtube_get_comments` accepts `limit` (default 50, maximum 100), `order` (`relevance` or `time`), an explicit `pageToken`, `includeReplies`, and optional `matchTerms`.

- A call fetches one page only and returns `next_page_token` when YouTube supplies one.
- `includeReplies` returns only the inline reply subset provided by YouTube. `replies_truncated` is true when more replies exist.
- `matchTerms` applies a case-insensitive literal OR filter after retrieving the page. When it is used, `search_scope` is always `retrieved_page_only`; it does not search every comment on the video.

`youtube_find_comments` searches a caller-specified `maxPages` (1–5) of comment threads for `matchTerms`. It returns `searched_pages`, `complete`, and `next_page_token`; its `search_scope` is always `retrieved_pages_only`.

`youtube_get_channel` accepts public `/channel/CHANNEL_ID` and `/@handle` URLs. `youtube_get_channel_videos` returns one explicit page of the channel's public uploads playlist.

`youtube_search_videos` returns one explicit page of public video search results, enriched with normalized video metadata. Search is quota-expensive, so requests are limited to 25 results.

`youtube_search_channels` and `youtube_search_playlists` provide the same bounded, enriched discovery flow for public channels and playlists. `youtube_get_comment_replies` retrieves one explicit reply page for a known parent comment.

`youtube_get_playlist_items` accepts public `/playlist?list=...` and `/watch?...&list=...` URLs and returns one explicit item page. Items retain their playlist item IDs and positions for safe future authenticated workflows.

`youtube_find_playlist_items` matches literal terms across at most five public or owned-playlist pages. `youtube_plan_playlist_cleanup` is owned-playlist-only and returns deterministic duplicate/unavailable-item removal recommendations; it never mutates and does not infer subjective sequencing. For a truncated cleanup pass, provide its opaque `next_cursor` to continue while retaining duplicate-detection context. `youtube_apply_playlist_cleanup` executes only caller-supplied exact planner removals and requires `confirm: true`; it preflights every item before deleting, then reports a stopped partial result if YouTube rejects a later deletion.

`youtube_clone_playlist` requires `confirm: true` and copies at most five explicit source pages (250 items) from a public or owned source into a new owned playlist. It preserves source order and duplicate videos, reports unavailable source items instead of hiding them, and never rolls back a partially copied target. Every playlist write is read back and verified before success is returned.

`youtube_add_playlist_videos` appends a reviewed list of up to 250 public video URLs to an owned playlist in the supplied order. It requires `confirm: true`, validates every requested video before its first write, and stops with exact completed, remaining, and indeterminate IDs on a write failure.

`youtube_apply_playlist_order` applies a reviewed complete item-ID order to an owned playlist of at most 250 items. It requires `confirm: true` and rejects stale, incomplete, or duplicate item-ID lists before any mutation. Each move and the final full order are read back; a failure reports the observed order along with completed, remaining, and indeterminate IDs.

`youtube_list_transcript_languages` lists caption tracks exposed for a video. `youtube_get_transcript` returns one explicit page of timestamped creator or automatic caption segments. It prefers English when no language is requested, then falls back to the video language. Transcript retrieval uses local `yt-dlp` metadata and YouTube-exposed caption URLs; it never downloads media, writes a cache, or generates ASR text. Availability can change and is not guaranteed for every public video.

`youtube_search_transcript` applies literal-term matching only to one explicit transcript segment window and returns matching timestamped segments with `search_scope: "retrieved_segments_only"`. It accepts compatible cursors from either transcript tool.

## Optional ChatGPT connection

Keep this server and `.env` on the Mac. Create an OpenAI Secure MCP Tunnel, run `tunnel-client` where it can reach the built stdio server, and register the tunnel endpoint in ChatGPT Developer Mode. The tunnel lets ChatGPT reach a private MCP server without a public listener; it is not a public plugin-distribution path.

For an optional persistent macOS setup, see [the ChatGPT tunnel runbook](docs/persistent-chatgpt-tunnel-macos.md). It uses a private runtime-key file and a user LaunchAgent so the tunnel starts again after login and stays available while the Mac is awake and online.

Do not commit the Google API key, OAuth client credentials, OpenAI runtime key, generated tunnel configuration, or local token file.

## Privacy and API terms

This server runs locally. It does not include telemetry, a hosted backend, or a shared credential service. OAuth tokens are stored only in the local token file described above, and YouTube API requests use the credentials configured by the local user.

Users are responsible for their own Google Cloud projects and compliance with the [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service) and [YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies). Caption tools use `yt-dlp` only to retrieve YouTube-exposed caption tracks; caption availability and extraction behavior can change without notice.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm transcript:doctor
pnpm auth:status
pnpm smoke
```

`pnpm smoke` makes live read-only requests. It uses `YOUTUBE_SMOKE_URL` when set; otherwise it uses a default public video. Set `YOUTUBE_SMOKE_COMMENTS_URL` when you need to require a comments-enabled smoke target, and `YOUTUBE_SMOKE_TRANSCRIPT_URL` to verify a caption-enabled transcript target.
