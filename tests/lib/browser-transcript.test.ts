import { describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import * as nativeFirefox from "../../src/lib/native-firefox-transcript.js";
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
  it("uses the native backend and keeps the shared browser lock after a busy rejection", async () => {
    let release!: (
      value: Awaited<
        ReturnType<typeof nativeFirefox.readNativeFirefoxTranscript>
      >,
    ) => void;
    const result = {
      tracks: [{ language: "en", trackType: "automatic" as const }],
      rows: [{ timestamp: "0:02", text: "Native caption" }],
    };
    const read = vi
      .spyOn(nativeFirefox, "readNativeFirefoxTranscript")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(result);
    const launch = vi.spyOn(chromium, "launch");
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const nativeInput = {
      ...input,
      backend: "firefox-native" as const,
      firefoxProfile: "/tmp/dedicated",
    };
    const active = getBrowserTranscript(nativeInput);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(getBrowserTranscript(nativeInput)).rejects.toMatchObject({
          code: "browser_transcript_busy",
        });
      }
      release(result);
      expect(await active).toEqual([
        { start_seconds: 2, duration_seconds: 0, text: "Native caption" },
      ]);
      await expect(getBrowserTranscript(nativeInput)).resolves.toHaveLength(1);
      expect(read).toHaveBeenCalledTimes(2);
      expect(launch).not.toHaveBeenCalled();
    } finally {
      release(result);
      await active;
      read.mockRestore();
      launch.mockRestore();
      stderr.mockRestore();
    }
  });

  it("rejects native results when the selected UI track differs from the requested type", async () => {
    const read = vi
      .spyOn(nativeFirefox, "readNativeFirefoxTranscript")
      .mockResolvedValue({
        tracks: [{ language: "en", trackType: "creator" }],
        rows: [{ timestamp: "0:02", text: "Caption" }],
      });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        getBrowserTranscript({ ...input, backend: "firefox-native" }),
      ).rejects.toMatchObject({ code: "browser_transcript_track_mismatch" });
    } finally {
      read.mockRestore();
      stderr.mockRestore();
    }
  });
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

  it.each([
    {
      status: 400,
      reason: "FAILED_PRECONDITION",
      code: "browser_transcript_precondition_failed",
    },
    {
      status: 400,
      reason: "private upstream status",
      code: "browser_transcript_http_error",
    },
    {
      status: 403,
      reason: "FAILED_PRECONDITION",
      code: "browser_transcript_http_error",
    },
    { status: 400, reason: null, code: "browser_transcript_http_error" },
  ])(
    "reports rejected transcript responses safely: $status / $reason",
    async ({ status, reason, code }) => {
      const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
      let onResponse!: (response: {
        url: () => string;
        status: () => number;
        json: () => Promise<unknown>;
      }) => void;
      const close = vi.fn(async () => {});
      const button = { click: async () => {} };
      const page = {
        setDefaultTimeout: () => {},
        on: (_event: string, listener: typeof onResponse) => {
          onResponse = listener;
        },
        route: async () => {},
        goto: async () => {},
        locator: (selector: string) =>
          selector === "#description-inline-expander"
            ? { getByRole: () => button }
            : { first: () => ({ waitFor: () => new Promise(() => {}) }) },
        getByRole: () => ({
          click: async () => {
            onResponse({
              url: () =>
                "https://www.youtube.com/youtubei/v1/get_transcript?key=private",
              status: () => status,
              json: async () => {
                if (reason === null) throw new Error("private body failure");
                return {
                  error: {
                    status: reason,
                    message: "private upstream message",
                  },
                };
              },
            });
          },
        }),
      };
      const launch = vi.spyOn(chromium, "launch").mockResolvedValue({
        newPage: async () => page,
        close,
      } as unknown as Awaited<ReturnType<typeof chromium.launch>>);
      try {
        await expect(getBrowserTranscript(input)).rejects.toMatchObject({
          code,
          details: { stage: "transcript_response", status },
        });
        expect(close).toHaveBeenCalledOnce();
        expect(JSON.stringify(stderr.mock.calls)).not.toContain("private");
      } finally {
        launch.mockRestore();
        stderr.mockRestore();
      }
    },
  );

  it("closes the browser and sanitizes page failures", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
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
      const events = stderr.mock.calls.map(([line]) => JSON.parse(line));
      expect(events.map((entry) => entry.event)).toEqual([
        "youtube_browser_transcript_start",
        "youtube_browser_transcript_failed",
      ]);
      expect(events[1]).toMatchObject({
        stage: "page_setup",
        code: "browser_transcript_failed",
        failure: "browser_error",
      });
      expect(JSON.stringify(events)).not.toContain("private page");
      expect(JSON.stringify(events)).not.toContain("signed URL");
    } finally {
      launch.mockRestore();
      stderr.mockRestore();
    }
  });
});
