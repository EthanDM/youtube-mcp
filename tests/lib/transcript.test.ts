import { describe, expect, it } from "vitest";

import { TranscriptClient } from "../../src/lib/transcript.js";

const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("TranscriptClient", () => {
  it("prefers creator English captions, returns timestamped pages, and validates cursors", async () => {
    const client = createClient({
      subtitles: {
        en: [
          {
            url: "https://captions.example/creator",
            ext: "json3",
            name: "English",
          },
        ],
      },
      automatic_captions: {
        en: [{ url: "https://captions.example/automatic", ext: "json3" }],
      },
    });

    const first = await client.getTranscript({ url: videoUrl, maxSegments: 1 });
    expect(first).toMatchObject({
      transcript: {
        language: "en",
        track_type: "creator",
        returned_segments: 1,
        total_segments: 2,
        complete: false,
        segments: [
          { start_seconds: 0, duration_seconds: 1, text: "Hello & welcome" },
        ],
      },
    });
    const second = await client.getTranscript({
      url: videoUrl,
      maxSegments: 1,
      cursor: first.transcript.next_cursor,
    });
    expect(second.transcript).toMatchObject({
      complete: true,
      text: "Second caption",
    });
    await expect(
      client.getTranscript({
        url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
        maxSegments: 1,
        cursor: first.transcript.next_cursor,
      }),
    ).rejects.toMatchObject({ code: "transcript_cursor_invalid" });
  });

  it("falls back to automatic original-language captions and lists tracks", async () => {
    const client = createClient(
      {
        language: "es",
        automatic_captions: {
          es: [
            {
              url: "https://captions.example/automatic",
              ext: "vtt",
              name: "Español",
            },
          ],
        },
      },
      "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHola <b>mundo</b>\n",
    );

    const languages = await client.listLanguages(videoUrl);
    expect(languages.tracks).toEqual([
      {
        language: "es",
        display_name: "Español",
        track_type: "automatic",
        formats: ["vtt"],
      },
    ]);
    await expect(
      client.getTranscript({ url: videoUrl, language: "en", maxSegments: 1 }),
    ).rejects.toMatchObject({ code: "transcript_language_unavailable" });
    await expect(
      client.getTranscript({ url: videoUrl, maxSegments: 1 }),
    ).resolves.toMatchObject({
      transcript: {
        language: "es",
        track_type: "automatic",
        text: "Hola mundo",
      },
    });
  });

  it("continues an explicitly selected non-default language with only its cursor", async () => {
    const client = createClient({
      automatic_captions: {
        en: [{ url: "https://captions.example/english", ext: "json3" }],
        es: [{ url: "https://captions.example/spanish", ext: "json3" }],
      },
    });
    const first = await client.getTranscript({
      url: videoUrl,
      language: "es",
      maxSegments: 1,
    });
    await expect(
      client.getTranscript({
        url: videoUrl,
        cursor: first.transcript.next_cursor,
        maxSegments: 1,
      }),
    ).resolves.toMatchObject({
      transcript: { language: "es", complete: true },
    });
  });

  it("searches only the requested transcript window and shares retrieval cursors", async () => {
    const client = createClient({
      subtitles: {
        en: [{ url: "https://captions.example/creator", ext: "json3" }],
      },
    });
    const first = await client.getTranscript({ url: videoUrl, maxSegments: 1 });
    const search = await client.searchTranscript({
      url: videoUrl,
      matchTerms: ["second", "welcome"],
      cursor: first.transcript.next_cursor,
      maxSegments: 1,
    });
    expect(search).toMatchObject({
      transcript: {
        segments: [expect.objectContaining({ text: "Second caption" })],
        matched_terms: ["second"],
        searched_segments: 1,
        total_segments: 2,
        complete: true,
        search_scope: "retrieved_segments_only",
      },
    });
  });

  it("returns an empty match list while preserving the selected track page", async () => {
    const client = createClient({
      subtitles: {
        en: [{ url: "https://captions.example/creator", ext: "json3" }],
      },
    });
    await expect(
      client.searchTranscript({
        url: videoUrl,
        matchTerms: ["absent"],
        maxSegments: 1,
      }),
    ).resolves.toMatchObject({
      transcript: { segments: [], matched_count: 0, complete: false },
    });
  });

  it("rejects a transcript-search cursor from another video", async () => {
    const client = createClient({
      subtitles: {
        en: [{ url: "https://captions.example/creator", ext: "json3" }],
      },
    });
    const first = await client.getTranscript({ url: videoUrl, maxSegments: 1 });
    await expect(
      client.searchTranscript({
        url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
        matchTerms: ["caption"],
        cursor: first.transcript.next_cursor,
        maxSegments: 1,
      }),
    ).rejects.toMatchObject({ code: "transcript_cursor_invalid" });
  });

  it("forwards metadata and selected-format headers when fetching captions", async () => {
    let receivedHeaders: HeadersInit | undefined;
    const client = new TranscriptClient(
      "yt-dlp",
      async () =>
        JSON.stringify({
          http_headers: {
            Authorization: "metadata",
            "User-Agent": "metadata",
          },
          subtitles: {
            en: [
              {
                url: "https://captions.example/creator",
                ext: "json3",
                http_headers: { "user-agent": "format" },
              },
            ],
          },
        }),
      (async (_url, init) => {
        receivedHeaders = init?.headers;
        return new Response(
          JSON.stringify({
            events: [
              { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hi" }] },
            ],
          }),
        );
      }) as typeof fetch,
    );

    await client.getTranscript({ url: videoUrl, maxSegments: 1 });

    const headers = new Headers(receivedHeaders);
    expect(headers.get("authorization")).toBe("metadata");
    expect(headers.get("user-agent")).toBe("format");
  });

  it("retries a transient caption failure with fresh metadata", async () => {
    let metadataCalls = 0;
    const fetchedUrls: string[] = [];
    const client = new TranscriptClient(
      "yt-dlp",
      async () => {
        metadataCalls += 1;
        return JSON.stringify({
          subtitles: {
            en: [
              {
                url: `https://captions.example/creator-${metadataCalls}`,
                ext: "json3",
              },
            ],
          },
        });
      },
      (async (url) => {
        fetchedUrls.push(String(url));
        return fetchedUrls.length === 1
          ? new Response("busy", { status: 429 })
          : new Response(
              JSON.stringify({
                events: [
                  {
                    tStartMs: 0,
                    dDurationMs: 1_000,
                    segs: [{ utf8: "Recovered caption" }],
                  },
                ],
              }),
            );
      }) as typeof fetch,
    );

    await expect(
      client.getTranscript({ url: videoUrl, maxSegments: 1 }),
    ).resolves.toMatchObject({
      transcript: { text: "Recovered caption", complete: true },
    });
    expect(metadataCalls).toBe(2);
    expect(fetchedUrls).toEqual([
      "https://captions.example/creator-1",
      "https://captions.example/creator-2",
    ]);
  });

  it("does not retry permanent caption failures", async () => {
    let metadataCalls = 0;
    let fetchCalls = 0;
    const client = new TranscriptClient(
      "yt-dlp",
      async () => {
        metadataCalls += 1;
        return JSON.stringify({
          subtitles: {
            en: [{ url: "https://captions.example/missing", ext: "json3" }],
          },
        });
      },
      (async () => {
        fetchCalls += 1;
        return new Response("missing", { status: 404 });
      }) as typeof fetch,
    );

    await expect(
      client.getTranscript({ url: videoUrl, maxSegments: 1 }),
    ).rejects.toMatchObject({
      code: "transcript_fetch_failed",
      message: "The selected transcript track request returned HTTP 404.",
    });
    expect(metadataCalls).toBe(1);
    expect(fetchCalls).toBe(1);
  });

  it("parses XML caption tracks and reports unavailable captions", async () => {
    const client = createClient(
      {
        subtitles: {
          en: [{ url: "https://captions.example/creator", ext: "ttml" }],
        },
      },
      '<tt><body><div><p begin="00:00:02.500" end="00:00:03.700">Hello &amp; goodbye</p></div></body></tt>',
    );
    await expect(
      client.getTranscript({ url: videoUrl, maxSegments: 1 }),
    ).resolves.toMatchObject({
      transcript: {
        text: "Hello & goodbye",
        segments: [{ start_seconds: 2.5, duration_seconds: 1.2 }],
      },
    });
    await expect(
      createClient({}).listLanguages(videoUrl),
    ).rejects.toMatchObject({
      code: "transcript_unavailable",
    });
  });

  it("maps missing yt-dlp, malformed metadata, and failed caption fetches", async () => {
    const missing = new TranscriptClient(undefined, async () => {
      const error = Object.assign(new Error("missing"), { code: "ENOENT" });
      throw error;
    });
    await expect(missing.listLanguages(videoUrl)).rejects.toMatchObject({
      code: "yt_dlp_unavailable",
    });

    const malformed = new TranscriptClient(undefined, async () => "not json");
    await expect(malformed.listLanguages(videoUrl)).rejects.toMatchObject({
      code: "yt_dlp_failed",
    });

    const failedFetch = createClient(
      {
        subtitles: {
          en: [{ url: "https://captions.example/creator", ext: "json3" }],
        },
      },
      undefined,
      new Response("no", { status: 403 }),
    );
    await expect(
      failedFetch.getTranscript({ url: videoUrl, maxSegments: 1 }),
    ).rejects.toMatchObject({
      code: "transcript_fetch_failed",
    });

    const failedBodyFetch = new TranscriptClient(
      "yt-dlp",
      async () =>
        JSON.stringify({
          subtitles: {
            en: [{ url: "https://captions.example/creator", ext: "json3" }],
          },
        }),
      (async () =>
        ({
          ok: true,
          text: async () => {
            throw new Error("connection reset");
          },
        }) as unknown as Response) as typeof fetch,
    );
    await expect(
      failedBodyFetch.getTranscript({ url: videoUrl, maxSegments: 1 }),
    ).rejects.toMatchObject({
      code: "transcript_fetch_failed",
    });
  });
});

function createClient(
  metadata: Record<string, unknown>,
  captionBody = JSON.stringify({
    events: [
      {
        tStartMs: 0,
        dDurationMs: 1000,
        segs: [{ utf8: "Hello &amp; welcome" }],
      },
      { tStartMs: 1000, dDurationMs: 1500, segs: [{ utf8: "Second caption" }] },
    ],
  }),
  response?: Response,
): TranscriptClient {
  return new TranscriptClient(
    "yt-dlp",
    async () =>
      JSON.stringify({
        id: "dQw4w9WgXcQ",
        title: "Test video",
        channel: "Test channel",
        duration: 60,
        ...metadata,
      }),
    (async () =>
      response || new Response(captionBody, { status: 200 })) as typeof fetch,
  );
}
