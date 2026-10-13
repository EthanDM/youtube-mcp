import { chromium } from "playwright";

import { YoutubeMcpError } from "../errors.js";
import type { YoutubeTranscriptSegment } from "../types.js";
import { parseYoutubeUrl } from "./youtube-url.js";

let browserInUse = false;

/**
 * Reads the public watch-page transcript in a temporary signed-out browser.
 * Only original English is supported; no cookies, login, downloads,
 * The browser must expose exactly one English track matching the requested type.
 * or transcript files are saved. Durations are inferred from adjacent timestamps.
 * One browser may run at a time; failures expose no page content or signed URLs.
 */
export async function getBrowserTranscript(input: {
  url: string;
  language: string;
  trackType: "creator" | "automatic";
  videoLanguage?: string;
  durationSeconds?: number;
}): Promise<YoutubeTranscriptSegment[]> {
  const { canonicalUrl } = parseYoutubeUrl(input.url);
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
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    browser = await chromium.launch({ channel: "chromium", timeout: 10_000 });
    const activeBrowser = browser;
    const read = async () => {
      const page = await activeBrowser.newPage({ locale: "en-US" });
      page.setDefaultTimeout(15_000);
      await page.route("**/*", (route) =>
        ["media", "image", "font"].includes(route.request().resourceType()) ||
        new URL(route.request().url()).hostname.endsWith(".googlevideo.com")
          ? route.abort()
          : route.continue(),
      );
      await page.goto(canonicalUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await page
        .locator("#description-inline-expander")
        .getByRole("button", { name: /more/i })
        .click();
      await page
        .getByRole("button", { name: "Show transcript", exact: true })
        .click();
      const rows = page.locator("transcript-segment-view-model");
      await rows.first().waitFor();
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
      return parseBrowserCaptions(captions, input.durationSeconds);
    };
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Browser transcript deadline exceeded.")),
          45_000,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof YoutubeMcpError) throw error;
    throw new YoutubeMcpError(
      "The browser transcript fallback failed or timed out. Check that Playwright Chromium is installed and that YouTube's Show transcript panel is accessible without login or verification.",
      "browser_transcript_failed",
    );
  } finally {
    if (deadline) clearTimeout(deadline);
    try {
      await browser?.close().catch(() => {});
    } finally {
      browserInUse = false;
    }
  }
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
