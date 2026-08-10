import { describe, expect, it, vi } from "vitest";

import type { YoutubeConfig } from "../../src/config.js";
import { YoutubeClient } from "../../src/lib/youtube.js";
import { YoutubeRequestClient } from "../../src/lib/youtube-request-client.js";

const config: YoutubeConfig = { apiKey: "test-key" };

describe("YoutubeClient", () => {
  it("gets normalized public video context", async () => {
    const fetchMock = createRouterFetchMock({
      "GET /youtube/v3/videos?": (url) => {
        expect(url.searchParams.get("id")).toBe("dQw4w9WgXcQ");
        expect(url.searchParams.get("key")).toBe("test-key");
        expect(url.searchParams.get("part")).toContain("statistics");
        return jsonResponse({
          items: [videoResource()],
        });
      },
    });
    const client = new YoutubeClient(config, fetchMock);

    await expect(
      client.getVideo("https://youtu.be/dQw4w9WgXcQ?si=example"),
    ).resolves.toMatchObject({
      id: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Test video",
      statistics: { view_count: 42, like_count: 3, comment_count: 2 },
    });
  });

  it("maps unavailable video responses to a clear error", async () => {
    const client = new YoutubeClient(
      config,
      createRouterFetchMock({
        "GET /youtube/v3/videos?": () => jsonResponse({ items: [] }),
      }),
    );

    await expect(
      client.getVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).rejects.toThrow("not found or is not publicly available");
  });

  it("uses explicit pagination, reports inline reply truncation, and filters only the page", async () => {
    const fetchMock = createRouterFetchMock({
      "GET /youtube/v3/commentThreads?": (url) => {
        expect(url.searchParams.get("maxResults")).toBe("2");
        expect(url.searchParams.get("pageToken")).toBe("page-1");
        expect(url.searchParams.get("textFormat")).toBe("plainText");
        expect(url.searchParams.get("part")).toBe("snippet,replies");
        expect(url.searchParams.has("searchTerms")).toBe(false);
        return jsonResponse({
          nextPageToken: "page-2",
          items: [
            commentThread("one", "Palestinian scarf", 2, [
              comment("reply-1", "inline"),
            ]),
            commentThread("two", "Other topic", 0),
          ],
        });
      },
    });
    const client = new YoutubeClient(config, fetchMock);

    const result = await client.getComments({
      url: "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      limit: 2,
      order: "time",
      pageToken: "page-1",
      includeReplies: true,
      matchTerms: ["palestinian", "keffiyeh"],
    });

    expect(result).toMatchObject({
      fetched_count: 2,
      returned_count: 1,
      matched_terms: ["palestinian"],
      search_scope: "retrieved_page_only",
      next_page_token: "page-2",
    });
    expect(result.comments[0]).toMatchObject({
      id: "one",
      reply_count: 2,
      replies_truncated: true,
      replies: [{ id: "reply-1", text: "inline" }],
    });
  });

  it("retains a thread when a fetched inline reply matches a term", async () => {
    const client = new YoutubeClient(
      config,
      createRouterFetchMock({
        "GET /youtube/v3/commentThreads?": () =>
          jsonResponse({
            items: [
              commentThread("one", "Unrelated top-level text", 1, [
                comment("reply-1", "The keffiyeh is visible"),
              ]),
            ],
          }),
      }),
    );

    const result = await client.getComments({
      url: "https://youtu.be/dQw4w9WgXcQ",
      limit: 1,
      order: "relevance",
      includeReplies: true,
      matchTerms: ["keffiyeh"],
    });

    expect(result).toMatchObject({
      returned_count: 1,
      matched_terms: ["keffiyeh"],
    });
  });
});

describe("YoutubeRequestClient", () => {
  it("retries rate limits a bounded number of times and preserves the API key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Slow down" } }), {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new YoutubeRequestClient(config, fetchMock as typeof fetch);

    await expect(client.get<{ ok: boolean }>("/videos")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get("key")).toBe(
      "test-key",
    );
  });

  it("honors an HTTP-date Retry-After value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Slow down" } }), {
          status: 429,
          headers: { "retry-after": "Sun, 10 Aug 2026 12:00:05 GMT" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new YoutubeRequestClient(config, fetchMock as typeof fetch);

    const request = client.get<{ ok: boolean }>("/videos");
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

function createRouterFetchMock(
  routes: Record<string, (url: URL) => Response | Promise<Response>>,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const key = `${init?.method || "GET"} ${url.pathname}${url.search ? "?" : ""}`;
    const route = routes[key];
    if (!route) throw new Error(`Unexpected request: ${key}`);
    return route(url);
  }) as unknown as typeof fetch;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function videoResource() {
  return {
    id: "dQw4w9WgXcQ",
    snippet: {
      title: "Test video",
      channelId: "channel-1",
      channelTitle: "Test channel",
      publishedAt: "2020-01-01T00:00:00Z",
      description: "Test description",
      liveBroadcastContent: "none",
      thumbnails: {
        default: {
          url: "https://img.example/default.jpg",
          width: 120,
          height: 90,
        },
      },
    },
    contentDetails: { duration: "PT3M33S" },
    statistics: { viewCount: "42", likeCount: "3", commentCount: "2" },
  };
}

function comment(id: string, text: string) {
  return {
    id,
    snippet: {
      textDisplay: text,
      authorDisplayName: "Commenter",
      authorChannelId: { value: "author-1" },
      likeCount: 1,
      publishedAt: "2020-01-01T00:00:00Z",
      updatedAt: "2020-01-01T00:00:00Z",
    },
  };
}

function commentThread(
  id: string,
  text: string,
  replyCount: number,
  replies?: ReturnType<typeof comment>[],
) {
  return {
    id,
    snippet: {
      topLevelComment: comment(id, text),
      totalReplyCount: replyCount,
    },
    ...(replies ? { replies: { comments: replies } } : {}),
  };
}
