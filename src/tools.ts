import { z } from "zod";

import { formatErrorMessage } from "./errors.js";
import type { TranscriptClient } from "./lib/transcript.js";
import type { AuthenticatedYoutubeClient } from "./lib/youtube-auth.js";
import type { YoutubeClient } from "./lib/youtube.js";

const urlSchema = z.string().url();
const pageTokenSchema = z.string().trim().min(1).max(1_000).optional();

export const getVideoSchema = z.object({ url: urlSchema });

export const getChannelSchema = z.object({ url: urlSchema });

export const getChannelVideosSchema = z.object({
  url: urlSchema,
  limit: z.number().int().min(1).max(50).default(25),
  pageToken: pageTokenSchema,
});

export const getCommentsSchema = z.object({
  url: urlSchema,
  limit: z.number().int().min(1).max(100).default(50),
  order: z.enum(["relevance", "time"]).default("relevance"),
  pageToken: pageTokenSchema,
  includeReplies: z.boolean().default(false),
  matchTerms: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(10)
    .optional(),
});

export const findCommentsSchema = z.object({
  url: urlSchema,
  matchTerms: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  maxPages: z.number().int().min(1).max(5),
  limit: z.number().int().min(1).max(100).default(100),
  order: z.enum(["relevance", "time"]).default("relevance"),
  pageToken: pageTokenSchema,
  includeReplies: z.boolean().default(false),
});

export const searchVideosSchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(25).default(10),
  pageToken: pageTokenSchema,
  order: z.enum(["relevance", "date", "viewCount"]).default("relevance"),
});
export const searchChannelsSchema = searchVideosSchema;
export const searchPlaylistsSchema = searchVideosSchema;
export const getCommentRepliesSchema = z.object({
  parent_comment_id: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(100).default(50),
  pageToken: pageTokenSchema,
});
export const findPlaylistItemsSchema = z.object({
  url: urlSchema,
  matchTerms: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  access: z.enum(["public", "owned"]).default("public"),
  maxPages: z.number().int().min(1).max(5).default(5),
  limit: z.number().int().min(1).max(50).default(50),
  pageToken: pageTokenSchema,
});
export const planPlaylistCleanupSchema = z.object({
  url: urlSchema,
  cursor: z.string().trim().min(1).optional(),
  maxPages: z.number().int().min(1).max(5).default(5),
  limit: z.number().int().min(1).max(50).default(50),
});
const cleanupRemovalSchema = z.object({
  playlist_item_id: z.string().trim().min(1).max(200),
  reason: z.enum(["duplicate_video", "unavailable_video"]),
});
export const applyPlaylistCleanupSchema = z.object({
  url: urlSchema,
  removals: z.array(cleanupRemovalSchema).min(1).max(250),
  confirm: z.literal(true),
});

export const getPlaylistItemsSchema = z.object({
  url: urlSchema,
  limit: z.number().int().min(1).max(50).default(25),
  pageToken: pageTokenSchema,
});

export const getTranscriptLanguagesSchema = z.object({ url: urlSchema });

export const getTranscriptSchema = z.object({
  url: urlSchema,
  language: z.string().trim().min(1).max(50).optional(),
  cursor: pageTokenSchema,
  maxSegments: z.number().int().min(1).max(500).default(250),
});
export const searchTranscriptSchema = z.object({
  url: urlSchema,
  matchTerms: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  language: z.string().trim().min(1).max(50).optional(),
  cursor: pageTokenSchema,
  maxSegments: z.number().int().min(1).max(500).default(250),
});

const playlistPrivacySchema = z.enum(["private", "unlisted", "public"]);
export const listOwnedPlaylistsSchema = z.object({
  limit: z.number().int().min(1).max(50).default(25),
  pageToken: pageTokenSchema,
});
export const getOwnedPlaylistItemsSchema = z.object({
  url: urlSchema,
  limit: z.number().int().min(1).max(50).default(25),
  pageToken: pageTokenSchema,
});
export const createPlaylistSchema = z.object({
  title: z.string().trim().min(1).max(150),
  description: z.string().max(5_000).optional(),
  privacy_status: playlistPrivacySchema.default("private"),
});
export const updatePlaylistInputSchema = z.object({
  url: urlSchema,
  title: z.string().trim().min(1).max(150).optional(),
  description: z.string().max(5_000).optional(),
  privacy_status: playlistPrivacySchema.optional(),
});
export const updatePlaylistSchema = updatePlaylistInputSchema.refine(
  (input) =>
    input.title !== undefined ||
    input.description !== undefined ||
    input.privacy_status !== undefined,
  { message: "Provide at least one playlist field to update." },
);
export const addPlaylistVideoSchema = z.object({
  url: urlSchema,
  video_url: urlSchema,
  position: z.number().int().min(0).optional(),
});
export const addPlaylistVideosSchema = z.object({
  url: urlSchema,
  video_urls: z.array(urlSchema).min(1).max(250),
  confirm: z.literal(true),
});
export const removePlaylistItemSchema = z.object({
  url: urlSchema,
  playlist_item_id: z.string().trim().min(1).max(200),
  confirm: z.literal(true),
});
export const reorderPlaylistItemSchema = z.object({
  url: urlSchema,
  playlist_item_id: z.string().trim().min(1).max(200),
  position: z.number().int().min(0),
  confirm: z.literal(true),
});
export const applyPlaylistOrderSchema = z.object({
  url: urlSchema,
  ordered_playlist_item_ids: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(250),
  confirm: z.literal(true),
});
export const clonePlaylistSchema = z.object({
  source_url: urlSchema,
  source_access: z.enum(["public", "owned"]).default("public"),
  title: z.string().trim().min(1).max(150).optional(),
  description: z.string().max(5_000).optional(),
  privacy_status: playlistPrivacySchema.default("private"),
  limit: z.number().int().min(1).max(50).default(50),
  maxPages: z.number().int().min(1).max(5).default(1),
  confirm: z.literal(true),
});

export function createToolHandlers(
  client: YoutubeClient,
  transcriptClient: TranscriptClient,
  getAuthenticatedClient: () => AuthenticatedYoutubeClient,
) {
  return {
    getVideo: async (input: unknown) => {
      try {
        const parsed = getVideoSchema.parse(input);
        return toolSuccess(await client.getVideo(parsed.url));
      } catch (error) {
        return toolError(error);
      }
    },
    getComments: async (input: unknown) => {
      try {
        const parsed = getCommentsSchema.parse(input);
        return toolSuccess(await client.getComments(parsed));
      } catch (error) {
        return toolError(error);
      }
    },
    findComments: async (input: unknown) => {
      try {
        const parsed = findCommentsSchema.parse(input);
        return toolSuccess(await client.findComments(parsed));
      } catch (error) {
        return toolError(error);
      }
    },
    getCommentReplies: async (input: unknown) => {
      try {
        const parsed = getCommentRepliesSchema.parse(input);
        return toolSuccess(
          await client.getCommentReplies({
            parentCommentId: parsed.parent_comment_id,
            limit: parsed.limit,
            pageToken: parsed.pageToken,
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    getChannel: async (input: unknown) => {
      try {
        const parsed = getChannelSchema.parse(input);
        return toolSuccess(await client.getChannel(parsed.url));
      } catch (error) {
        return toolError(error);
      }
    },
    getChannelVideos: async (input: unknown) => {
      try {
        const parsed = getChannelVideosSchema.parse(input);
        return toolSuccess(await client.getChannelVideos(parsed));
      } catch (error) {
        return toolError(error);
      }
    },
    searchVideos: async (input: unknown) => {
      try {
        const parsed = searchVideosSchema.parse(input);
        return toolSuccess(await client.searchVideos(parsed));
      } catch (error) {
        return toolError(error);
      }
    },
    searchChannels: async (input: unknown) => {
      try {
        return toolSuccess(
          await client.searchChannels(searchChannelsSchema.parse(input)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    searchPlaylists: async (input: unknown) => {
      try {
        return toolSuccess(
          await client.searchPlaylists(searchPlaylistsSchema.parse(input)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    getPlaylistItems: async (input: unknown) => {
      try {
        const parsed = getPlaylistItemsSchema.parse(input);
        return toolSuccess(await client.getPlaylistItems(parsed));
      } catch (error) {
        return toolError(error);
      }
    },
    findPlaylistItems: async (input: unknown) => {
      try {
        const parsed = findPlaylistItemsSchema.parse(input);
        if (parsed.access === "public")
          return toolSuccess(await client.findPlaylistItems(parsed));
        return toolSuccess(
          await getAuthenticatedClient().findPlaylistItems(parsed),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    planPlaylistCleanup: async (input: unknown) => {
      try {
        return toolSuccess(
          await getAuthenticatedClient().planPlaylistCleanup(
            planPlaylistCleanupSchema.parse(input),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    applyPlaylistCleanup: async (input: unknown) => {
      try {
        const parsed = applyPlaylistCleanupSchema.parse(input);
        return toolSuccess(
          await getAuthenticatedClient().applyPlaylistCleanup(parsed),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    getTranscriptLanguages: async (input: unknown) => {
      try {
        const parsed = getTranscriptLanguagesSchema.parse(input);
        return toolSuccess(await transcriptClient.listLanguages(parsed.url));
      } catch (error) {
        return toolError(error);
      }
    },
    getTranscript: async (input: unknown) => {
      try {
        const parsed = getTranscriptSchema.parse(input);
        return toolSuccess(await transcriptClient.getTranscript(parsed));
      } catch (error) {
        return toolError(error);
      }
    },
    searchTranscript: async (input: unknown) => {
      try {
        return toolSuccess(
          await transcriptClient.searchTranscript(
            searchTranscriptSchema.parse(input),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    getAuthenticatedChannel: async () => {
      try {
        return toolSuccess(
          await getAuthenticatedClient().getAuthenticatedChannel(),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    listOwnedPlaylists: async (input: unknown) => {
      try {
        return toolSuccess(
          await getAuthenticatedClient().listOwnedPlaylists(
            listOwnedPlaylistsSchema.parse(input),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    getOwnedPlaylistItems: async (input: unknown) => {
      try {
        return toolSuccess(
          await getAuthenticatedClient().getOwnedPlaylistItems(
            getOwnedPlaylistItemsSchema.parse(input),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    createPlaylist: async (input: unknown) => {
      try {
        return toolSuccess(
          await getAuthenticatedClient().createPlaylist(
            createPlaylistSchema.parse(input),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    updatePlaylist: async (input: unknown) => {
      try {
        return toolSuccess(
          await getAuthenticatedClient().updatePlaylist(
            updatePlaylistSchema.parse(input),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    addPlaylistVideo: async (input: unknown) => {
      try {
        const parsed = addPlaylistVideoSchema.parse(input);
        return toolSuccess(
          await getAuthenticatedClient().addPlaylistVideo({
            url: parsed.url,
            videoUrl: parsed.video_url,
            position: parsed.position,
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    addPlaylistVideos: async (input: unknown) => {
      try {
        const parsed = addPlaylistVideosSchema.parse(input);
        return toolSuccess(
          await getAuthenticatedClient().addPlaylistVideos({
            url: parsed.url,
            videoUrls: parsed.video_urls,
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    removePlaylistItem: async (input: unknown) => {
      try {
        const parsed = removePlaylistItemSchema.parse(input);
        return toolSuccess(
          await getAuthenticatedClient().removePlaylistItem({
            url: parsed.url,
            playlistItemId: parsed.playlist_item_id,
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    reorderPlaylistItem: async (input: unknown) => {
      try {
        const parsed = reorderPlaylistItemSchema.parse(input);
        return toolSuccess(
          await getAuthenticatedClient().reorderPlaylistItem({
            url: parsed.url,
            playlistItemId: parsed.playlist_item_id,
            position: parsed.position,
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    applyPlaylistOrder: async (input: unknown) => {
      try {
        const parsed = applyPlaylistOrderSchema.parse(input);
        return toolSuccess(
          await getAuthenticatedClient().applyPlaylistOrder({
            url: parsed.url,
            orderedPlaylistItemIds: parsed.ordered_playlist_item_ids,
          }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
    clonePlaylist: async (input: unknown) => {
      try {
        return toolSuccess(
          await getAuthenticatedClient().clonePlaylist(
            clonePlaylistSchema.parse(input),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  };
}

type ToolResponse = {
  isError: boolean;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
};

function toolSuccess(result: Record<string, unknown>): ToolResponse {
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

function toolError(error: unknown): ToolResponse {
  return {
    isError: true,
    content: [{ type: "text", text: formatErrorMessage(error) }],
  };
}
