import { YoutubeMcpError } from "../errors.js";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const CHANNEL_HANDLE_PATTERN = /^@[\p{L}\p{M}\p{N}._-]{3,30}$/u;

export type ParsedYoutubeUrl = {
  videoId: string;
  canonicalUrl: string;
};

export type ParsedYoutubeChannelUrl = {
  channelId?: string;
  handle?: string;
  canonicalUrl: string;
};

export type ParsedYoutubePlaylistUrl = {
  playlistId: string;
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

/** Parses public channel-ID and handle URLs without falling back to search. */
export function parseYoutubeChannelUrl(value: string): ParsedYoutubeChannelUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidChannelUrl();
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !isYoutubeHost(url.hostname.toLowerCase())
  ) {
    throw invalidChannelUrl();
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const handle = parts.length === 1 ? decodePathPart(parts[0]!) : undefined;
  if (handle && CHANNEL_HANDLE_PATTERN.test(handle)) {
    return { handle, canonicalUrl: `https://www.youtube.com/${handle}` };
  }
  if (
    parts.length === 2 &&
    parts[0] === "channel" &&
    CHANNEL_ID_PATTERN.test(parts[1]!)
  ) {
    const channelId = parts[1]!;
    return {
      channelId,
      canonicalUrl: `https://www.youtube.com/channel/${channelId}`,
    };
  }

  throw invalidChannelUrl();
}

/** Parses public playlist URLs without accepting raw playlist identifiers. */
export function parseYoutubePlaylistUrl(
  value: string,
): ParsedYoutubePlaylistUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidPlaylistUrl();
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !isYoutubeHost(url.hostname.toLowerCase())
  ) {
    throw invalidPlaylistUrl();
  }

  if (url.pathname !== "/playlist" && url.pathname !== "/watch") {
    throw invalidPlaylistUrl();
  }
  const playlistId = url.searchParams.get("list");
  if (!playlistId || !/^[A-Za-z0-9_-]{10,200}$/.test(playlistId)) {
    throw invalidPlaylistUrl();
  }
  return {
    playlistId,
    canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
  };
}

function decodePathPart(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
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

function invalidChannelUrl(): YoutubeMcpError {
  return new YoutubeMcpError(
    "Provide a supported YouTube channel URL using /channel/CHANNEL_ID or /@handle.",
    "invalid_youtube_channel_url",
  );
}

function invalidPlaylistUrl(): YoutubeMcpError {
  return new YoutubeMcpError(
    "Provide a supported public YouTube playlist URL using /playlist?list=... or /watch?...&list=....",
    "invalid_youtube_playlist_url",
  );
}
