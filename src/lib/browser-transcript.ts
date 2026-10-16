import { chromium, type Response } from "playwright";

import { YoutubeMcpError } from "../errors.js";
import type { YoutubeTranscriptSegment } from "../types.js";
import { parseYoutubeUrl } from "./youtube-url.js";
import type { YoutubeConfig } from "../config.js";
import { readNativeFirefoxTranscript } from "./native-firefox-transcript.js";

let browserInUse = false;

/** Keeps the production server and smoke check on the same explicitly configured backend. */
export function createBrowserTranscriptFallback(config: YoutubeConfig) {
  return config.browserTranscriptFallback
    ? (input: Parameters<typeof getBrowserTranscript>[0]) =>
        getBrowserTranscript({
          ...input,
          backend: config.browserTranscriptBackend,
          firefoxProfile: config.nativeFirefoxProfile,
        })
    : undefined;
}

/**
 * Reads original English captions in Chromium or an explicitly selected native Firefox profile.
 * Chromium verifies its English inventory; Firefox verifies the selected UI language/type label.
 * No cookies or transcript files are exported. Durations are inferred from adjacent timestamps.
 * One browser may run at a time; failures expose no page content or signed URLs.
 */
export async function getBrowserTranscript(input: {
  url: string;
  language: string;
  trackType: "creator" | "automatic";
  videoLanguage?: string;
  durationSeconds?: number;
  backend?: "chromium" | "firefox-native";
  firefoxProfile?: string;
}): Promise<YoutubeTranscriptSegment[]> {
  const { canonicalUrl, videoId } = parseYoutubeUrl(input.url);
  const started = performance.now();
  let stage = "validation";
  let acquiredBrowser = false;
  let deadlineExceeded = false;
  // Only fixed lifecycle fields are logged; never serialize browser errors or page content.
  const log = (event: string, code?: string, failure?: string) => {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        videoId,
        backend: input.backend || "chromium",
        stage,
        durationMs: Math.round(performance.now() - started),
        ...(code ? { code } : {}),
        ...(failure ? { failure } : {}),
      }),
    );
  };
  log("youtube_browser_transcript_start");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const baseLanguage = (language: string) => language.split("-")[0];
    if (
      !input.videoLanguage ||
      baseLanguage(input.videoLanguage) !== "en" ||
      baseLanguage(input.language) !== baseLanguage(input.videoLanguage)
    ) {
      throw new YoutubeMcpError(
        "Browser fallback supports only original English captions.",
        "browser_transcript_language_unsupported",
      );
    }
    if (browserInUse) {
      throw new YoutubeMcpError(
        "Another browser transcript request is in progress. Try again after it finishes.",
        "browser_transcript_busy",
      );
    }
    browserInUse = true;
    acquiredBrowser = true;
    if (input.backend === "firefox-native") {
      stage = "native_firefox";
      const native = await readNativeFirefoxTranscript({
        url: canonicalUrl,
        profile: input.firefoxProfile,
      });
      stage = "track_validation";
      verifyBrowserCaptionTrack(native.tracks, input);
      stage = "caption_parse";
      const segments = parseBrowserCaptions(native.rows, input.durationSeconds);
      stage = "complete";
      log("youtube_browser_transcript_end");
      return segments;
    }
    stage = "browser_launch";
    browser = await chromium.launch({ channel: "chromium", timeout: 10_000 });
    const activeBrowser = browser;
    let rejectTranscriptResponse!: (error: YoutubeMcpError) => void;
    // YouTube can reject the panel request while leaving an empty expanded panel.
    const responseFailure = new Promise<never>((_, reject) => {
      rejectTranscriptResponse = reject;
    });
    const read = async () => {
      stage = "page_setup";
      const page = await activeBrowser.newPage({ locale: "en-US" });
      page.setDefaultTimeout(15_000);
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (
          url.hostname === "www.youtube.com" &&
          url.pathname === "/youtubei/v1/get_transcript" &&
          response.status() >= 400
        ) {
          void browserTranscriptResponseError(response, videoId).then(
            rejectTranscriptResponse,
          );
        }
      });
      await page.route("**/*", (route) =>
        ["media", "image", "font"].includes(route.request().resourceType()) ||
        new URL(route.request().url()).hostname.endsWith(".googlevideo.com")
          ? route.abort()
          : route.continue(),
      );
      stage = "page_load";
      await page.goto(canonicalUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      stage = "description_expand";
      await page
        .locator("#description-inline-expander")
        .getByRole("button", { name: /more/i })
        .click();
      stage = "transcript_open";
      await page
        .getByRole("button", { name: "Show transcript", exact: true })
        .click();
      stage = "transcript_rows";
      const rows = page.locator("transcript-segment-view-model");
      await rows.first().waitFor();
      stage = "track_validation";
      const browserTracks = await page.evaluate(() => {
        const playerResponse = (
          window as typeof window & {
            ytInitialPlayerResponse?: {
              captions?: {
                playerCaptionsTracklistRenderer?: {
                  captionTracks?: Array<{
                    languageCode?: string;
                    kind?: string;
                  }>;
                };
              };
            };
          }
        ).ytInitialPlayerResponse;
        return (
          playerResponse?.captions?.playerCaptionsTracklistRenderer
            ?.captionTracks || []
        ).map((track) => ({
          language: track.languageCode || "",
          trackType:
            track.kind === "asr"
              ? ("automatic" as const)
              : ("creator" as const),
        }));
      });
      verifyBrowserCaptionTrack(browserTracks, input);
      stage = "caption_read";
      const captions = await rows.evaluateAll((elements) =>
        elements.map((element) => ({
          timestamp:
            element
              .querySelector('[aria-hidden="true"]')
              ?.textContent?.trim() || "",
          text:
            element.querySelector('[role="text"]')?.textContent?.trim() || "",
        })),
      );
      stage = "caption_parse";
      return parseBrowserCaptions(captions, input.durationSeconds);
    };
    const segments = await Promise.race([
      read(),
      responseFailure,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          deadlineExceeded = true;
          reject(new Error("Browser transcript deadline exceeded."));
        }, 45_000);
      }),
    ]);
    stage = "complete";
    log("youtube_browser_transcript_end");
    return segments;
  } catch (error) {
    if (
      error instanceof YoutubeMcpError &&
      error.code.startsWith("native_firefox_") &&
      typeof error.details?.stage === "string"
    ) {
      stage = error.details.stage;
    }
    const code =
      error instanceof YoutubeMcpError
        ? error.code
        : "browser_transcript_failed";
    const failure = deadlineExceeded
      ? "deadline"
      : error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : error instanceof YoutubeMcpError
          ? "rejected"
          : "browser_error";
    if (
      error instanceof YoutubeMcpError &&
      (error.code === "browser_transcript_http_error" ||
        error.code === "browser_transcript_precondition_failed")
    ) {
      stage = "transcript_response";
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          event: "youtube_browser_transcript_response_failed",
          videoId,
          stage,
          status: error.details?.status,
          ...(error.details?.reason ? { reason: error.details.reason } : {}),
        }),
      );
    }
    log("youtube_browser_transcript_failed", code, failure);
    if (error instanceof YoutubeMcpError) throw error;
    throw new YoutubeMcpError(
      "The browser transcript fallback failed or timed out. Check that Playwright Chromium is installed and that YouTube's Show transcript panel is accessible without login or verification.",
      "browser_transcript_failed",
      { code: "browser_transcript_failed", stage, videoId, failure },
    );
  } finally {
    if (deadline) clearTimeout(deadline);
    try {
      await browser?.close().catch(() => {});
    } finally {
      if (acquiredBrowser) browserInUse = false;
    }
  }
}

/** Only the known precondition status may leave the upstream error body. */
async function browserTranscriptResponseError(
  response: Response,
  videoId: string,
): Promise<YoutubeMcpError> {
  let preconditionFailed = false;
  if (response.status() === 400) {
    try {
      const body: unknown = await response.json();
      preconditionFailed =
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof body.error === "object" &&
        body.error !== null &&
        "status" in body.error &&
        body.error.status === "FAILED_PRECONDITION";
    } catch {
      // An unreadable body still reports the observed HTTP rejection.
    }
  }
  const code = preconditionFailed
    ? "browser_transcript_precondition_failed"
    : "browser_transcript_http_error";
  return new YoutubeMcpError(
    preconditionFailed
      ? "YouTube rejected the automated browser transcript request (FAILED_PRECONDITION). Its Show transcript panel may still work with manual browser interaction; this does not establish that login is required or captions are unavailable."
      : "YouTube rejected the browser transcript panel request.",
    code,
    {
      code,
      stage: "transcript_response",
      videoId,
      status: response.status(),
      ...(preconditionFailed ? { reason: "FAILED_PRECONDITION" } : {}),
    },
  );
}

/** Rejects ambiguous inventories because the default UI track cannot identify a specific creator/automatic choice. */
export function verifyBrowserCaptionTrack(
  tracks: Array<{ language: string; trackType: "creator" | "automatic" }>,
  requested: { language: string; trackType: "creator" | "automatic" },
): void {
  const english = tracks.filter(
    (track) => track.language.split("-")[0] === "en",
  );
  const language = requested.language.replace(/-orig$/, "");
  if (
    english.length !== 1 ||
    english[0].language !== language ||
    english[0].trackType !== requested.trackType
  ) {
    throw new YoutubeMcpError(
      "The browser's English caption track cannot be matched unambiguously to the requested language and track type.",
      "browser_transcript_track_mismatch",
    );
  }
}

/** Rejects malformed or unordered rows; never presents a partial parse as success. */
export function parseBrowserCaptions(
  rows: Array<{ timestamp: string; text: string }>,
  durationSeconds?: number,
): YoutubeTranscriptSegment[] {
  if (rows.length === 0 || rows.length > 20_000) {
    throw new Error("Invalid browser transcript size.");
  }
  const segments = rows.map((row) => {
    if (!/^\d+:\d{2}(?::\d{2})?$/.test(row.timestamp) || !row.text) {
      throw new Error("Invalid browser transcript row.");
    }
    const start = row.timestamp
      .split(":")
      .reduce((seconds, part) => seconds * 60 + Number(part), 0);
    return { start_seconds: start, duration_seconds: 0, text: row.text };
  });
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const end =
      segments[index + 1]?.start_seconds ??
      durationSeconds ??
      segment.start_seconds;
    if (end < segment.start_seconds)
      throw new Error("Unordered browser transcript.");
    segment.duration_seconds = end - segment.start_seconds;
  }
  return segments;
}
