import { describe, expect, it, vi } from "vitest";

import type { YoutubeClient } from "../src/lib/youtube.js";
import {
  createToolHandlers,
  getCommentsSchema,
  getVideoSchema,
} from "../src/tools.js";

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

  it("returns MCP-compatible validation errors without calling the client", async () => {
    const client = { getVideo: vi.fn() } as unknown as YoutubeClient;
    const handlers = createToolHandlers(client);

    const result = await handlers.getVideo({ url: "not-a-url" });

    expect(result.isError).toBe(true);
    expect(client.getVideo).not.toHaveBeenCalled();
  });

  it("returns structured content for successful reads", async () => {
    const client = {
      getVideo: vi.fn(async () => ({ id: "dQw4w9WgXcQ", title: "Test video" })),
    } as unknown as YoutubeClient;
    const handlers = createToolHandlers(client);

    const result = await handlers.getVideo({
      url: "https://youtu.be/dQw4w9WgXcQ",
    });

    expect(result.structuredContent).toEqual({
      id: "dQw4w9WgXcQ",
      title: "Test video",
    });
  });

  it("keeps the video schema minimal", () => {
    expect(
      getVideoSchema.parse({ url: "https://youtu.be/dQw4w9WgXcQ" }),
    ).toEqual({
      url: "https://youtu.be/dQw4w9WgXcQ",
    });
  });
});
