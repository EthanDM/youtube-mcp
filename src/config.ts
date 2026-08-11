export const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";

export type YoutubeConfig = {
  apiKey?: string;
  ytDlpPath?: string;
};

export function getYoutubeConfig(): YoutubeConfig {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  return {
    apiKey,
    ytDlpPath: process.env.YT_DLP_PATH?.trim() || undefined,
  };
}
