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
