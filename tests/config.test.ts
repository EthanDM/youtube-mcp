import { afterEach, describe, expect, it, vi } from "vitest";
import { getYoutubeConfig } from "../src/config.js";

afterEach(() => vi.unstubAllEnvs());

describe("browser session configuration", () => {
  it("disables cookie access when both settings are absent", () => {
    vi.stubEnv("YOUTUBE_COOKIES_BROWSER", "");
    vi.stubEnv("YOUTUBE_COOKIES_PROFILE", "");
    expect(getYoutubeConfig().ytDlpCookiesBrowser).toBeUndefined();
  });

  it.each([
    ["firefox", "", "requires an explicit YOUTUBE_COOKIES_PROFILE"],
    ["", "/tmp/profile", "requires YOUTUBE_COOKIES_BROWSER"],
    ["unsupported", "/tmp/profile", "must name a supported browser"],
    ["safari", "/tmp/profile", "must name a supported browser"],
  ])(
    "rejects incomplete or unsupported session settings (%s)",
    (browser, profile, message) => {
      vi.stubEnv("YOUTUBE_COOKIES_BROWSER", browser);
      vi.stubEnv("YOUTUBE_COOKIES_PROFILE", profile);
      expect(getYoutubeConfig).toThrow(message);
    },
  );

  it("preserves spaces in the explicit profile passed to yt-dlp", () => {
    vi.stubEnv("YOUTUBE_COOKIES_BROWSER", " firefox ");
    vi.stubEnv("YOUTUBE_COOKIES_PROFILE", " /tmp/Dedicated YouTube Profile ");
    expect(getYoutubeConfig().ytDlpCookiesBrowser).toBe(
      "firefox:/tmp/Dedicated YouTube Profile",
    );
  });
});
