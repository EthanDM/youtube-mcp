import path from "node:path";
import { homedir } from "node:os";

export const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_OAUTH_SCOPE =
  "https://www.googleapis.com/auth/youtube.force-ssl";

export type YoutubeConfig = {
  apiKey?: string;
  ytDlpPath?: string;
  ytDlpCookiesBrowser?: string;
  browserTranscriptFallback?: boolean;
  browserTranscriptBackend?: "chromium" | "firefox-native";
  nativeFirefoxProfile?: string;
};

export type YoutubeOAuthConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  tokenFile: string;
};

export function getYoutubeConfig(): YoutubeConfig {
  const browserBackend =
    process.env.YOUTUBE_BROWSER_TRANSCRIPT_BACKEND?.trim() || "chromium";
  if (browserBackend !== "chromium" && browserBackend !== "firefox-native") {
    throw new Error(
      "YOUTUBE_BROWSER_TRANSCRIPT_BACKEND must be chromium or firefox-native.",
    );
  }
  const nativeFirefoxProfile =
    process.env.YOUTUBE_NATIVE_FIREFOX_PROFILE?.trim() || undefined;
  if (browserBackend === "firefox-native" && !nativeFirefoxProfile) {
    throw new Error(
      "firefox-native requires an explicit YOUTUBE_NATIVE_FIREFOX_PROFILE.",
    );
  }
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  const cookiesBrowser =
    process.env.YOUTUBE_COOKIES_BROWSER?.trim() || undefined;
  if (
    cookiesBrowser &&
    ![
      "chrome",
      "chromium",
      "firefox",
      "edge",
      "brave",
      "opera",
      "vivaldi",
    ].includes(cookiesBrowser)
  ) {
    throw new Error("YOUTUBE_COOKIES_BROWSER must name a supported browser.");
  }
  const cookiesProfile = process.env.YOUTUBE_COOKIES_PROFILE?.trim();
  // Never let session access silently select an everyday browser profile.
  if (cookiesBrowser && !cookiesProfile) {
    throw new Error(
      "YOUTUBE_COOKIES_BROWSER requires an explicit YOUTUBE_COOKIES_PROFILE.",
    );
  }
  if (cookiesProfile && !cookiesBrowser) {
    throw new Error(
      "YOUTUBE_COOKIES_PROFILE requires YOUTUBE_COOKIES_BROWSER.",
    );
  }
  return {
    browserTranscriptBackend: browserBackend,
    nativeFirefoxProfile,
    apiKey,
    ytDlpCookiesBrowser:
      cookiesBrowser && cookiesProfile
        ? `${cookiesBrowser}:${cookiesProfile}`
        : cookiesBrowser,
    ytDlpPath: process.env.YT_DLP_PATH?.trim() || undefined,
    browserTranscriptFallback:
      process.env.YOUTUBE_BROWSER_TRANSCRIPT_FALLBACK === "true",
  };
}

/** Reads the local OAuth configuration required by auth CLI and write tools. */
export function getYoutubeOAuthConfig(): YoutubeOAuthConfig {
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim();
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) {
    throw new Error(
      "YOUTUBE_OAUTH_CLIENT_ID and YOUTUBE_REDIRECT_URI are required for authenticated playlist tools.",
    );
  }
  return {
    clientId,
    clientSecret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim() || undefined,
    redirectUri,
    tokenFile:
      process.env.YOUTUBE_TOKEN_FILE?.trim() ||
      path.join(homedir(), ".config", "youtube-mcp", "tokens.json"),
  };
}
