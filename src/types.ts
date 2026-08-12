export type YoutubeThumbnail = {
  url: string;
  width?: number;
  height?: number;
};

export type YoutubeVideo = {
  id: string;
  url: string;
  title: string;
  channel_id: string;
  channel_name: string;
  published_at: string;
  duration_iso8601?: string;
  description: string;
  thumbnails: Record<string, YoutubeThumbnail>;
  live_broadcast_content?: "none" | "upcoming" | "live";
  live_streaming?: {
    actual_start_time?: string;
    actual_end_time?: string;
    scheduled_start_time?: string;
  };
  statistics: {
    view_count?: number;
    like_count?: number;
    comment_count?: number;
  };
};

export type YoutubeComment = {
  id: string;
  text: string;
  author: string;
  author_channel_id?: string;
  likes: number;
  published_at: string;
  updated_at: string;
  reply_count: number;
  replies?: YoutubeComment[];
  replies_truncated?: boolean;
};

export type YoutubeCommentPage = {
  video: Pick<YoutubeVideo, "id" | "url">;
  comments: YoutubeComment[];
  next_page_token?: string;
  fetched_count: number;
  returned_count: number;
  matched_terms?: string[];
  search_scope?: "retrieved_page_only";
};

export type YoutubeChannel = {
  id: string;
  url: string;
  title: string;
  handle?: string;
  custom_url?: string;
  description: string;
  published_at: string;
  thumbnails: Record<string, YoutubeThumbnail>;
  statistics: {
    view_count?: number;
    subscriber_count?: number;
    subscriber_count_hidden: boolean;
    video_count?: number;
  };
};

export type YoutubeChannelVideo = {
  id: string;
  url: string;
  title: string;
  description: string;
  published_at: string;
  thumbnails: Record<string, YoutubeThumbnail>;
};

export type YoutubeChannelVideoPage = {
  channel: Pick<YoutubeChannel, "id" | "url" | "title">;
  videos: YoutubeChannelVideo[];
  next_page_token?: string;
  fetched_count: number;
};

export type YoutubeVideoSearchPage = {
  query: string;
  videos: YoutubeVideo[];
  next_page_token?: string;
  fetched_count: number;
  returned_count: number;
};

export type YoutubePlaylist = {
  id: string;
  url: string;
  title: string;
  description: string;
  channel_id: string;
  channel_name: string;
  published_at: string;
  item_count?: number;
  privacy_status?: "private" | "unlisted" | "public";
  thumbnails: Record<string, YoutubeThumbnail>;
};

export type YoutubeOwnedPlaylistPage = {
  playlists: YoutubePlaylist[];
  next_page_token?: string;
  fetched_count: number;
};

export type YoutubePlaylistItem = {
  playlist_item_id: string;
  video_id?: string;
  url?: string;
  title: string;
  description: string;
  published_at: string;
  position: number;
  thumbnails: Record<string, YoutubeThumbnail>;
};

export type YoutubePlaylistItemPage = {
  playlist: YoutubePlaylist;
  items: YoutubePlaylistItem[];
  next_page_token?: string;
  fetched_count: number;
};

export type TranscriptTrack = {
  language: string;
  display_name?: string;
  track_type: "creator" | "automatic";
  formats: string[];
};

export type YoutubeTranscriptLanguageList = {
  video: Pick<YoutubeVideo, "id" | "url" | "title">;
  tracks: TranscriptTrack[];
};

export type YoutubeTranscriptSegment = {
  start_seconds: number;
  duration_seconds: number;
  text: string;
};

export type YoutubeTranscriptPage = {
  video: Pick<
    YoutubeVideo,
    "id" | "url" | "title" | "channel_name" | "duration_iso8601"
  >;
  transcript: {
    language: string;
    track_type: "creator" | "automatic";
    display_name?: string;
    segments: YoutubeTranscriptSegment[];
    text: string;
    returned_segments: number;
    total_segments: number;
    complete: boolean;
    next_cursor?: string;
  };
};

export type YoutubeCommentSearchResult = {
  video: Pick<YoutubeVideo, "id" | "url">;
  comments: YoutubeComment[];
  next_page_token?: string;
  fetched_count: number;
  matched_count: number;
  matched_terms: string[];
  search_scope: "retrieved_pages_only";
  searched_pages: number;
  max_pages: number;
  complete: boolean;
};
