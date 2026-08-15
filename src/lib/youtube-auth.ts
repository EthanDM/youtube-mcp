import { YoutubeMcpError } from "../errors.js";
import type {
  YoutubeChannel,
  YoutubeOwnedPlaylistPage,
  YoutubePlaylist,
  YoutubePlaylistItem,
  YoutubePlaylistItemPage,
  YoutubePlaylistItemSearchResult,
  YoutubePlaylistCleanupPlan,
  YoutubePlaylistCleanupApplyResult,
  YoutubePlaylistCloneResult,
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
import type { YoutubeClient } from "./youtube.js";

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

class PlaylistCreationVerificationError extends YoutubeMcpError {
  constructor(
    error: unknown,
    readonly playlist: YoutubePlaylist,
  ) {
    super(
      error instanceof Error
        ? error.message
        : "YouTube playlist creation verification failed.",
      error instanceof YoutubeMcpError ? error.code : "playlist_write_failed",
    );
    this.name = "PlaylistCreationVerificationError";
  }
}

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
  constructor(
    private readonly requestClient: YoutubeAuthRequestClient,
    private readonly publicClient?: Pick<
      YoutubeClient,
      "getPlaylistItems" | "getUnavailableVideoIds"
    >,
  ) {}

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
    const unavailableVideoIds = await this.getUnavailableVideoIds([
      ...allItems.flatMap((item) => (item.video_id ? [item.video_id] : [])),
      ...seen.keys(),
    ]);
    const removals: YoutubePlaylistCleanupPlan["removals"] = [];
    const unavailable_items: YoutubePlaylistCleanupPlan["unavailable_items"] =
      [];
    const currentItemIds = new Set(
      allItems.map((item) => item.playlist_item_id),
    );
    for (const [videoId, item] of seen) {
      if (
        unavailableVideoIds.has(videoId) &&
        !currentItemIds.has(item.playlist_item_id)
      ) {
        unavailable_items.push(item);
        removals.push({
          playlist_item_id: item.playlist_item_id,
          reason: "unavailable_video",
        });
        seen.delete(videoId);
      }
    }
    for (const item of allItems) {
      if (!item.video_id || unavailableVideoIds.has(item.video_id)) {
        unavailable_items.push(item);
        removals.push({
          playlist_item_id: item.playlist_item_id,
          reason: "unavailable_video",
        });
        if (item.video_id) seen.delete(item.video_id);
        continue;
      }
      const retained = seen.get(item.video_id);
      if (retained && retained.playlist_item_id !== item.playlist_item_id)
        removals.push({
          playlist_item_id: item.playlist_item_id,
          reason: "duplicate_video",
        });
      else if (!retained) seen.set(item.video_id, item);
    }
    const duplicate_groups = [...seen].flatMap(([video_id, retained]) => {
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
        ? [
            {
              video_id,
              retained_playlist_item_id: retained.playlist_item_id,
              removal_playlist_item_ids,
            },
          ]
        : [];
    });
    return {
      playlist,
      removals,
      duplicate_groups,
      unavailable_items,
      next_page_token: nextPageToken,
      next_cursor: nextPageToken
        ? createCleanupCursor(
            playlist.id,
            nextPageToken,
            new Map(
              [...seen].map(([videoId, item]) => [
                videoId,
                item.playlist_item_id,
              ]),
            ),
          )
        : undefined,
      fetched_count: fetchedCount,
      searched_pages: searchedPages,
      max_pages: input.maxPages,
      complete: !nextPageToken,
    };
  }

  /**
   * Executes an already reviewed cleanup selection. Validation happens before
   * the first delete so stale IDs cannot turn a partially changed playlist into
   * a surprise bulk operation.
   */
  async applyPlaylistCleanup(input: {
    url: string;
    removals: Array<{
      playlist_item_id: string;
      reason: "duplicate_video" | "unavailable_video";
    }>;
  }): Promise<YoutubePlaylistCleanupApplyResult> {
    const playlist = await this.getOwnedPlaylist(input.url);
    const requestedIds = input.removals.map(
      (removal) => removal.playlist_item_id,
    );
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new YoutubeMcpError(
        "Each cleanup removal must name a playlist item only once.",
        "playlist_cleanup_stale",
      );
    }
    if (
      !(await this.cleanupItemsStillBelongToPlaylist(playlist.id, requestedIds))
    ) {
      throw new YoutubeMcpError(
        "The cleanup plan contains an item that is no longer in this owned playlist.",
        "playlist_cleanup_stale",
      );
    }

    const removed_playlist_item_ids: string[] = [];
    for (const playlistItemId of requestedIds) {
      try {
        await this.deletePlaylistItem(playlist.id, playlistItemId);
        removed_playlist_item_ids.push(playlistItemId);
      } catch (error) {
        const stillExists = await this.playlistItemStillExists(
          playlist.id,
          playlistItemId,
        );
        const observedPlaylist = await this.observeCleanupPlaylist(playlist);
        return {
          ...observedPlaylist,
          removed_playlist_item_ids,
          remaining_playlist_item_ids: stillExists
            ? requestedIds.slice(removed_playlist_item_ids.length)
            : requestedIds.slice(removed_playlist_item_ids.length + 1),
          indeterminate_playlist_item_ids: stillExists ? [] : [playlistItemId],
          complete: false,
          failure: toWriteFailure("playlist_item_id", playlistItemId, error),
        };
      }
    }
    const observedPlaylist = await this.observeCleanupPlaylist(playlist);
    return {
      ...observedPlaylist,
      removed_playlist_item_ids,
      remaining_playlist_item_ids: [],
      indeterminate_playlist_item_ids: [],
      complete: true,
    };
  }

  /** Copies a caller-bounded source prefix and reports rather than hides skips or partial writes. */
  async clonePlaylist(input: {
    source_url: string;
    source_access: "public" | "owned";
    title?: string;
    description?: string;
    privacy_status: "private" | "unlisted" | "public";
    limit: number;
    maxPages: number;
  }): Promise<YoutubePlaylistCloneResult> {
    const source = await this.readCloneSource(input);
    const sourceVideoIds = source.items.flatMap((item) =>
      item.video_id ? [item.video_id] : [],
    );
    const unavailableVideoIds =
      input.source_access === "public"
        ? await this.getPublicUnavailableVideoIds(sourceVideoIds)
        : await this.getUnavailableVideoIds(sourceVideoIds);
    const skipped_items: YoutubePlaylistCloneResult["skipped_items"] = [];
    const copyable = source.items.filter((item) => {
      if (!item.video_id) {
        skipped_items.push({
          playlist_item_id: item.playlist_item_id,
          reason: "missing_video_id",
        });
        return false;
      }
      if (unavailableVideoIds.has(item.video_id)) {
        skipped_items.push({
          playlist_item_id: item.playlist_item_id,
          video_id: item.video_id,
          reason: "unavailable_video",
        });
        return false;
      }
      return true;
    });
    if (copyable.length === 0) {
      return clonePreflightFailure({
        sourcePlaylist: source.playlist,
        fetchedCount: source.fetchedCount,
        searchedPages: source.searchedPages,
        nextPageToken: source.nextPageToken,
        skippedItems: skipped_items,
        maxPages: input.maxPages,
      });
    }

    let playlist: YoutubePlaylist;
    try {
      playlist = await this.createPlaylist({
        title: input.title || deriveCloneTitle(source.playlist.title),
        description: input.description ?? source.playlist.description,
        privacy_status: input.privacy_status,
      });
    } catch (error) {
      if (error instanceof PlaylistCreationVerificationError) {
        return cloneCreationVerificationFailure({
          sourcePlaylist: source.playlist,
          fetchedCount: source.fetchedCount,
          searchedPages: source.searchedPages,
          nextPageToken: source.nextPageToken,
          playlist: error.playlist,
          remainingVideoIds: copyable.flatMap((item) =>
            item.video_id ? [item.video_id] : [],
          ),
          skippedItems: skipped_items,
          maxPages: input.maxPages,
          error,
        });
      }
      return cloneIndeterminateCreationFailure({
        sourcePlaylist: source.playlist,
        fetchedCount: source.fetchedCount,
        searchedPages: source.searchedPages,
        nextPageToken: source.nextPageToken,
        remainingVideoIds: copyable.flatMap((item) =>
          item.video_id ? [item.video_id] : [],
        ),
        skippedItems: skipped_items,
        maxPages: input.maxPages,
        error,
      });
    }
    const copied_items: YoutubePlaylistItem[] = [];
    for (let index = 0; index < copyable.length; index += 1) {
      const sourceItem = copyable[index]!;
      try {
        copied_items.push(
          await this.addVideoToPlaylist(playlist, sourceItem.video_id!),
        );
      } catch (error) {
        return {
          source_playlist: source.playlist,
          playlist,
          copied_items,
          remaining_video_ids: copyable
            .slice(index + 1)
            .flatMap((item) => (item.video_id ? [item.video_id] : [])),
          indeterminate_video_ids: [sourceItem.video_id!],
          skipped_items,
          fetched_count: source.fetchedCount,
          searched_pages: source.searchedPages,
          max_pages: input.maxPages,
          complete: false,
          remaining_source_page_token: source.nextPageToken,
          failure: toWriteFailure("video_id", sourceItem.video_id!, error),
        };
      }
    }
    let observedPlaylist: YoutubePlaylist;
    try {
      observedPlaylist = await this.getPlaylistById(playlist.id);
    } catch (error) {
      return cloneFinalVerificationFailure({
        sourcePlaylist: source.playlist,
        fetchedCount: source.fetchedCount,
        searchedPages: source.searchedPages,
        nextPageToken: source.nextPageToken,
        playlist,
        copiedItems: copied_items,
        skippedItems: skipped_items,
        maxPages: input.maxPages,
        error,
      });
    }
    if (
      observedPlaylist.item_count !== undefined &&
      observedPlaylist.item_count !== copied_items.length
    ) {
      return cloneFinalVerificationFailure({
        sourcePlaylist: source.playlist,
        fetchedCount: source.fetchedCount,
        searchedPages: source.searchedPages,
        nextPageToken: source.nextPageToken,
        playlist,
        copiedItems: copied_items,
        skippedItems: skipped_items,
        maxPages: input.maxPages,
        error: new YoutubeMcpError(
          "YouTube did not confirm the copied playlist item count.",
          "playlist_write_verification_failed",
        ),
      });
    }
    return {
      source_playlist: source.playlist,
      playlist: observedPlaylist,
      copied_items,
      skipped_items,
      fetched_count: source.fetchedCount,
      searched_pages: source.searchedPages,
      max_pages: input.maxPages,
      complete: !source.nextPageToken,
      remaining_source_page_token: source.nextPageToken,
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
    try {
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
    } catch (error) {
      throw new PlaylistCreationVerificationError(
        error,
        normalizePlaylist(response),
      );
    }
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
    return this.addVideoToPlaylist(playlist, video.videoId, input.position);
  }

  private async addVideoToPlaylist(
    playlist: YoutubePlaylist,
    videoId: string,
    position?: number,
  ): Promise<YoutubePlaylistItem> {
    const response =
      await this.requestClient.request<YoutubePlaylistItemResource>({
        method: "POST",
        path: "/playlistItems",
        query: new URLSearchParams({ part: "snippet,contentDetails" }),
        body: {
          snippet: {
            playlistId: playlist.id,
            resourceId: { kind: "youtube#video", videoId },
            ...(position !== undefined ? { position } : {}),
          },
        },
      });
    const observed = normalizePublicPlaylistItem(
      await this.getPlaylistItem(playlist.id, response.id),
    );
    if (
      observed.video_id !== videoId ||
      (position !== undefined && observed.position !== position)
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
    await this.deletePlaylistItem(playlist.id, input.playlistItemId);
    return { playlist_item_id: input.playlistItemId, removed: true };
  }

  private async deletePlaylistItem(
    playlistId: string,
    playlistItemId: string,
  ): Promise<void> {
    await this.getPlaylistItem(playlistId, playlistItemId);
    await this.requestClient.request({
      method: "DELETE",
      path: "/playlistItems",
      query: new URLSearchParams({ id: playlistItemId }),
    });
    const observed = await this.requestClient.request<PlaylistItemsResponse>({
      method: "GET",
      path: "/playlistItems",
      query: new URLSearchParams({ part: "snippet", id: playlistItemId }),
    });
    if (observed.items?.length)
      throw new YoutubeMcpError(
        "YouTube did not confirm playlist item removal.",
        "playlist_write_verification_failed",
      );
  }

  /** A failed delete verification is ambiguous until a separate read proves the item remains. */
  private async playlistItemStillExists(
    playlistId: string,
    playlistItemId: string,
  ): Promise<boolean> {
    try {
      await this.getPlaylistItem(playlistId, playlistItemId);
      return true;
    } catch {
      return false;
    }
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

  private async readCloneSource(input: {
    source_url: string;
    source_access: "public" | "owned";
    limit: number;
    maxPages: number;
  }): Promise<{
    playlist: YoutubePlaylist;
    items: YoutubePlaylistItem[];
    fetchedCount: number;
    searchedPages: number;
    nextPageToken?: string;
  }> {
    let pageToken: string | undefined;
    let playlist: YoutubePlaylist | undefined;
    const items: YoutubePlaylistItem[] = [];
    let fetchedCount = 0;
    let searchedPages = 0;
    do {
      const page =
        input.source_access === "owned"
          ? await this.getOwnedPlaylistItems({
              url: input.source_url,
              limit: input.limit,
              pageToken,
            })
          : await this.getPublicCloneSourcePage({
              url: input.source_url,
              limit: input.limit,
              pageToken,
            });
      playlist = page.playlist;
      items.push(...page.items);
      fetchedCount += page.fetched_count;
      searchedPages += 1;
      pageToken = page.next_page_token;
    } while (pageToken && searchedPages < input.maxPages);
    if (!playlist) {
      throw new YoutubeMcpError(
        "The source playlist has no readable items.",
        "playlist_not_found",
      );
    }
    return {
      playlist,
      items,
      fetchedCount,
      searchedPages,
      nextPageToken: pageToken,
    };
  }

  private async getPublicCloneSourcePage(input: {
    url: string;
    limit: number;
    pageToken?: string;
  }): Promise<YoutubePlaylistItemPage> {
    if (!this.publicClient) {
      throw new YoutubeMcpError(
        "Public playlist cloning is unavailable in this server configuration.",
        "playlist_clone_unavailable",
      );
    }
    return this.publicClient.getPlaylistItems(input);
  }

  private async getPublicUnavailableVideoIds(
    videoIds: string[],
  ): Promise<Set<string>> {
    if (!this.publicClient) {
      throw new YoutubeMcpError(
        "Public playlist cloning is unavailable in this server configuration.",
        "playlist_clone_unavailable",
      );
    }
    return this.publicClient.getUnavailableVideoIds(videoIds);
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

  private async observeCleanupPlaylist(
    playlist: YoutubePlaylist,
  ): Promise<
    Pick<
      YoutubePlaylistCleanupApplyResult,
      "playlist" | "metadata_verification"
    >
  > {
    try {
      return { playlist: await this.getPlaylistById(playlist.id) };
    } catch (error) {
      return {
        playlist,
        metadata_verification: {
          code:
            error instanceof YoutubeMcpError
              ? error.code
              : "playlist_write_failed",
          message:
            error instanceof Error
              ? error.message
              : "YouTube playlist metadata verification failed.",
        },
      };
    }
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
        query: new URLSearchParams({
          part: "id",
          id: batch.join(","),
          maxResults: String(batch.length),
        }),
      });
      for (const video of response.items || []) availableVideoIds.add(video.id);
    }
    return new Set(
      uniqueVideoIds.filter((videoId) => !availableVideoIds.has(videoId)),
    );
  }

  private async cleanupItemsStillBelongToPlaylist(
    playlistId: string,
    playlistItemIds: string[],
  ): Promise<boolean> {
    const found = new Set<string>();
    for (let index = 0; index < playlistItemIds.length; index += 50) {
      const batch = playlistItemIds.slice(index, index + 50);
      const response = await this.requestClient.request<PlaylistItemsResponse>({
        method: "GET",
        path: "/playlistItems",
        query: new URLSearchParams({
          part: "snippet",
          id: batch.join(","),
          maxResults: String(batch.length),
        }),
      });
      for (const item of response.items || []) {
        if (item.snippet.playlistId === playlistId) found.add(item.id);
      }
    }
    return playlistItemIds.every((playlistItemId) => found.has(playlistItemId));
  }

  private async getValidatedRetainedItems(
    playlistId: string,
    retained: Array<[string, string]>,
  ): Promise<Map<string, YoutubePlaylistItem>> {
    const expectedVideoIdsByItemId = new Map(
      retained.map(([videoId, playlistItemId]) => [playlistItemId, videoId]),
    );
    const validated = new Map<string, YoutubePlaylistItem>();
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
          validated.set(videoId, normalizePublicPlaylistItem(item));
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

function toWriteFailure<T extends "playlist_item_id" | "video_id">(
  field: T,
  identifier: string,
  error: unknown,
): Record<T, string> & { code: string; message: string } {
  return {
    [field]: identifier,
    code:
      error instanceof YoutubeMcpError ? error.code : "playlist_write_failed",
    message:
      error instanceof Error
        ? error.message
        : "YouTube playlist mutation failed.",
  } as Record<T, string> & { code: string; message: string };
}

function deriveCloneTitle(sourceTitle: string): string {
  const prefix = "Copy of ";
  const sourceLimit = 150 - prefix.length;
  let title = "";
  for (const character of sourceTitle) {
    if (title.length + character.length > sourceLimit) break;
    title += character;
  }
  return `${prefix}${title}`;
}

function cloneFinalVerificationFailure(input: {
  sourcePlaylist: YoutubePlaylist;
  fetchedCount: number;
  searchedPages: number;
  nextPageToken?: string;
  playlist: YoutubePlaylist;
  copiedItems: YoutubePlaylistItem[];
  skippedItems: YoutubePlaylistCloneResult["skipped_items"];
  maxPages: number;
  error: unknown;
}): YoutubePlaylistCloneResult {
  return {
    source_playlist: input.sourcePlaylist,
    playlist: input.playlist,
    copied_items: input.copiedItems,
    remaining_video_ids: [],
    indeterminate_video_ids: [],
    skipped_items: input.skippedItems,
    fetched_count: input.fetchedCount,
    searched_pages: input.searchedPages,
    max_pages: input.maxPages,
    complete: false,
    remaining_source_page_token: input.nextPageToken,
    failure: {
      stage: "target_playlist_verification",
      code:
        input.error instanceof YoutubeMcpError
          ? input.error.code
          : "playlist_write_failed",
      message:
        input.error instanceof Error
          ? input.error.message
          : "YouTube playlist verification failed.",
    },
  };
}

function clonePreflightFailure(input: {
  sourcePlaylist: YoutubePlaylist;
  fetchedCount: number;
  searchedPages: number;
  nextPageToken?: string;
  skippedItems: YoutubePlaylistCloneResult["skipped_items"];
  maxPages: number;
}): YoutubePlaylistCloneResult {
  return {
    source_playlist: input.sourcePlaylist,
    copied_items: [],
    remaining_video_ids: [],
    indeterminate_video_ids: [],
    skipped_items: input.skippedItems,
    fetched_count: input.fetchedCount,
    searched_pages: input.searchedPages,
    max_pages: input.maxPages,
    complete: false,
    remaining_source_page_token: input.nextPageToken,
    failure: {
      stage: "source_preflight",
      code: "playlist_clone_unavailable",
      message:
        "No readable public videos from the selected source pages can be copied.",
    },
  };
}

function cloneCreationVerificationFailure(input: {
  sourcePlaylist: YoutubePlaylist;
  fetchedCount: number;
  searchedPages: number;
  nextPageToken?: string;
  playlist: YoutubePlaylist;
  remainingVideoIds: string[];
  skippedItems: YoutubePlaylistCloneResult["skipped_items"];
  maxPages: number;
  error: unknown;
}): YoutubePlaylistCloneResult {
  return {
    source_playlist: input.sourcePlaylist,
    playlist: input.playlist,
    copied_items: [],
    remaining_video_ids: input.remainingVideoIds,
    indeterminate_video_ids: [],
    skipped_items: input.skippedItems,
    fetched_count: input.fetchedCount,
    searched_pages: input.searchedPages,
    max_pages: input.maxPages,
    complete: false,
    remaining_source_page_token: input.nextPageToken,
    failure: {
      stage: "playlist_creation_verification",
      code:
        input.error instanceof YoutubeMcpError
          ? input.error.code
          : "playlist_write_failed",
      message:
        input.error instanceof Error
          ? input.error.message
          : "YouTube playlist creation verification failed.",
    },
  };
}

function cloneIndeterminateCreationFailure(input: {
  sourcePlaylist: YoutubePlaylist;
  fetchedCount: number;
  searchedPages: number;
  nextPageToken?: string;
  remainingVideoIds: string[];
  skippedItems: YoutubePlaylistCloneResult["skipped_items"];
  maxPages: number;
  error: unknown;
}): YoutubePlaylistCloneResult {
  return {
    source_playlist: input.sourcePlaylist,
    copied_items: [],
    remaining_video_ids: input.remainingVideoIds,
    indeterminate_video_ids: [],
    skipped_items: input.skippedItems,
    fetched_count: input.fetchedCount,
    searched_pages: input.searchedPages,
    max_pages: input.maxPages,
    complete: false,
    remaining_source_page_token: input.nextPageToken,
    failure: {
      stage: "playlist_creation_indeterminate",
      code:
        input.error instanceof YoutubeMcpError
          ? input.error.code
          : "playlist_write_failed",
      message:
        input.error instanceof Error
          ? input.error.message
          : "YouTube playlist creation state is indeterminate.",
    },
  };
}
