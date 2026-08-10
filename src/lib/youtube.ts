import type { YoutubeConfig } from "../config.js";
import { YoutubeMcpError } from "../errors.js";
import type { YoutubeCommentPage, YoutubeVideo } from "../types.js";
import { parseYoutubeUrl } from "./youtube-url.js";
import {
  normalizeCommentThread,
  normalizeVideo,
  type YoutubeCommentResource,
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

export type GetCommentsInput = {
  url: string;
  limit: number;
  order: "relevance" | "time";
  pageToken?: string;
  includeReplies: boolean;
  matchTerms?: string[];
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
    const response = await this.requestClient.get<CommentThreadsResponse>(
      "/commentThreads",
      new URLSearchParams({
        part: input.includeReplies ? "snippet,replies" : "snippet",
        videoId: parsed.videoId,
        maxResults: String(input.limit),
        order: input.order,
        textFormat: "plainText",
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      }),
    );
    const comments = (response.items || []).map((item) =>
      normalizeCommentThread(item, input.includeReplies),
    );
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
      next_page_token: response.nextPageToken,
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
