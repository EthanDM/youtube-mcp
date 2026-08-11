import { describe, expect, it } from "vitest";

import {
  parseYoutubeChannelUrl,
  parseYoutubePlaylistUrl,
  parseYoutubeUrl,
} from "../../src/lib/youtube-url.js";

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

describe("parseYoutubeChannelUrl", () => {
  it("normalizes channel ID and handle URLs", () => {
    expect(
      parseYoutubeChannelUrl(
        "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw?feature=share",
      ),
    ).toEqual({
      channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
      canonicalUrl: "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw",
    });
    expect(
      parseYoutubeChannelUrl("https://youtube.com/@GoogleDevelopers"),
    ).toEqual({
      handle: "@GoogleDevelopers",
      canonicalUrl: "https://www.youtube.com/@GoogleDevelopers",
    });
    expect(
      parseYoutubeChannelUrl(
        "https://youtube.com/@%E6%97%A5%E6%9C%AC%E8%AA%9E",
      ),
    ).toEqual({
      handle: "@日本語",
      canonicalUrl: "https://www.youtube.com/@日本語",
    });
  });

  it.each([
    "https://youtu.be/UC_x5XG1OV2P6uZZ5FSM9Ttw",
    "https://youtube.com/user/GoogleDevelopers",
    "https://notyoutube.com/@GoogleDevelopers",
    "https://youtube.com/@no",
  ])("rejects unsupported channel URL %s", (url) => {
    expect(() => parseYoutubeChannelUrl(url)).toThrow(
      "Provide a supported YouTube channel URL",
    );
  });
});

describe("parseYoutubePlaylistUrl", () => {
  it("parses canonical playlist and watch URLs", () => {
    expect(
      parseYoutubePlaylistUrl(
        "https://www.youtube.com/playlist?list=PL123456789",
      ),
    ).toEqual({
      playlistId: "PL123456789",
      canonicalUrl: "https://www.youtube.com/playlist?list=PL123456789",
    });
    expect(
      parseYoutubePlaylistUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123456789",
      ),
    ).toMatchObject({ playlistId: "PL123456789" });
  });

  it("rejects raw IDs and unsupported URLs", () => {
    expect(() => parseYoutubePlaylistUrl("PL123456789")).toThrow(
      "playlist URL",
    );
    expect(() =>
      parseYoutubePlaylistUrl("https://youtu.be/dQw4w9WgXcQ"),
    ).toThrow("playlist URL");
  });
});
