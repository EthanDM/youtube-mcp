import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getYoutubeConfig } from "./config.js";
import { TranscriptClient } from "./lib/transcript.js";
import { YoutubeClient } from "./lib/youtube.js";
import {
  createToolHandlers,
  findCommentsSchema,
  getChannelSchema,
  getChannelVideosSchema,
  getCommentsSchema,
  getVideoSchema,
  getPlaylistItemsSchema,
  getTranscriptLanguagesSchema,
  getTranscriptSchema,
  searchVideosSchema,
} from "./tools.js";

/** Local stdio MCP exposing deliberately read-only YouTube research tools. */
const config = getYoutubeConfig();
const server = new McpServer({ name: "youtube-mcp", version: "0.2.0" });
const handlers = createToolHandlers(
  new YoutubeClient(config),
  new TranscriptClient(config.ytDlpPath),
);

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
  "youtube_search_videos",
  {
    title: "Search YouTube Videos",
    description:
      "Searches one explicit page of public YouTube videos and returns normalized metadata.",
    inputSchema: searchVideosSchema.shape,
  },
  handlers.searchVideos,
);

server.registerTool(
  "youtube_get_playlist_items",
  {
    title: "Get Public YouTube Playlist Items",
    description:
      "Gets one explicit page of a public YouTube playlist, including item IDs and positions.",
    inputSchema: getPlaylistItemsSchema.shape,
  },
  handlers.getPlaylistItems,
);

server.registerTool(
  "youtube_list_transcript_languages",
  {
    title: "List YouTube Transcript Languages",
    description:
      "Lists creator and automatic caption tracks exposed for a YouTube video.",
    inputSchema: getTranscriptLanguagesSchema.shape,
  },
  handlers.getTranscriptLanguages,
);

server.registerTool(
  "youtube_get_transcript",
  {
    title: "Get YouTube Transcript",
    description:
      "Gets one explicit page of timestamped creator or automatic YouTube caption segments.",
    inputSchema: getTranscriptSchema.shape,
  },
  handlers.getTranscript,
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
