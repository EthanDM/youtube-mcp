# Transcript failure investigation: cyeTIEy2qus

Investigated locally on October 4, 2026. Video: “This Documentary Was Made Entirely by AI. Including Her.”

## Confirmed cause

The original shared caption-discovery path uses `execFile` with a 5,242,880-byte output limit. This video currently produces approximately 11,331,596 bytes of JSON; `automatic_captions` alone accounts for 11,014,362 characters across 182 language entries. Node terminates collection with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`. The old `mapProcessError` discards this code and stderr and substitutes “yt-dlp could not retrieve video metadata.”

An injected runner using the exact MCP arguments and limits reproduced:

```json
{ "code": "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "stderr": "" }
```

This is an output-size failure, not evidence of absent captions, bot verification, malformed URLs, missing JavaScript, or an extractor/player failure. Any video with sufficiently large metadata can encounter it. Given output above the limit, the local failure is deterministic; metadata size can change upstream.

A tunnel-backed language call separately hit the existing 30-second timeout. That is an observed additional latency failure, not proof of the original generic error's cause. Historical request stderr is unavailable: the old wrapper discarded it, and the tunnel log records dispatch identifiers without video IDs or tool arguments. No matching video-ID log entries were found there.

## Actual architecture

- `youtube_get_video` → tool handler → `YoutubeClient.getVideo` → centralized GET-only `YoutubeRequestClient` → YouTube Data API `/videos`, authenticated with the local API key.
- `youtube_get_comments` → tool handler → `YoutubeClient.getComments` / `getCommentPage` → same request client → Data API `/commentThreads` (and explicitly requested replies).
- `youtube_list_transcript_languages` → `TranscriptClient.listLanguages` → `getMetadata` → local yt-dlp → caption-track enumeration.
- `youtube_get_transcript` → `getTranscriptWindow` → `resolveTranscript` → the same `getMetadata` → select caption format → Node fetch of the caption URL → parsing and cursor slicing.

OAuth playlist credentials do not participate in caption extraction. The inbound tunnel forwards calls to a local Node stdio server; it is not an outbound YouTube proxy.

Both supplied URLs normalize to `https://www.youtube.com/watch?v=cyeTIEy2qus`. The `is` query parameter is discarded before yt-dlp runs. Bare IDs are intentionally unsupported by both the URL parser and MCP URL schemas; `cyeTIEy2qus` is rejected before extraction.

## Runtime and direct reproduction

The tunnel configuration launches this repository's `dist/server.js` using Node and its `.env`, on the same Mac used for reproduction. No container is involved.

Sanitized verbose diagnostic lines:

```text
[debug] yt-dlp version stable@2026.06.09 [821bef0f0]
[debug] Python 3.14.7 (CPython arm64 64bit)
[debug] OS: macOS-27.0-arm64-arm-64bit-Mach-O
[debug] JS runtimes: deno-2.9.1
[debug] Proxy map: {}
[debug] Plugin directories: none
[debug] PO Token Providers: none
[debug] JS Challenge Providers: deno available; bun/node/quickjs unavailable
[youtube] cyeTIEy2qus: Downloading webpage
[youtube] cyeTIEy2qus: Downloading android vr player API JSON
[debug] Some web_safari formats skipped: missing URL / SABR streaming
[info] Available automatic captions for cyeTIEy2qus
exit=0
```

yt-dlp is `/opt/homebrew/bin/yt-dlp`, a symlink into Homebrew's `2026.6.9` installation. Its internal version label says pip, but the executable is Homebrew-managed. No yt-dlp configuration files were reported by verbose output. No cookies, authentication, extractor arguments, or player-client overrides are supplied by the MCP. Observed default clients include android VR and web Safari. The serving process PATH is `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`; repeating extraction with that PATH also succeeded. No outbound proxy environment variables were present in the inspected process. Public egress IP was not collected.

Commands run, with JSON/stdout redirected to temporary files to avoid exposing signed caption URLs:

```sh
yt-dlp --verbose --skip-download --dump-single-json --no-cache-dir 'https://www.youtube.com/watch?v=cyeTIEy2qus'
yt-dlp --verbose --list-subs --skip-download --no-cache-dir 'https://www.youtube.com/watch?v=cyeTIEy2qus'
yt-dlp --verbose --list-subs --skip-download --no-cache-dir 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
```

All three exited zero. Repeating the MCP extraction arguments with the original Node limit failed with the buffer error. No media or subtitle files were downloaded. Full transcript testing used the existing Node caption-fetch path instead of `--write-auto-subs`.

## Patch and verification

The bounded subprocess output limit is now 32 MiB, preserving all language entries. Discovery errors retain a safe cause, stage, video ID, backend, version when available, retryability, exit status/process code, and signal. Known authentication, HTTP 429, HTTP 403, temporary network/upstream, signature/runtime, timeout, missing executable, and output-limit failures are distinguished. Diagnostics are logged as JSON on stderr and returned in both MCP text and structured content. Existing caption-unavailable, requested-language-unavailable, fetch-failed, and parse-failed codes are also now machine-readable.

Raw backend text is deliberately summarized through known diagnostic patterns, rather than echoed: it may contain cookies, signed caption URLs, or command-line credentials. Unrecognized failures report the process status but not arbitrary raw stderr. Successful-process warning text is not persisted by this patch. There is no transcript persistence, cache, new fallback, or changed OAuth behavior.

After rebuilding:

- Target language discovery succeeded: 182 tracks, about 3.35 seconds.
- Target transcript discovery passed, but the caption fetch returned HTTP 429; the existing one-time fresh-metadata retry also returned 429. Full target transcript recovery is therefore **not verified**.
- Control `dQw4w9WgXcQ`: 165 tracks, about 2.82 seconds; English transcript fetched and parsed, 61 segments total.
- A real executable fixture emits more than 11 MB through Node's actual subprocess runner. Both language discovery and transcript retrieval pass; this test fails with the old 5 MiB limit.
- Regression tests cover process-limit classification, timeout, authentication, 429, 403, temporary upstream errors, extractor diagnostics, secret non-disclosure, and MCP structured-error propagation.

Format, lint, typecheck, tests (84), and build passed. API smoke passed. Existing long-running MCP processes must restart to load the new build; this investigation did not terminate active sessions or restart the tunnel.

## Recommended follow-up

Deploy the rebuilt process by reconnecting/restarting the MCP. The 32 MiB cap is a bounded pragmatic fix; exceptionally larger responses will now report an explicit output-limit failure.

Update the Homebrew-managed yt-dlp as routine maintenance; the installed version warns that it is more than 90 days old. That is not the confirmed cause here. Official runtime and extraction options are documented in the [yt-dlp README](https://github.com/yt-dlp/yt-dlp/blob/master/README.md).

Avoid immediate additional target-caption requests while HTTP 429 persists. A separate change should honor `Retry-After` or return a rate-limit result instead of the current immediate caption retry. Do not force alternate player clients without evidence that they solve a reproducible client failure. Removing translated tracks could reduce metadata but would change language-discovery semantics. Caching requires an explicit product decision under AGENTS.md. Live tests across caption types and restricted videos should be opt-in, bounded, and separate from deterministic regression tests.
