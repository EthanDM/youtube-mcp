import { describe, expect, it } from "vitest";

import { parseYoutubeUrl } from "../../src/lib/youtube-url.js";

describe("parseYoutubeUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/shorts/dQw4w9WgXcQ?feature=share",
    "https://m.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=42",
  ])("normalizes supported URL %s", (url) => {
    expect(parseYoutubeUrl(url)).toEqual({
      videoId: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it.each([
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/shorts/not-a-video-id",
    "not a URL",
  ])("rejects unsupported or malformed URL %s", (url) => {
    expect(() => parseYoutubeUrl(url)).toThrow("Provide a supported YouTube");
  });
});
