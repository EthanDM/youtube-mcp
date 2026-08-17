import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getYoutubeConfig, getYoutubeOAuthConfig } from "./config.js";
import { YoutubeOAuthClient } from "./auth/oauth.js";
import { YoutubeTokenStore } from "./auth/token-store.js";
import { TranscriptClient } from "./lib/transcript.js";
import { AuthenticatedYoutubeClient } from "./lib/youtube-auth.js";
import { YoutubeAuthRequestClient } from "./lib/youtube-auth-request-client.js";
import { YoutubeClient } from "./lib/youtube.js";
import {
  createToolHandlers,
  findCommentsSchema,
  getChannelSchema,
  getChannelVideosSchema,
  getCommentsSchema,
  getVideoSchema,
  addPlaylistVideoSchema,
  addPlaylistVideosSchema,
  applyPlaylistOrderSchema,
  createPlaylistSchema,
  getOwnedPlaylistItemsSchema,
  listOwnedPlaylistsSchema,
  removePlaylistItemSchema,
  reorderPlaylistItemSchema,
  getPlaylistItemsSchema,
  getTranscriptLanguagesSchema,
  getTranscriptSchema,
  searchVideosSchema,
  searchChannelsSchema,
  searchPlaylistsSchema,
  getCommentRepliesSchema,
  findPlaylistItemsSchema,
  planPlaylistCleanupSchema,
  applyPlaylistCleanupSchema,
  clonePlaylistSchema,
  updatePlaylistInputSchema,
  searchTranscriptSchema,
} from "./tools.js";

/** Local stdio MCP for bounded YouTube research and owned-playlist management. */
const config = getYoutubeConfig();
const server = new McpServer({ name: "youtube-mcp", version: "0.6.0" });
const publicClient = new YoutubeClient(config);
const handlers = createToolHandlers(
  publicClient,
  new TranscriptClient(config.ytDlpPath),
  () => {
    const oauthConfig = getYoutubeOAuthConfig();
    const tokenStore = new YoutubeTokenStore(oauthConfig.tokenFile);
    return new AuthenticatedYoutubeClient(
      new YoutubeAuthRequestClient(
        tokenStore,
        new YoutubeOAuthClient(oauthConfig),
      ),
      publicClient,
    );
  },
);

server.registerTool(
  "youtube_get_authenticated_channel",
  {
    title: "Get Authenticated YouTube Channel",
    description:
      "Gets the YouTube channel attached to the local OAuth session.",
    inputSchema: {},
  },
  handlers.getAuthenticatedChannel,
);

server.registerTool(
  "youtube_list_owned_playlists",
  {
    title: "List Owned YouTube Playlists",
    description:
      "Gets one explicit page of playlists owned by the authenticated channel.",
    inputSchema: listOwnedPlaylistsSchema.shape,
  },
  handlers.listOwnedPlaylists,
);

server.registerTool(
  "youtube_get_owned_playlist_items",
  {
    title: "Get Owned YouTube Playlist Items",
    description:
      "Gets one explicit item page from a playlist owned by the authenticated channel.",
    inputSchema: getOwnedPlaylistItemsSchema.shape,
  },
  handlers.getOwnedPlaylistItems,
);

server.registerTool(
  "youtube_create_playlist",
  {
    title: "Create YouTube Playlist",
    description:
      "Creates a playlist owned by the authenticated channel. New playlists default to private.",
    inputSchema: createPlaylistSchema.shape,
  },
  handlers.createPlaylist,
);

server.registerTool(
  "youtube_update_playlist",
  {
    title: "Update YouTube Playlist",
    description:
      "Updates metadata on a playlist owned by the authenticated channel.",
    inputSchema: updatePlaylistInputSchema.shape,
  },
  handlers.updatePlaylist,
);

server.registerTool(
  "youtube_add_playlist_video",
  {
    title: "Add Video to YouTube Playlist",
    description:
      "Adds a public video to a playlist owned by the authenticated channel.",
    inputSchema: addPlaylistVideoSchema.shape,
  },
  handlers.addPlaylistVideo,
);

server.registerTool(
  "youtube_add_playlist_videos",
  {
    title: "Add Videos to YouTube Playlist",
    description:
      "Appends reviewed public videos to an owned playlist in the supplied order. Requires confirm: true.",
    inputSchema: addPlaylistVideosSchema.shape,
  },
  handlers.addPlaylistVideos,
);

server.registerTool(
  "youtube_remove_playlist_item",
  {
    title: "Remove YouTube Playlist Item",
    description:
      "Removes one exact item from an owned playlist. Requires confirm: true.",
    inputSchema: removePlaylistItemSchema.shape,
  },
  handlers.removePlaylistItem,
);

server.registerTool(
  "youtube_reorder_playlist_item",
  {
    title: "Reorder YouTube Playlist Item",
    description:
      "Moves one exact item in an owned playlist. Requires confirm: true.",
    inputSchema: reorderPlaylistItemSchema.shape,
  },
  handlers.reorderPlaylistItem,
);

server.registerTool(
  "youtube_apply_playlist_order",
  {
    title: "Apply YouTube Playlist Order",
    description:
      "Applies a reviewed complete item-ID order to an owned playlist of at most 250 items. Requires confirm: true.",
    inputSchema: applyPlaylistOrderSchema.shape,
  },
  handlers.applyPlaylistOrder,
);

server.registerTool(
  "youtube_clone_playlist",
  {
    title: "Clone YouTube Playlist",
    description:
      "Copies a bounded page range from a readable playlist into a new owned playlist. Requires confirm: true.",
    inputSchema: clonePlaylistSchema.shape,
  },
  handlers.clonePlaylist,
);

server.registerTool(
  "youtube_search_channels",
  {
    title: "Search YouTube Channels",
    description: "Searches one explicit page of public YouTube channels.",
    inputSchema: searchChannelsSchema.shape,
  },
  handlers.searchChannels,
);
server.registerTool(
  "youtube_search_playlists",
  {
    title: "Search YouTube Playlists",
    description: "Searches one explicit page of public YouTube playlists.",
    inputSchema: searchPlaylistsSchema.shape,
  },
  handlers.searchPlaylists,
);
server.registerTool(
  "youtube_get_comment_replies",
  {
    title: "Get YouTube Comment Replies",
    description: "Gets one explicit page of replies to a YouTube comment.",
    inputSchema: getCommentRepliesSchema.shape,
  },
  handlers.getCommentReplies,
);
server.registerTool(
  "youtube_find_playlist_items",
  {
    title: "Find YouTube Playlist Items",
    description:
      "Finds literal terms across bounded public or owned playlist pages.",
    inputSchema: findPlaylistItemsSchema.shape,
  },
  handlers.findPlaylistItems,
);
server.registerTool(
  "youtube_plan_playlist_cleanup",
  {
    title: "Plan YouTube Playlist Cleanup",
    description:
      "Plans deterministic duplicate and unavailable-item removals for an owned playlist without making changes.",
    inputSchema: planPlaylistCleanupSchema.shape,
  },
  handlers.planPlaylistCleanup,
);
server.registerTool(
  "youtube_apply_playlist_cleanup",
  {
    title: "Apply YouTube Playlist Cleanup",
    description:
      "Applies reviewed exact cleanup removals to an owned playlist. Requires confirm: true.",
    inputSchema: applyPlaylistCleanupSchema.shape,
  },
  handlers.applyPlaylistCleanup,
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
  "youtube_search_transcript",
  {
    title: "Search YouTube Transcript",
    description:
      "Finds literal terms in one explicit window of a YouTube caption track.",
    inputSchema: searchTranscriptSchema.shape,
  },
  handlers.searchTranscript,
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
