import path from "node:path";
import { homedir } from "node:os";

export const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_OAUTH_SCOPE =
  "https://www.googleapis.com/auth/youtube.force-ssl";

export type YoutubeConfig = {
  apiKey?: string;
  ytDlpPath?: string;
};

export type YoutubeOAuthConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  tokenFile: string;
};

export function getYoutubeConfig(): YoutubeConfig {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  return {
    apiKey,
    ytDlpPath: process.env.YT_DLP_PATH?.trim() || undefined,
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
