import type { YoutubeConfig } from "../config.js";
import { YoutubeMcpError } from "../errors.js";
import type {
  YoutubeChannel,
  YoutubeChannelVideoPage,
  YoutubeChannelSearchPage,
  YoutubeCommentReplyPage,
  YoutubeCommentPage,
  YoutubeCommentSearchResult,
  YoutubePlaylistItemPage,
  YoutubePlaylistItemSearchResult,
  YoutubePlaylistSearchPage,
  YoutubeVideo,
  YoutubeVideoSearchPage,
} from "../types.js";
import {
  parseYoutubeChannelUrl,
  parseYoutubePlaylistUrl,
  parseYoutubeUrl,
} from "./youtube-url.js";
import {
  normalizeChannel,
  normalizeCommentThread,
  normalizeComment,
  normalizePlaylist,
  normalizePlaylistItem,
  normalizePublicPlaylistItem,
  normalizeVideo,
  type YoutubeChannelResource,
  type YoutubeCommentResource,
  type YoutubePlaylistResource,
  type YoutubePlaylistItemResource,
  type YoutubeVideoResource,
} from "./youtube-normalizers.js";
import {
  YoutubeRequestClient,
  type FetchLike,
} from "./youtube-request-client.js";

type VideoResponse = { items?: YoutubeVideoResource[] };
type CommentThreadsResponse = {
  items?: YoutubeCommentResource[];
  nextPageToken?: string;
};
type ChannelResponse = { items?: YoutubeChannelResource[] };
type PlaylistItemsResponse = {
  items?: YoutubePlaylistItemResource[];
  nextPageToken?: string;
};
type PlaylistsResponse = { items?: YoutubePlaylistResource[] };
type SearchResponse = {
  items?: Array<{
    id?: { videoId?: string; channelId?: string; playlistId?: string };
  }>;
  nextPageToken?: string;
};

export type GetCommentsInput = {
  url: string;
  limit: number;
  order: "relevance" | "time";
  pageToken?: string;
  includeReplies: boolean;
  matchTerms?: string[];
};

export type FindCommentsInput = Omit<
  GetCommentsInput,
  "pageToken" | "matchTerms"
> & {
  maxPages: number;
  pageToken?: string;
  matchTerms: string[];
};

export type GetChannelVideosInput = {
  url: string;
  limit: number;
  pageToken?: string;
};

export type SearchVideosInput = {
  query: string;
  limit: number;
  pageToken?: string;
  order: "relevance" | "date" | "viewCount";
};

export type GetPlaylistItemsInput = {
  url: string;
  limit: number;
  pageToken?: string;
};

export type SearchInput = SearchVideosInput;

export type FindPlaylistItemsInput = GetPlaylistItemsInput & {
  matchTerms: string[];
  maxPages: number;
};

export class YoutubeClient {
  private readonly requestClient: YoutubeRequestClient;

  constructor(config: YoutubeConfig, fetchImpl?: FetchLike) {
    this.requestClient = new YoutubeRequestClient(config, fetchImpl);
  }

  async getVideo(url: string): Promise<YoutubeVideo> {
    const parsed = parseYoutubeUrl(url);
    const response = await this.requestClient.get<VideoResponse>(
      "/videos",
      new URLSearchParams({
        part: "snippet,contentDetails,statistics,liveStreamingDetails,status",
        id: parsed.videoId,
      }),
    );
    const video = response.items?.[0];
    if (!video) {
      throw new YoutubeMcpError(
        "The video was not found or is not publicly available.",
        "video_not_found",
      );
    }
    return normalizeVideo(video, parsed.canonicalUrl);
  }

  async getComments(input: GetCommentsInput): Promise<YoutubeCommentPage> {
    const parsed = parseYoutubeUrl(input.url);
    const { comments, nextPageToken } = await this.getCommentPage({
      videoId: parsed.videoId,
      ...input,
    });
    const terms = input.matchTerms?.map((term) => term.toLocaleLowerCase());
    const matchedComments = terms?.length
      ? comments.filter((comment) => commentMatchesTerms(comment, terms))
      : comments;
    const matchedTerms = terms?.length
      ? terms.filter((term) =>
          comments.some((comment) => commentMatchesTerms(comment, [term])),
        )
      : undefined;

    return {
      video: { id: parsed.videoId, url: parsed.canonicalUrl },
      comments: matchedComments,
      next_page_token: nextPageToken,
      fetched_count: comments.length,
      returned_count: matchedComments.length,
      ...(terms?.length
        ? {
            matched_terms: matchedTerms,
            search_scope: "retrieved_page_only" as const,
          }
        : {}),
    };
  }

  async getCommentReplies(input: {
    parentCommentId: string;
    limit: number;
    pageToken?: string;
  }): Promise<YoutubeCommentReplyPage> {
    const response = await this.requestClient.get<{
      items?: Array<import("./youtube-normalizers.js").RawComment>;
      nextPageToken?: string;
    }>(
      "/comments",
      new URLSearchParams({
        part: "snippet",
        parentId: input.parentCommentId,
        maxResults: String(input.limit),
        textFormat: "plainText",
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      }),
    );
    const replies = (response.items || []).map(normalizeComment);
    return {
      parent_comment_id: input.parentCommentId,
      replies,
      next_page_token: response.nextPageToken,
      fetched_count: replies.length,
    };
  }

  async findComments(
    input: FindCommentsInput,
  ): Promise<YoutubeCommentSearchResult> {
    const parsed = parseYoutubeUrl(input.url);
    const terms = input.matchTerms.map((term) => term.toLocaleLowerCase());
    const matchingComments = [] as YoutubeCommentSearchResult["comments"];
    let fetchedCount = 0;
    let searchedPages = 0;
    let pageToken = input.pageToken;
    let nextPageToken: string | undefined;

    do {
      const page = await this.getCommentPage({
        videoId: parsed.videoId,
        limit: input.limit,
        order: input.order,
        includeReplies: input.includeReplies,
        pageToken,
      });
      fetchedCount += page.comments.length;
      searchedPages += 1;
      matchingComments.push(
        ...page.comments.filter((comment) =>
          commentMatchesTerms(comment, terms),
        ),
      );
      nextPageToken = page.nextPageToken;
      pageToken = nextPageToken;
    } while (pageToken && searchedPages < input.maxPages);

    return {
      video: { id: parsed.videoId, url: parsed.canonicalUrl },
      comments: matchingComments,
      next_page_token: nextPageToken,
      fetched_count: fetchedCount,
      matched_count: matchingComments.length,
      matched_terms: terms.filter((term) =>
        matchingComments.some((comment) =>
          commentMatchesTerms(comment, [term]),
        ),
      ),
      search_scope: "retrieved_pages_only",
      searched_pages: searchedPages,
      max_pages: input.maxPages,
      complete: !nextPageToken,
    };
  }

  async getChannel(url: string): Promise<YoutubeChannel> {
    const { resource, canonicalUrl, handle } =
      await this.getChannelResource(url);
    return normalizeChannel(resource, canonicalUrl, handle);
  }

  async getChannelVideos(
    input: GetChannelVideosInput,
  ): Promise<YoutubeChannelVideoPage> {
    const { resource, canonicalUrl, handle } = await this.getChannelResource(
      input.url,
    );
    const uploadsPlaylistId =
      resource.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      throw new YoutubeMcpError(
        "The channel does not expose a public uploads playlist.",
        "channel_uploads_unavailable",
      );
    }

    const response = await this.requestClient.get<PlaylistItemsResponse>(
      "/playlistItems",
      new URLSearchParams({
        part: "snippet,contentDetails",
        playlistId: uploadsPlaylistId,
        maxResults: String(input.limit),
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      }),
    );
    const channel = normalizeChannel(resource, canonicalUrl, handle);
    const videos = (response.items || [])
      .map(normalizePlaylistItem)
      .filter(
        (video): video is NonNullable<typeof video> => video !== undefined,
      );

    return {
      channel: { id: channel.id, url: channel.url, title: channel.title },
      videos,
      next_page_token: response.nextPageToken,
      fetched_count: videos.length,
    };
  }

  async searchVideos(
    input: SearchVideosInput,
  ): Promise<YoutubeVideoSearchPage> {
    const search = await this.requestClient.get<SearchResponse>(
      "/search",
      new URLSearchParams({
        part: "id",
        q: input.query,
        type: "video",
        maxResults: String(input.limit),
        order: input.order,
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      }),
    );
    const ids = (search.items || [])
      .map((item) => item.id?.videoId)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) {
      return {
        query: input.query,
        videos: [],
        next_page_token: search.nextPageToken,
        fetched_count: 0,
        returned_count: 0,
      };
    }
    const detail = await this.requestClient.get<VideoResponse>(
      "/videos",
      new URLSearchParams({
        part: "snippet,contentDetails,statistics,liveStreamingDetails,status",
        id: ids.join(","),
      }),
    );
    const byId = new Map(
      (detail.items || []).map((video) => [video.id, video]),
    );
    const videos = ids.flatMap((id) => {
      const video = byId.get(id);
      return video
        ? [normalizeVideo(video, `https://www.youtube.com/watch?v=${id}`)]
        : [];
    });
    return {
      query: input.query,
      videos,
      next_page_token: search.nextPageToken,
      fetched_count: ids.length,
      returned_count: videos.length,
    };
  }

  async searchChannels(input: SearchInput): Promise<YoutubeChannelSearchPage> {
    const search = await this.requestClient.get<SearchResponse>(
      "/search",
      new URLSearchParams({
        part: "id",
        q: input.query,
        type: "channel",
        maxResults: String(input.limit),
        order: input.order,
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      }),
    );
    const ids = (search.items || [])
      .map((item) => item.id?.channelId)
      .filter((id): id is string => Boolean(id));
    if (!ids.length)
      return {
        query: input.query,
        channels: [],
        next_page_token: search.nextPageToken,
        fetched_count: 0,
        returned_count: 0,
      };
    const detail = await this.requestClient.get<ChannelResponse>(
      "/channels",
      new URLSearchParams({
        part: "snippet,statistics,contentDetails",
        id: ids.join(","),
      }),
    );
    const byId = new Map((detail.items || []).map((item) => [item.id, item]));
    const channels = ids.flatMap((id) => {
      const channel = byId.get(id);
      return channel
        ? [normalizeChannel(channel, `https://www.youtube.com/channel/${id}`)]
        : [];
    });
    return {
      query: input.query,
      channels,
      next_page_token: search.nextPageToken,
      fetched_count: ids.length,
      returned_count: channels.length,
    };
  }

  async searchPlaylists(
    input: SearchInput,
  ): Promise<YoutubePlaylistSearchPage> {
    const search = await this.requestClient.get<SearchResponse>(
      "/search",
      new URLSearchParams({
        part: "id",
        q: input.query,
        type: "playlist",
        maxResults: String(input.limit),
        order: input.order,
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      }),
    );
    const ids = (search.items || [])
      .map((item) => item.id?.playlistId)
      .filter((id): id is string => Boolean(id));
    if (!ids.length)
      return {
        query: input.query,
        playlists: [],
        next_page_token: search.nextPageToken,
        fetched_count: 0,
        returned_count: 0,
      };
    const detail = await this.requestClient.get<PlaylistsResponse>(
      "/playlists",
      new URLSearchParams({
        part: "snippet,contentDetails,status",
        id: ids.join(","),
      }),
    );
    const byId = new Map((detail.items || []).map((item) => [item.id, item]));
    const playlists = ids.flatMap((id) => {
      const playlist = byId.get(id);
      return playlist ? [normalizePlaylist(playlist)] : [];
    });
    return {
      query: input.query,
      playlists,
      next_page_token: search.nextPageToken,
      fetched_count: ids.length,
      returned_count: playlists.length,
    };
  }

  async getPlaylistItems(
    input: GetPlaylistItemsInput,
  ): Promise<YoutubePlaylistItemPage> {
    const parsed = parseYoutubePlaylistUrl(input.url);
    const playlists = await this.requestClient.get<PlaylistsResponse>(
      "/playlists",
      new URLSearchParams({
        part: "snippet,contentDetails",
        id: parsed.playlistId,
      }),
    );
    const playlist = playlists.items?.[0];
    if (!playlist) {
      throw new YoutubeMcpError(
        "The playlist was not found or is not publicly available.",
        "playlist_not_found",
      );
    }
    const response = await this.requestClient.get<PlaylistItemsResponse>(
      "/playlistItems",
      new URLSearchParams({
        part: "snippet,contentDetails",
        playlistId: parsed.playlistId,
        maxResults: String(input.limit),
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      }),
    );
    const items = (response.items || []).map(normalizePublicPlaylistItem);
    if (items.length === 0) {
      throw new YoutubeMcpError(
        "The playlist has no readable public items.",
        "playlist_items_unavailable",
      );
    }
    return {
      playlist: normalizePlaylist(playlist),
      items,
      next_page_token: response.nextPageToken,
      fetched_count: items.length,
    };
  }

  async findPlaylistItems(
    input: FindPlaylistItemsInput,
  ): Promise<YoutubePlaylistItemSearchResult> {
    const terms = input.matchTerms.map((term) => term.toLocaleLowerCase());
    let pageToken = input.pageToken;
    let nextPageToken: string | undefined;
    let playlist: YoutubePlaylistItemPage["playlist"] | undefined;
    const items: YoutubePlaylistItemSearchResult["items"] = [];
    let fetchedCount = 0;
    let searchedPages = 0;
    do {
      const page = await this.getPlaylistItems({
        url: input.url,
        limit: input.limit,
        pageToken,
      });
      playlist = page.playlist;
      fetchedCount += page.items.length;
      searchedPages += 1;
      items.push(
        ...page.items.filter((item) =>
          terms.some((term) =>
            `${item.title}\n${item.description}`
              .toLocaleLowerCase()
              .includes(term),
          ),
        ),
      );
      nextPageToken = page.next_page_token;
      pageToken = nextPageToken;
    } while (pageToken && searchedPages < input.maxPages);
    return {
      playlist: playlist!,
      items,
      next_page_token: nextPageToken,
      fetched_count: fetchedCount,
      matched_count: items.length,
      matched_terms: terms.filter((term) =>
        items.some((item) =>
          `${item.title}\n${item.description}`
            .toLocaleLowerCase()
            .includes(term),
        ),
      ),
      search_scope: "retrieved_pages_only",
      searched_pages: searchedPages,
      max_pages: input.maxPages,
      complete: !nextPageToken,
    };
  }

  private async getCommentPage(input: {
    videoId: string;
    limit: number;
    order: "relevance" | "time";
    pageToken?: string;
    includeReplies: boolean;
  }): Promise<{
    comments: YoutubeCommentPage["comments"];
    nextPageToken?: string;
  }> {
    const response = await this.requestClient.get<CommentThreadsResponse>(
      "/commentThreads",
      new URLSearchParams({
        part: input.includeReplies ? "snippet,replies" : "snippet",
        videoId: input.videoId,
        maxResults: String(input.limit),
        order: input.order,
        textFormat: "plainText",
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      }),
    );
    return {
      comments: (response.items || []).map((item) =>
        normalizeCommentThread(item, input.includeReplies),
      ),
      nextPageToken: response.nextPageToken,
    };
  }

  private async getChannelResource(url: string): Promise<{
    resource: YoutubeChannelResource;
    canonicalUrl: string;
    handle?: string;
  }> {
    const parsed = parseYoutubeChannelUrl(url);
    const response = await this.requestClient.get<ChannelResponse>(
      "/channels",
      new URLSearchParams({
        part: "snippet,statistics,contentDetails",
        ...(parsed.channelId
          ? { id: parsed.channelId }
          : { forHandle: parsed.handle! }),
      }),
    );
    const resource = response.items?.[0];
    if (!resource) {
      throw new YoutubeMcpError(
        "The channel was not found or is not publicly available.",
        "channel_not_found",
      );
    }
    return {
      resource,
      canonicalUrl: parsed.canonicalUrl,
      handle: parsed.handle,
    };
  }
}

function commentMatchesTerms(
  comment: YoutubeCommentPage["comments"][number],
  terms: string[],
): boolean {
  const text = [
    comment.text,
    ...(comment.replies || []).map((reply) => reply.text),
  ]
    .join("\n")
    .toLocaleLowerCase();
  return terms.some((term) => text.includes(term));
}
