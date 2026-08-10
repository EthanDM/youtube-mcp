import { z } from "zod";

import { formatErrorMessage } from "./errors.js";
import type { YoutubeClient } from "./lib/youtube.js";

const urlSchema = z.string().url();
const pageTokenSchema = z.string().trim().min(1).max(1_000).optional();

export const getVideoSchema = z.object({ url: urlSchema });

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

export function createToolHandlers(client: YoutubeClient) {
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
