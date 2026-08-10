import { YoutubeMcpError } from "./errors.js";

export const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";

export type YoutubeConfig = {
  apiKey: string;
};

export function getYoutubeConfig(): YoutubeConfig {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    throw new YoutubeMcpError(
      "YOUTUBE_API_KEY is required. Copy .env.example to .env and add a restricted YouTube Data API key.",
      "auth_missing_api_key",
    );
  }

  return { apiKey };
}
