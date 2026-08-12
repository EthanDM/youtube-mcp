import type {
  YoutubeChannel,
  YoutubeChannelVideo,
  YoutubeComment,
  YoutubePlaylist,
  YoutubePlaylistItem,
  YoutubeThumbnail,
  YoutubeVideo,
} from "../types.js";

export type YoutubeVideoResource = {
  id: string;
  snippet: {
    title: string;
    channelId: string;
    channelTitle: string;
    publishedAt: string;
    description?: string;
    liveBroadcastContent?: "none" | "upcoming" | "live";
    thumbnails?: Record<
      string,
      { url: string; width?: number; height?: number }
    >;
  };
  contentDetails?: { duration?: string };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  liveStreamingDetails?: {
    actualStartTime?: string;
    actualEndTime?: string;
    scheduledStartTime?: string;
  };
};

export type YoutubeCommentResource = {
  id: string;
  snippet: {
    topLevelComment: RawComment;
    totalReplyCount?: number;
  };
  replies?: { comments?: RawComment[] };
};

export type YoutubeChannelResource = {
  id: string;
  snippet: {
    title: string;
    description?: string;
    customUrl?: string;
    publishedAt: string;
    thumbnails?: Record<
      string,
      { url: string; width?: number; height?: number }
    >;
  };
  statistics?: {
    viewCount?: string;
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
  };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};

export type YoutubePlaylistItemResource = {
  id: string;
  snippet: {
    playlistId?: string;
    title: string;
    description?: string;
    publishedAt?: string;
    thumbnails?: Record<
      string,
      { url: string; width?: number; height?: number }
    >;
    resourceId?: { videoId?: string };
    position?: number;
  };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
};

export type YoutubePlaylistResource = {
  id: string;
  snippet: {
    title: string;
    description?: string;
    channelId: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails?: Record<
      string,
      { url: string; width?: number; height?: number }
    >;
  };
  contentDetails?: { itemCount?: number };
  status?: { privacyStatus?: "private" | "unlisted" | "public" };
};

type YoutubeCommentSnippet = {
  textDisplay?: string;
  authorDisplayName?: string;
  authorChannelId?: { value?: string };
  likeCount?: number;
  publishedAt?: string;
  updatedAt?: string;
};

export type RawComment = {
  id: string;
  snippet: YoutubeCommentSnippet;
};

export function normalizeVideo(
  resource: YoutubeVideoResource,
  canonicalUrl: string,
): YoutubeVideo {
  return {
    id: resource.id,
    url: canonicalUrl,
    title: resource.snippet.title,
    channel_id: resource.snippet.channelId,
    channel_name: resource.snippet.channelTitle,
    published_at: resource.snippet.publishedAt,
    duration_iso8601: resource.contentDetails?.duration,
    description: resource.snippet.description || "",
    thumbnails: normalizeThumbnails(resource.snippet.thumbnails),
    live_broadcast_content: resource.snippet.liveBroadcastContent,
    live_streaming: resource.liveStreamingDetails
      ? {
          actual_start_time: resource.liveStreamingDetails.actualStartTime,
          actual_end_time: resource.liveStreamingDetails.actualEndTime,
          scheduled_start_time:
            resource.liveStreamingDetails.scheduledStartTime,
        }
      : undefined,
    statistics: {
      view_count: numberOrUndefined(resource.statistics?.viewCount),
      like_count: numberOrUndefined(resource.statistics?.likeCount),
      comment_count: numberOrUndefined(resource.statistics?.commentCount),
    },
  };
}

export function normalizeCommentThread(
  resource: YoutubeCommentResource,
  includeReplies: boolean,
): YoutubeComment {
  const comment = normalizeComment(resource.snippet.topLevelComment);
  const replies = includeReplies
    ? (resource.replies?.comments || []).map(normalizeComment)
    : undefined;
  const replyCount = resource.snippet.totalReplyCount || 0;

  return {
    ...comment,
    reply_count: replyCount,
    ...(includeReplies && replies && replies.length > 0 ? { replies } : {}),
    ...(includeReplies && replies && replies.length < replyCount
      ? { replies_truncated: true }
      : {}),
  };
}

export function normalizeChannel(
  resource: YoutubeChannelResource,
  canonicalUrl: string,
  handle?: string,
): YoutubeChannel {
  return {
    id: resource.id,
    url: canonicalUrl,
    title: resource.snippet.title,
    handle,
    custom_url: resource.snippet.customUrl,
    description: resource.snippet.description || "",
    published_at: resource.snippet.publishedAt,
    thumbnails: normalizeThumbnails(resource.snippet.thumbnails),
    statistics: {
      view_count: numberOrUndefined(resource.statistics?.viewCount),
      subscriber_count: numberOrUndefined(resource.statistics?.subscriberCount),
      subscriber_count_hidden:
        resource.statistics?.hiddenSubscriberCount === true,
      video_count: numberOrUndefined(resource.statistics?.videoCount),
    },
  };
}

export function normalizePlaylistItem(
  resource: YoutubePlaylistItemResource,
): YoutubeChannelVideo | undefined {
  const videoId =
    resource.contentDetails?.videoId || resource.snippet.resourceId?.videoId;
  if (!videoId) return undefined;

  return {
    id: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: resource.snippet.title,
    description: resource.snippet.description || "",
    published_at:
      resource.contentDetails?.videoPublishedAt ||
      resource.snippet.publishedAt ||
      "",
    thumbnails: normalizeThumbnails(resource.snippet.thumbnails),
  };
}

export function normalizePlaylist(
  resource: YoutubePlaylistResource,
): YoutubePlaylist {
  return {
    id: resource.id,
    url: `https://www.youtube.com/playlist?list=${resource.id}`,
    title: resource.snippet.title,
    description: resource.snippet.description || "",
    channel_id: resource.snippet.channelId,
    channel_name: resource.snippet.channelTitle,
    published_at: resource.snippet.publishedAt,
    item_count: resource.contentDetails?.itemCount,
    privacy_status: resource.status?.privacyStatus,
    thumbnails: normalizeThumbnails(resource.snippet.thumbnails),
  };
}

export function normalizePublicPlaylistItem(
  resource: YoutubePlaylistItemResource,
): YoutubePlaylistItem {
  const videoId =
    resource.contentDetails?.videoId || resource.snippet.resourceId?.videoId;
  return {
    playlist_item_id: resource.id,
    video_id: videoId,
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined,
    title: resource.snippet.title,
    description: resource.snippet.description || "",
    published_at:
      resource.contentDetails?.videoPublishedAt ||
      resource.snippet.publishedAt ||
      "",
    position: resource.snippet.position || 0,
    thumbnails: normalizeThumbnails(resource.snippet.thumbnails),
  };
}

function normalizeComment(resource: RawComment): YoutubeComment {
  return {
    id: resource.id,
    text: resource.snippet.textDisplay || "",
    author: resource.snippet.authorDisplayName || "Unknown author",
    author_channel_id: resource.snippet.authorChannelId?.value,
    likes: resource.snippet.likeCount || 0,
    published_at: resource.snippet.publishedAt || "",
    updated_at: resource.snippet.updatedAt || "",
    reply_count: 0,
  };
}

function normalizeThumbnails(
  thumbnails: YoutubeVideoResource["snippet"]["thumbnails"],
): Record<string, YoutubeThumbnail> {
  return Object.fromEntries(
    Object.entries(thumbnails || {}).map(([name, thumbnail]) => [
      name,
      {
        url: thumbnail.url,
        width: thumbnail.width,
        height: thumbnail.height,
      },
    ]),
  );
}

function numberOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
