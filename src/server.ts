import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getYoutubeConfig } from "./config.js";
import { YoutubeClient } from "./lib/youtube.js";
import {
  createToolHandlers,
  findCommentsSchema,
  getChannelSchema,
  getChannelVideosSchema,
  getCommentsSchema,
  getVideoSchema,
} from "./tools.js";

/** Local stdio MCP exposing a deliberately read-only YouTube reader. */
const server = new McpServer({ name: "youtube-mcp", version: "0.1.0" });
const handlers = createToolHandlers(new YoutubeClient(getYoutubeConfig()));

server.registerTool(
  "youtube_get_video",
  {
    title: "Get YouTube Video",
    description: "Gets normalized public metadata for a YouTube video URL.",
    inputSchema: getVideoSchema.shape,
  },
  handlers.getVideo,
);

server.registerTool(
  "youtube_get_channel",
  {
    title: "Get YouTube Channel",
    description:
      "Gets normalized public metadata for a YouTube channel URL using /channel/CHANNEL_ID or /@handle.",
    inputSchema: getChannelSchema.shape,
  },
  handlers.getChannel,
);

server.registerTool(
  "youtube_get_channel_videos",
  {
    title: "Get YouTube Channel Videos",
    description:
      "Gets one explicit page of recent public uploads from a YouTube channel URL.",
    inputSchema: getChannelVideosSchema.shape,
  },
  handlers.getChannelVideos,
);

server.registerTool(
  "youtube_find_comments",
  {
    title: "Find YouTube Comments",
    description:
      "Finds literal terms across an explicit bounded number of comment pages. Results always describe retrieved pages only, never every comment on the video.",
    inputSchema: findCommentsSchema.shape,
  },
  handlers.findComments,
);

server.registerTool(
  "youtube_get_comments",
  {
    title: "Get YouTube Comments",
    description:
      "Gets one explicit page of public YouTube comment threads. matchTerms only filters the retrieved page, not every comment on the video.",
    inputSchema: getCommentsSchema.shape,
  },
  handlers.getComments,
);

await server.connect(new StdioServerTransport());
