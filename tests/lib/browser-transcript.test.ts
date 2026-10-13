import { describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import {
  getBrowserTranscript,
  parseBrowserCaptions,
  verifyBrowserCaptionTrack,
} from "../../src/lib/browser-transcript.js";

const input = {
  url: "https://youtu.be/-JienW-k_1o",
  language: "en-orig",
  trackType: "automatic" as const,
  videoLanguage: "en-US",
};

describe("browser transcript", () => {
  it("matches the original automatic English track", () => {
    expect(() =>
      verifyBrowserCaptionTrack(
        [
          { language: "fr", trackType: "automatic" },
          { language: "en", trackType: "automatic" },
        ],
        input,
      ),
    ).not.toThrow();
  });

  it.each([
    { tracks: [] },
    { tracks: [{ language: "en", trackType: "creator" as const }] },
    { tracks: [{ language: "en-US", trackType: "automatic" as const }] },
    {
      tracks: [
        { language: "en", trackType: "automatic" as const },
        { language: "en", trackType: "creator" as const },
      ],
    },
  ])("rejects missing, mismatched, or ambiguous tracks", ({ tracks }) => {
    expect(() => verifyBrowserCaptionTrack(tracks, input)).toThrow(
      expect.objectContaining({ code: "browser_transcript_track_mismatch" }),
    );
  });
  it("parses timestamps and infers durations without losing row text", () => {
    expect(
      parseBrowserCaptions(
        [
          { timestamp: "0:01", text: "First" },
          { timestamp: "1:02:03", text: "Last" },
        ],
        3725,
      ),
    ).toEqual([
      { start_seconds: 1, duration_seconds: 3722, text: "First" },
      { start_seconds: 3723, duration_seconds: 2, text: "Last" },
    ]);
  });

  it.each([
    { rows: [] },
    { rows: [{ timestamp: "bad", text: "Caption" }] },
    { rows: [{ timestamp: "0:00", text: "" }] },
    {
      rows: [
        { timestamp: "0:02", text: "Second" },
        { timestamp: "0:01", text: "First" },
      ],
    },
  ])("rejects malformed or unordered transcripts", ({ rows }) => {
    expect(() => parseBrowserCaptions(rows)).toThrow();
  });

  it("rejects translated language requests before launching a browser", async () => {
    await expect(
      getBrowserTranscript({ ...input, language: "es" }),
    ).rejects.toMatchObject({
      code: "browser_transcript_language_unsupported",
    });
  });

  it("closes the browser and sanitizes page failures", async () => {
    const close = vi.fn(async () => {});
    const launch = vi.spyOn(chromium, "launch").mockResolvedValue({
      newPage: async () => {
        throw new Error("private page content and signed URL");
      },
      close,
    } as unknown as Awaited<ReturnType<typeof chromium.launch>>);
    try {
      await expect(getBrowserTranscript(input)).rejects.toMatchObject({
        code: "browser_transcript_failed",
        message: expect.not.stringContaining("private page"),
      });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      launch.mockRestore();
    }
  });
});
