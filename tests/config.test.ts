import { afterEach, describe, expect, it, vi } from "vitest";
import { getYoutubeConfig } from "../src/config.js";

afterEach(() => vi.unstubAllEnvs());

describe("browser session configuration", () => {
  it("keeps Chromium as the default transcript backend", () => {
    vi.stubEnv("YOUTUBE_BROWSER_TRANSCRIPT_BACKEND", "");
    expect(getYoutubeConfig().browserTranscriptBackend).toBe("chromium");
  });

  it("requires an explicit profile for native Firefox", () => {
    vi.stubEnv("YOUTUBE_BROWSER_TRANSCRIPT_BACKEND", "firefox-native");
    vi.stubEnv("YOUTUBE_NATIVE_FIREFOX_PROFILE", "");
    expect(getYoutubeConfig).toThrow(
      "requires an explicit YOUTUBE_NATIVE_FIREFOX_PROFILE",
    );
    vi.stubEnv("YOUTUBE_NATIVE_FIREFOX_PROFILE", "/tmp/Dedicated Firefox");
    expect(getYoutubeConfig().nativeFirefoxProfile).toBe(
      "/tmp/Dedicated Firefox",
    );
  });

  it("rejects unsupported transcript backends", () => {
    vi.stubEnv("YOUTUBE_BROWSER_TRANSCRIPT_BACKEND", "unknown");
    expect(getYoutubeConfig).toThrow("must be chromium or firefox-native");
  });
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
