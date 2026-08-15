import { YoutubeMcpError } from "../errors.js";
import type {
  YoutubeChannel,
  YoutubeOwnedPlaylistPage,
  YoutubePlaylist,
  YoutubePlaylistItem,
  YoutubePlaylistItemPage,
  YoutubePlaylistItemSearchResult,
  YoutubePlaylistCleanupPlan,
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
type VideoIdsResponse = { items?: Array<{ id: string }> };
type CleanupCursor = {
  version: 1;
  playlistId: string;
  nextPageToken: string;
  retained: Array<[string, string]>;
};

function parseCleanupCursor(cursor: string): CleanupCursor {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      !value ||
      typeof value !== "object" ||
      (value as CleanupCursor).version !== 1 ||
      typeof (value as CleanupCursor).playlistId !== "string" ||
      typeof (value as CleanupCursor).nextPageToken !== "string" ||
      !Array.isArray((value as CleanupCursor).retained) ||
      !(value as CleanupCursor).retained.every(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          entry.every((part) => typeof part === "string" && part.length > 0),
      )
    ) {
      throw new Error("Invalid cursor");
    }
    return value as CleanupCursor;
  } catch {
    throw new YoutubeMcpError(
      "The cleanup cursor is invalid.",
      "playlist_cleanup_cursor_invalid",
    );
  }
}

function createCleanupCursor(
  playlistId: string,
  nextPageToken: string,
  retained: Map<string, string>,
): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      playlistId,
      nextPageToken,
      retained: [...retained],
    } satisfies CleanupCursor),
  ).toString("base64url");
}

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

  async findPlaylistItems(input: {
    url: string;
    matchTerms: string[];
    maxPages: number;
    limit: number;
    pageToken?: string;
  }): Promise<YoutubePlaylistItemSearchResult> {
    const terms = input.matchTerms.map((term) => term.toLocaleLowerCase());
    const playlist = await this.getOwnedPlaylist(input.url);
    let pageToken = input.pageToken;
    let nextPageToken: string | undefined;
    let fetchedCount = 0;
    let searchedPages = 0;
    const items: YoutubePlaylistItemSearchResult["items"] = [];
    do {
      const response = await this.requestClient.request<PlaylistItemsResponse>({
        method: "GET",
        path: "/playlistItems",
        query: new URLSearchParams({
          part: "snippet,contentDetails",
          playlistId: playlist.id,
          maxResults: String(input.limit),
          ...(pageToken ? { pageToken } : {}),
        }),
      });
      const page = (response.items || []).map(normalizePublicPlaylistItem);
      fetchedCount += page.length;
      searchedPages += 1;
      items.push(
        ...page.filter((item) =>
          terms.some((term) =>
            `${item.title}\n${item.description}`
              .toLocaleLowerCase()
              .includes(term),
          ),
        ),
      );
      nextPageToken = response.nextPageToken;
      pageToken = nextPageToken;
    } while (pageToken && searchedPages < input.maxPages);
    return {
      playlist,
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

  async planPlaylistCleanup(input: {
    url: string;
    cursor?: string;
    maxPages: number;
    limit: number;
  }): Promise<YoutubePlaylistCleanupPlan> {
    const playlist = await this.getOwnedPlaylist(input.url);
    const cursor = input.cursor ? parseCleanupCursor(input.cursor) : undefined;
    if (cursor && cursor.playlistId !== playlist.id) {
      throw new YoutubeMcpError(
        "The cleanup cursor does not match this playlist.",
        "playlist_cleanup_cursor_invalid",
      );
    }
    let pageToken = cursor?.nextPageToken;
    let nextPageToken: string | undefined;
    let fetchedCount = 0;
    let searchedPages = 0;
    const seen = await this.getValidatedRetainedItems(
      playlist.id,
      cursor?.retained || [],
    );
    const allItems: YoutubePlaylistItemPage["items"] = [];
    do {
      const response = await this.requestClient.request<PlaylistItemsResponse>({
        method: "GET",
        path: "/playlistItems",
        query: new URLSearchParams({
          part: "snippet,contentDetails",
          playlistId: playlist.id,
          maxResults: String(input.limit),
          ...(pageToken ? { pageToken } : {}),
        }),
      });
      allItems.push(...(response.items || []).map(normalizePublicPlaylistItem));
      fetchedCount += response.items?.length || 0;
      searchedPages += 1;
      nextPageToken = response.nextPageToken;
      pageToken = nextPageToken;
    } while (pageToken && searchedPages < input.maxPages);
    const unavailableVideoIds = await this.getUnavailableVideoIds(
      allItems.flatMap((item) => (item.video_id ? [item.video_id] : [])),
    );
    const removals: YoutubePlaylistCleanupPlan["removals"] = [];
    const unavailable_items: YoutubePlaylistCleanupPlan["unavailable_items"] =
      [];
    for (const item of allItems) {
      if (!item.video_id || unavailableVideoIds.has(item.video_id)) {
        unavailable_items.push(item);
        removals.push({
          playlist_item_id: item.playlist_item_id,
          reason: "unavailable_video",
        });
        continue;
      }
      const retained = seen.get(item.video_id);
      if (retained && retained !== item.playlist_item_id)
        removals.push({
          playlist_item_id: item.playlist_item_id,
          reason: "duplicate_video",
        });
      else if (!retained) seen.set(item.video_id, item.playlist_item_id);
    }
    const duplicate_groups = [...seen].flatMap(
      ([video_id, retained_playlist_item_id]) => {
        const removal_playlist_item_ids = removals
          .filter((removal) => removal.reason === "duplicate_video")
          .map((removal) => removal.playlist_item_id)
          .filter((id) =>
            allItems.some(
              (item) =>
                item.playlist_item_id === id && item.video_id === video_id,
            ),
          );
        return removal_playlist_item_ids.length
          ? [{ video_id, retained_playlist_item_id, removal_playlist_item_ids }]
          : [];
      },
    );
    return {
      playlist,
      removals,
      duplicate_groups,
      unavailable_items,
      next_page_token: nextPageToken,
      next_cursor: nextPageToken
        ? createCleanupCursor(playlist.id, nextPageToken, seen)
        : undefined,
      fetched_count: fetchedCount,
      searched_pages: searchedPages,
      max_pages: input.maxPages,
      complete: !nextPageToken,
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
    const observed = await this.getPlaylistById(response.id);
    if (
      observed.title !== input.title ||
      (input.description !== undefined &&
        observed.description !== input.description) ||
      observed.privacy_status !== input.privacy_status
    ) {
      throw new YoutubeMcpError(
        "YouTube did not confirm the created playlist state.",
        "playlist_write_verification_failed",
      );
    }
    return observed;
  }

  async updatePlaylist(input: {
    url: string;
    title?: string;
    description?: string;
    privacy_status?: "private" | "unlisted" | "public";
  }): Promise<YoutubePlaylist> {
    const playlist = await this.getOwnedPlaylist(input.url);
    const title = input.title ?? playlist.title;
    const description = input.description ?? playlist.description;
    const privacyStatus = input.privacy_status ?? playlist.privacy_status;
    const response = await this.requestClient.request<YoutubePlaylistResource>({
      method: "PUT",
      path: "/playlists",
      query: new URLSearchParams({ part: "snippet,status" }),
      body: {
        id: playlist.id,
        snippet: {
          title,
          description,
        },
        ...(privacyStatus ? { status: { privacyStatus } } : {}),
      },
    });
    const observed = await this.getPlaylistById(response.id);
    if (
      observed.title !== title ||
      observed.description !== description ||
      (privacyStatus !== undefined && observed.privacy_status !== privacyStatus)
    ) {
      throw new YoutubeMcpError(
        "YouTube did not confirm the updated playlist state.",
        "playlist_write_verification_failed",
      );
    }
    return observed;
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
    const observed = normalizePublicPlaylistItem(
      await this.getPlaylistItem(playlist.id, response.id),
    );
    if (
      observed.video_id !== video.videoId ||
      (input.position !== undefined && observed.position !== input.position)
    ) {
      throw new YoutubeMcpError(
        "YouTube did not confirm the added playlist item state.",
        "playlist_write_verification_failed",
      );
    }
    return observed;
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
    const observed = await this.requestClient.request<PlaylistItemsResponse>({
      method: "GET",
      path: "/playlistItems",
      query: new URLSearchParams({ part: "snippet", id: input.playlistItemId }),
    });
    if (observed.items?.length)
      throw new YoutubeMcpError(
        "YouTube did not confirm playlist item removal.",
        "playlist_write_verification_failed",
      );
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
    const observed = await this.getPlaylistItem(playlist.id, response.id);
    if (observed.snippet.position !== input.position)
      throw new YoutubeMcpError(
        "YouTube did not confirm playlist item position.",
        "playlist_write_verification_failed",
      );
    return normalizePublicPlaylistItem(observed);
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

  private async getPlaylistById(id: string): Promise<YoutubePlaylist> {
    const response = await this.requestClient.request<PlaylistResponse>({
      method: "GET",
      path: "/playlists",
      query: new URLSearchParams({ part: "snippet,contentDetails,status", id }),
    });
    const playlist = response.items?.[0];
    if (!playlist)
      throw new YoutubeMcpError(
        "YouTube did not return the playlist after mutation.",
        "playlist_write_verification_failed",
      );
    return normalizePlaylist(playlist);
  }

  private async getUnavailableVideoIds(
    videoIds: string[],
  ): Promise<Set<string>> {
    const uniqueVideoIds = [...new Set(videoIds)];
    const availableVideoIds = new Set<string>();
    for (let index = 0; index < uniqueVideoIds.length; index += 50) {
      const batch = uniqueVideoIds.slice(index, index + 50);
      const response = await this.requestClient.request<VideoIdsResponse>({
        method: "GET",
        path: "/videos",
        query: new URLSearchParams({ part: "id", id: batch.join(",") }),
      });
      for (const video of response.items || []) availableVideoIds.add(video.id);
    }
    return new Set(
      uniqueVideoIds.filter((videoId) => !availableVideoIds.has(videoId)),
    );
  }

  private async getValidatedRetainedItems(
    playlistId: string,
    retained: Array<[string, string]>,
  ): Promise<Map<string, string>> {
    const expectedVideoIdsByItemId = new Map(
      retained.map(([videoId, playlistItemId]) => [playlistItemId, videoId]),
    );
    const validated = new Map<string, string>();
    const playlistItemIds = [...expectedVideoIdsByItemId.keys()];
    for (let index = 0; index < playlistItemIds.length; index += 50) {
      const response = await this.requestClient.request<PlaylistItemsResponse>({
        method: "GET",
        path: "/playlistItems",
        query: new URLSearchParams({
          part: "snippet,contentDetails",
          id: playlistItemIds.slice(index, index + 50).join(","),
          maxResults: String(Math.min(50, playlistItemIds.length - index)),
        }),
      });
      for (const item of response.items || []) {
        const videoId =
          item.contentDetails?.videoId || item.snippet.resourceId?.videoId;
        if (
          item.snippet.playlistId === playlistId &&
          videoId &&
          expectedVideoIdsByItemId.get(item.id) === videoId
        ) {
          validated.set(videoId, item.id);
        }
      }
    }
    return validated;
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
