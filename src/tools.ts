import { z } from "zod";

import { formatErrorMessage } from "./errors.js";
import type { TranscriptClient } from "./lib/transcript.js";
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

export function createToolHandlers(
  client: YoutubeClient,
  transcriptClient: TranscriptClient,
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
    getPlaylistItems: async (input: unknown) => {
      try {
        const parsed = getPlaylistItemsSchema.parse(input);
        return toolSuccess(await client.getPlaylistItems(parsed));
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
