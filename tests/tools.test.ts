import { describe, expect, it, vi } from "vitest";

import type { YoutubeClient } from "../src/lib/youtube.js";
import type { TranscriptClient } from "../src/lib/transcript.js";
import {
  createToolHandlers,
  findCommentsSchema,
  getChannelVideosSchema,
  getCommentsSchema,
  getPlaylistItemsSchema,
  getTranscriptSchema,
  getVideoSchema,
  searchVideosSchema,
} from "../src/tools.js";

const transcriptClient = {} as TranscriptClient;

describe("tool schemas", () => {
  it("applies safe comment defaults", () => {
    expect(
      getCommentsSchema.parse({ url: "https://youtu.be/dQw4w9WgXcQ" }),
    ).toMatchObject({
      limit: 50,
      order: "relevance",
      includeReplies: false,
    });
  });

  it("rejects a page larger than the YouTube API maximum", () => {
    expect(
      getCommentsSchema.safeParse({
        url: "https://youtu.be/dQw4w9WgXcQ",
        limit: 101,
      }).success,
    ).toBe(false);
  });

  it("requires an explicit, bounded page count for comment search", () => {
    expect(
      findCommentsSchema.safeParse({
        url: "https://youtu.be/dQw4w9WgXcQ",
        matchTerms: ["source"],
      }).success,
    ).toBe(false);
    expect(
      findCommentsSchema.parse({
        url: "https://youtu.be/dQw4w9WgXcQ",
        matchTerms: ["source"],
        maxPages: 3,
      }),
    ).toMatchObject({ limit: 100, order: "relevance", includeReplies: false });
  });

  it("applies bounded channel upload defaults", () => {
    expect(
      getChannelVideosSchema.parse({
        url: "https://youtube.com/@GoogleDevelopers",
      }),
    ).toMatchObject({ limit: 25 });
  });

  it("returns MCP-compatible validation errors without calling the client", async () => {
    const client = { getVideo: vi.fn() } as unknown as YoutubeClient;
    const handlers = createToolHandlers(client, transcriptClient);

    const result = await handlers.getVideo({ url: "not-a-url" });

    expect(result.isError).toBe(true);
    expect(client.getVideo).not.toHaveBeenCalled();
  });

  it("returns structured content for successful reads", async () => {
    const client = {
      getVideo: vi.fn(async () => ({ id: "dQw4w9WgXcQ", title: "Test video" })),
    } as unknown as YoutubeClient;
    const handlers = createToolHandlers(client, transcriptClient);

    const result = await handlers.getVideo({
      url: "https://youtu.be/dQw4w9WgXcQ",
    });

    expect(result.structuredContent).toEqual({
      id: "dQw4w9WgXcQ",
      title: "Test video",
    });
  });

  it("does not call comment search for invalid input", async () => {
    const client = { findComments: vi.fn() } as unknown as YoutubeClient;
    const handlers = createToolHandlers(client, transcriptClient);

    const result = await handlers.findComments({
      url: "https://youtu.be/dQw4w9WgXcQ",
      matchTerms: ["source"],
    });

    expect(result.isError).toBe(true);
    expect(client.findComments).not.toHaveBeenCalled();
  });

  it("keeps the video schema minimal", () => {
    expect(
      getVideoSchema.parse({ url: "https://youtu.be/dQw4w9WgXcQ" }),
    ).toEqual({
      url: "https://youtu.be/dQw4w9WgXcQ",
    });
  });

  it("applies bounded public discovery defaults", () => {
    expect(searchVideosSchema.parse({ query: "research" })).toMatchObject({
      limit: 10,
      order: "relevance",
    });
    expect(
      searchVideosSchema.safeParse({ query: "research", limit: 26 }).success,
    ).toBe(false);
    expect(
      getPlaylistItemsSchema.parse({
        url: "https://www.youtube.com/playlist?list=PL123456789",
      }),
    ).toMatchObject({ limit: 25 });
  });

  it("applies bounded transcript paging defaults", () => {
    expect(
      getTranscriptSchema.parse({ url: "https://youtu.be/dQw4w9WgXcQ" }),
    ).toMatchObject({
      maxSegments: 250,
    });
    expect(
      getTranscriptSchema.safeParse({
        url: "https://youtu.be/dQw4w9WgXcQ",
        maxSegments: 501,
      }).success,
    ).toBe(false);
  });
});
