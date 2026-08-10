import { YoutubeMcpError } from "../errors.js";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export type ParsedYoutubeUrl = {
  videoId: string;
  canonicalUrl: string;
};

/** Parses only public YouTube URL forms supported by this MCP. */
export function parseYoutubeUrl(value: string): ParsedYoutubeUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidUrl();
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") throw invalidUrl();

  const host = url.hostname.toLowerCase();
  const videoId = isYoutubeHost(host)
    ? parseYoutubePath(url)
    : host === "youtu.be" || host === "www.youtu.be"
      ? url.pathname.split("/").filter(Boolean)[0]
      : undefined;

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) throw invalidUrl();
  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function isYoutubeHost(host: string): boolean {
  return (
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com"
  );
}

function parseYoutubePath(url: URL): string | undefined {
  if (url.pathname === "/watch") return url.searchParams.get("v") || undefined;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || !["shorts", "live", "embed"].includes(parts[0]!)) {
    return undefined;
  }
  return parts[1];
}

function invalidUrl(): YoutubeMcpError {
  return new YoutubeMcpError(
    "Provide a supported YouTube watch, Shorts, live, embed, or youtu.be URL with a valid video ID.",
    "invalid_youtube_url",
  );
}
