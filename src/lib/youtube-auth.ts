import { YoutubeMcpError } from "../errors.js";
import type {
  YoutubeChannel,
  YoutubeOwnedPlaylistPage,
  YoutubePlaylist,
  YoutubePlaylistItem,
  YoutubePlaylistItemPage,
} from "../types.js";
import {
  normalizeChannel,
  normalizePlaylist,
  normalizePublicPlaylistItem,
  type YoutubeChannelResource,
  type YoutubePlaylistItemResource,
  type YoutubePlaylistResource,
} from "./youtube-normalizers.js";
import { parseYoutubePlaylistUrl, parseYoutubeUrl } from "./youtube-url.js";
import { YoutubeAuthRequestClient } from "./youtube-auth-request-client.js";

type ChannelResponse = { items?: YoutubeChannelResource[] };
type PlaylistResponse = {
  items?: YoutubePlaylistResource[];
  nextPageToken?: string;
};
type PlaylistItemsResponse = {
  items?: YoutubePlaylistItemResource[];
  nextPageToken?: string;
};

/** Owns account-scoped playlist reads and writes, including ownership enforcement. */
export class AuthenticatedYoutubeClient {
  constructor(private readonly requestClient: YoutubeAuthRequestClient) {}

  async getAuthenticatedChannel(): Promise<YoutubeChannel> {
    const response = await this.requestClient.request<ChannelResponse>({
      method: "GET",
      path: "/channels",
      query: new URLSearchParams({
        part: "snippet,statistics,contentDetails",
        mine: "true",
      }),
    });
    const channel = response.items?.[0];
    if (!channel)
      throw new YoutubeMcpError(
        "The OAuth account has no accessible YouTube channel.",
        "auth_channel_unavailable",
      );
    return normalizeChannel(
      channel,
      `https://www.youtube.com/channel/${channel.id}`,
    );
  }

  async listOwnedPlaylists(input: {
    limit: number;
    pageToken?: string;
  }): Promise<YoutubeOwnedPlaylistPage> {
    const response = await this.requestClient.request<PlaylistResponse>({
      method: "GET",
      path: "/playlists",
      query: new URLSearchParams({
        part: "snippet,contentDetails,status",
        mine: "true",
        maxResults: String(input.limit),
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      }),
    });
    const playlists = (response.items || []).map(normalizePlaylist);
    return {
      playlists,
      next_page_token: response.nextPageToken,
      fetched_count: playlists.length,
    };
  }

  async getOwnedPlaylistItems(input: {
    url: string;
    limit: number;
    pageToken?: string;
  }): Promise<YoutubePlaylistItemPage> {
    const playlist = await this.getOwnedPlaylist(input.url);
    const response = await this.requestClient.request<PlaylistItemsResponse>({
      method: "GET",
      path: "/playlistItems",
      query: new URLSearchParams({
        part: "snippet,contentDetails",
        playlistId: playlist.id,
        maxResults: String(input.limit),
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      }),
    });
    const items = (response.items || []).map(normalizePublicPlaylistItem);
    return {
      playlist,
      items,
      next_page_token: response.nextPageToken,
      fetched_count: items.length,
    };
  }

  async createPlaylist(input: {
    title: string;
    description?: string;
    privacy_status: "private" | "unlisted" | "public";
  }): Promise<YoutubePlaylist> {
    const response = await this.requestClient.request<YoutubePlaylistResource>({
      method: "POST",
      path: "/playlists",
      query: new URLSearchParams({ part: "snippet,status" }),
      body: {
        snippet: {
          title: input.title,
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
        },
        status: { privacyStatus: input.privacy_status },
      },
    });
    return normalizePlaylist(response);
  }

  async updatePlaylist(input: {
    url: string;
    title?: string;
    description?: string;
    privacy_status?: "private" | "unlisted" | "public";
  }): Promise<YoutubePlaylist> {
    const playlist = await this.getOwnedPlaylist(input.url);
    const response = await this.requestClient.request<YoutubePlaylistResource>({
      method: "PUT",
      path: "/playlists",
      query: new URLSearchParams({ part: "snippet,status" }),
      body: {
        id: playlist.id,
        snippet: {
          title: input.title ?? playlist.title,
          description: input.description ?? playlist.description,
        },
        ...(input.privacy_status
          ? { status: { privacyStatus: input.privacy_status } }
          : {}),
      },
    });
    return normalizePlaylist(response);
  }

  async addPlaylistVideo(input: {
    url: string;
    videoUrl: string;
    position?: number;
  }): Promise<YoutubePlaylistItem> {
    const playlist = await this.getOwnedPlaylist(input.url);
    const video = parseYoutubeUrl(input.videoUrl);
    const response =
      await this.requestClient.request<YoutubePlaylistItemResource>({
        method: "POST",
        path: "/playlistItems",
        query: new URLSearchParams({ part: "snippet,contentDetails" }),
        body: {
          snippet: {
            playlistId: playlist.id,
            resourceId: { kind: "youtube#video", videoId: video.videoId },
            ...(input.position !== undefined
              ? { position: input.position }
              : {}),
          },
        },
      });
    return normalizePublicPlaylistItem(response);
  }

  async removePlaylistItem(input: {
    url: string;
    playlistItemId: string;
  }): Promise<{ playlist_item_id: string; removed: true }> {
    const playlist = await this.getOwnedPlaylist(input.url);
    await this.getPlaylistItem(playlist.id, input.playlistItemId);
    await this.requestClient.request({
      method: "DELETE",
      path: "/playlistItems",
      query: new URLSearchParams({ id: input.playlistItemId }),
    });
    return { playlist_item_id: input.playlistItemId, removed: true };
  }

  async reorderPlaylistItem(input: {
    url: string;
    playlistItemId: string;
    position: number;
  }): Promise<YoutubePlaylistItem> {
    const playlist = await this.getOwnedPlaylist(input.url);
    const item = await this.getPlaylistItem(playlist.id, input.playlistItemId);
    const videoId =
      item.contentDetails?.videoId || item.snippet.resourceId?.videoId;
    if (!videoId)
      throw new YoutubeMcpError(
        "The playlist item does not contain a readable video.",
        "playlist_item_unavailable",
      );
    const response =
      await this.requestClient.request<YoutubePlaylistItemResource>({
        method: "PUT",
        path: "/playlistItems",
        query: new URLSearchParams({ part: "snippet,contentDetails" }),
        body: {
          id: item.id,
          snippet: {
            playlistId: playlist.id,
            position: input.position,
            resourceId: { kind: "youtube#video", videoId },
          },
        },
      });
    return normalizePublicPlaylistItem(response);
  }

  private async getOwnedPlaylist(url: string): Promise<YoutubePlaylist> {
    const parsed = parseYoutubePlaylistUrl(url);
    const response = await this.requestClient.request<PlaylistResponse>({
      method: "GET",
      path: "/playlists",
      query: new URLSearchParams({
        part: "snippet,contentDetails,status",
        id: parsed.playlistId,
      }),
    });
    const resource = response.items?.[0];
    if (!resource)
      throw new YoutubeMcpError(
        "The playlist was not found or is not accessible.",
        "playlist_not_found",
      );
    const channel = await this.getAuthenticatedChannel();
    if (resource.snippet.channelId !== channel.id)
      throw new YoutubeMcpError(
        "Only playlists owned by the authenticated channel can be managed.",
        "playlist_not_owned",
      );
    return normalizePlaylist(resource);
  }

  private async getPlaylistItem(
    playlistId: string,
    playlistItemId: string,
  ): Promise<YoutubePlaylistItemResource> {
    const response = await this.requestClient.request<PlaylistItemsResponse>({
      method: "GET",
      path: "/playlistItems",
      query: new URLSearchParams({
        part: "snippet,contentDetails",
        id: playlistItemId,
      }),
    });
    const item = response.items?.[0];
    if (!item || item.snippet.playlistId !== playlistId) {
      throw new YoutubeMcpError(
        "The playlist item was not found in the specified owned playlist.",
        "playlist_item_not_owned",
      );
    }
    return item;
  }
}
