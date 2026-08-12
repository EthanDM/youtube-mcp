# youtube-mcp

Private YouTube MCP server for Codex and ChatGPT. It turns public video, channel, and playlist URLs into structured context, bounded public-comment retrieval, timestamped caption research, and owned-playlist management.

## Tools

- `youtube_get_video`
- `youtube_get_comments`
- `youtube_find_comments`
- `youtube_get_channel`
- `youtube_get_channel_videos`
- `youtube_search_videos`
- `youtube_get_playlist_items`
- `youtube_list_transcript_languages`
- `youtube_get_transcript`
- `youtube_get_authenticated_channel`
- `youtube_list_owned_playlists`
- `youtube_get_owned_playlist_items`
- `youtube_create_playlist`
- `youtube_update_playlist`
- `youtube_add_playlist_video`
- `youtube_remove_playlist_item`
- `youtube_reorder_playlist_item`

Public research tools remain read-only. Authenticated V2 tools manage only playlists owned by the locally authenticated channel; the server does not expose account-library reads, media downloads, ASR generation, or background processing.

## Requirements

- Node.js 22+
- `pnpm`
- A Google Cloud project with YouTube Data API v3 enabled
- A YouTube Data API key restricted to that API
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) on `PATH` for transcript tools (or `YT_DLP_PATH`)
- OpenAI Secure MCP Tunnel access and ChatGPT Developer Mode access

## Authenticated playlist setup

Create a Google OAuth desktop client with the YouTube Data API enabled, then configure the OAuth variables in `.env`. Run the local PKCE flow once:

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

## Tool behavior

`youtube_get_video` accepts normal watch, Shorts, live, embed, and `youtu.be` URLs. It returns public metadata only.

`youtube_get_comments` accepts `limit` (default 50, maximum 100), `order` (`relevance` or `time`), an explicit `pageToken`, `includeReplies`, and optional `matchTerms`.

- A call fetches one page only and returns `next_page_token` when YouTube supplies one.
- `includeReplies` returns only the inline reply subset provided by YouTube. `replies_truncated` is true when more replies exist.
- `matchTerms` applies a case-insensitive literal OR filter after retrieving the page. When it is used, `search_scope` is always `retrieved_page_only`; it does not search every comment on the video.

`youtube_find_comments` searches a caller-specified `maxPages` (1–5) of comment threads for `matchTerms`. It returns `searched_pages`, `complete`, and `next_page_token`; its `search_scope` is always `retrieved_pages_only`.

`youtube_get_channel` accepts public `/channel/CHANNEL_ID` and `/@handle` URLs. `youtube_get_channel_videos` returns one explicit page of the channel's public uploads playlist.

`youtube_search_videos` returns one explicit page of public video search results, enriched with normalized video metadata. Search is quota-expensive, so requests are limited to 25 results.

`youtube_get_playlist_items` accepts public `/playlist?list=...` and `/watch?...&list=...` URLs and returns one explicit item page. Items retain their playlist item IDs and positions for safe future authenticated workflows.

`youtube_list_transcript_languages` lists caption tracks exposed for a video. `youtube_get_transcript` returns one explicit page of timestamped creator or automatic caption segments. It prefers English when no language is requested, then falls back to the video language. Transcript retrieval uses local `yt-dlp` metadata and YouTube-exposed caption URLs; it never downloads media, writes a cache, or generates ASR text. Availability can change and is not guaranteed for every public video.

## Private ChatGPT connection

Keep this server and `.env` on the Mac. Create an OpenAI Secure MCP Tunnel, run `tunnel-client` where it can reach the built stdio server, and register the tunnel endpoint in ChatGPT Developer Mode. The tunnel lets ChatGPT reach a private MCP server without a public listener. Follow the current [Secure MCP Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) for tunnel creation and `tunnel-client` configuration.

Do not commit the Google API key, OpenAI runtime key, or generated tunnel configuration.

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
