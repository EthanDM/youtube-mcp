import { describe, expect, it, vi } from "vitest";

import { AuthenticatedYoutubeClient } from "../../src/lib/youtube-auth.js";
import { YoutubeAuthRequestClient } from "../../src/lib/youtube-auth-request-client.js";
import { YoutubeMcpError } from "../../src/errors.js";

describe("AuthenticatedYoutubeClient", () => {
  it("rejects a non-owned playlist before a write", async () => {
    const request = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          items: [
            {
              id: "playlist-1",
              snippet: {
                title: "Other",
                channelId: "other-channel",
                channelTitle: "Other",
                publishedAt: "2020-01-01T00:00:00Z",
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          items: [
            {
              id: "my-channel",
              snippet: { title: "Mine", publishedAt: "2020-01-01T00:00:00Z" },
            },
          ],
        }),
    } as unknown as YoutubeAuthRequestClient;
    const client = new AuthenticatedYoutubeClient(request);

    await expect(
      client.addPlaylistVideo({
        url: "https://www.youtube.com/playlist?list=PL123456789",
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      }),
    ).rejects.toMatchObject({ code: "playlist_not_owned" });
    expect(request.request).toHaveBeenCalledTimes(2);
  });

  it("creates private playlists by default through the schema contract", async () => {
    const playlist = {
      id: "playlist-1",
      snippet: {
        title: "New",
        description: "A description",
        channelId: "my-channel",
        channelTitle: "Mine",
        publishedAt: "2020-01-01T00:00:00Z",
      },
      status: { privacyStatus: "private" },
    };
    const request = {
      request: vi
        .fn()
        .mockResolvedValueOnce(playlist)
        .mockResolvedValueOnce({ items: [playlist] }),
    } as unknown as YoutubeAuthRequestClient;
    const client = new AuthenticatedYoutubeClient(request);
    await client.createPlaylist({
      title: "New",
      description: "A description",
      privacy_status: "private",
    });
    expect(request.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ status: { privacyStatus: "private" } }),
      }),
    );
  });

  it("rejects an add when the observed position differs from the request", async () => {
    const playlist = {
      id: "playlist-1",
      snippet: {
        title: "Mine",
        channelId: "my-channel",
        channelTitle: "Mine",
        publishedAt: "2020-01-01T00:00:00Z",
      },
    };
    const request = {
      request: vi
        .fn()
        .mockResolvedValueOnce({ items: [playlist] })
        .mockResolvedValueOnce({
          items: [
            {
              id: "my-channel",
              snippet: { title: "Mine", publishedAt: "2020-01-01T00:00:00Z" },
            },
          ],
        })
        .mockResolvedValueOnce({ id: "item-1" })
        .mockResolvedValueOnce({
          items: [
            {
              id: "item-1",
              snippet: {
                playlistId: "playlist-1",
                title: "Video",
                channelTitle: "Creator",
                publishedAt: "2020-01-01T00:00:00Z",
                resourceId: { videoId: "dQw4w9WgXcQ" },
                position: 3,
              },
              contentDetails: { videoId: "dQw4w9WgXcQ" },
            },
          ],
        }),
    } as unknown as YoutubeAuthRequestClient;
    const client = new AuthenticatedYoutubeClient(request);

    await expect(
      client.addPlaylistVideo({
        url: "https://www.youtube.com/playlist?list=PL123456789",
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        position: 1,
      }),
    ).rejects.toMatchObject({ code: "playlist_write_verification_failed" });
  });

  it("rejects an update that does not preserve submitted metadata", async () => {
    const playlist = {
      id: "playlist-1",
      snippet: {
        title: "Old title",
        description: "Original description",
        channelId: "my-channel",
        channelTitle: "Mine",
        publishedAt: "2020-01-01T00:00:00Z",
      },
      status: { privacyStatus: "private" },
    };
    const request = {
      request: vi
        .fn()
        .mockResolvedValueOnce({ items: [playlist] })
        .mockResolvedValueOnce({
          items: [
            {
              id: "my-channel",
              snippet: { title: "Mine", publishedAt: "2020-01-01T00:00:00Z" },
            },
          ],
        })
        .mockResolvedValueOnce({ id: "playlist-1" })
        .mockResolvedValueOnce({
          items: [
            {
              ...playlist,
              snippet: {
                ...playlist.snippet,
                description: "Changed elsewhere",
              },
            },
          ],
        }),
    } as unknown as YoutubeAuthRequestClient;
    const client = new AuthenticatedYoutubeClient(request);

    await expect(
      client.updatePlaylist({
        url: "https://www.youtube.com/playlist?list=PL123456789",
        title: "New title",
      }),
    ).rejects.toMatchObject({ code: "playlist_write_verification_failed" });
  });

  it("plans cleanup from video availability metadata, not display titles", async () => {
    const playlist = {
      id: "playlist-1",
      snippet: {
        title: "Mine",
        channelId: "my-channel",
        channelTitle: "Mine",
        publishedAt: "2020-01-01T00:00:00Z",
      },
    };
    const item = (
      id: string,
      videoId: string,
      title: string,
      position: number,
    ) => ({
      id,
      snippet: {
        playlistId: "playlist-1",
        title,
        channelTitle: "Creator",
        publishedAt: "2020-01-01T00:00:00Z",
        resourceId: { videoId },
        position,
      },
      contentDetails: { videoId },
    });
    const requestMock = vi
      .fn()
      .mockResolvedValueOnce({ items: [playlist] })
      .mockResolvedValueOnce({
        items: [
          {
            id: "my-channel",
            snippet: { title: "Mine", publishedAt: "2020-01-01T00:00:00Z" },
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          item("item-1", "video-1", "Deleted video", 0),
          item("item-2", "video-1", "A duplicate", 1),
          item("item-3", "missing-video", "Normal title", 2),
        ],
        nextPageToken: "page-2",
      })
      .mockResolvedValueOnce({ items: [{ id: "video-1" }] });
    const request = {
      request: requestMock,
    } as unknown as YoutubeAuthRequestClient;
    const client = new AuthenticatedYoutubeClient(request);

    const plan = await client.planPlaylistCleanup({
      url: "https://www.youtube.com/playlist?list=PL123456789",
      limit: 50,
      maxPages: 1,
    });

    expect(plan.removals).toEqual([
      { playlist_item_id: "item-2", reason: "duplicate_video" },
      { playlist_item_id: "item-3", reason: "unavailable_video" },
    ]);
    expect(plan.unavailable_items).toEqual([
      expect.objectContaining({ playlist_item_id: "item-3" }),
    ]);
    expect(plan.next_cursor).toEqual(expect.any(String));
    const availabilityRequest = requestMock.mock.calls
      .map(([request]) => request)
      .find((request) => request.path === "/videos");
    expect(availabilityRequest?.query.get("maxResults")).toBe("2");

    const continuationRequestMock = vi
      .fn()
      .mockResolvedValueOnce({ items: [playlist] })
      .mockResolvedValueOnce({
        items: [
          {
            id: "my-channel",
            snippet: { title: "Mine", publishedAt: "2020-01-01T00:00:00Z" },
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [item("item-1", "video-1", "Deleted video", 0)],
      })
      .mockResolvedValueOnce({
        items: [item("item-4", "video-1", "Later duplicate", 3)],
      })
      .mockResolvedValueOnce({ items: [{ id: "video-1" }] });
    const continuationRequest = {
      request: continuationRequestMock,
    } as unknown as YoutubeAuthRequestClient;
    const continuationClient = new AuthenticatedYoutubeClient(
      continuationRequest,
    );
    const continuation = await continuationClient.planPlaylistCleanup({
      url: "https://www.youtube.com/playlist?list=PL123456789",
      cursor: plan.next_cursor,
      limit: 50,
      maxPages: 5,
    });

    expect(continuation.removals).toEqual([
      { playlist_item_id: "item-4", reason: "duplicate_video" },
    ]);
    const playlistItemsRequest = continuationRequestMock.mock.calls
      .map(([request]) => request)
      .find(
        (request) =>
          request.path === "/playlistItems" &&
          request.query.get("pageToken") === "page-2",
      );
    expect(playlistItemsRequest?.query.get("pageToken")).toBe("page-2");
    const retainedItemsRequest = continuationRequestMock.mock.calls
      .map(([request]) => request)
      .find(
        (request) =>
          request.path === "/playlistItems" &&
          request.query.get("id") === "item-1",
      );
    expect(retainedItemsRequest?.query.get("maxResults")).toBe("1");

    const staleCursorRequest = {
      request: vi
        .fn()
        .mockResolvedValueOnce({ items: [playlist] })
        .mockResolvedValueOnce({
          items: [
            {
              id: "my-channel",
              snippet: { title: "Mine", publishedAt: "2020-01-01T00:00:00Z" },
            },
          ],
        })
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({
          items: [item("item-4", "video-1", "Only remaining copy", 3)],
        })
        .mockResolvedValueOnce({ items: [{ id: "video-1" }] }),
    } as unknown as YoutubeAuthRequestClient;
    const staleCursorClient = new AuthenticatedYoutubeClient(
      staleCursorRequest,
    );
    const staleCursorPlan = await staleCursorClient.planPlaylistCleanup({
      url: "https://www.youtube.com/playlist?list=PL123456789",
      cursor: plan.next_cursor,
      limit: 50,
      maxPages: 5,
    });
    expect(staleCursorPlan.removals).toEqual([]);

    const reappearingItemRequest = {
      request: vi
        .fn()
        .mockResolvedValueOnce({ items: [playlist] })
        .mockResolvedValueOnce({
          items: [
            {
              id: "my-channel",
              snippet: { title: "Mine", publishedAt: "2020-01-01T00:00:00Z" },
            },
          ],
        })
        .mockResolvedValueOnce({
          items: [item("item-1", "video-1", "Deleted video", 3)],
        })
        .mockResolvedValueOnce({
          items: [item("item-1", "video-1", "Deleted video", 3)],
        })
        .mockResolvedValueOnce({ items: [{ id: "video-1" }] }),
    } as unknown as YoutubeAuthRequestClient;
    const reappearingItemClient = new AuthenticatedYoutubeClient(
      reappearingItemRequest,
    );
    const reappearingItemPlan = await reappearingItemClient.planPlaylistCleanup(
      {
        url: "https://www.youtube.com/playlist?list=PL123456789",
        cursor: plan.next_cursor,
        limit: 50,
        maxPages: 5,
      },
    );
    expect(reappearingItemPlan.removals).toEqual([]);

    const retainedUnavailableRequest = {
      request: vi
        .fn()
        .mockResolvedValueOnce({ items: [playlist] })
        .mockResolvedValueOnce({
          items: [
            {
              id: "my-channel",
              snippet: { title: "Mine", publishedAt: "2020-01-01T00:00:00Z" },
            },
          ],
        })
        .mockResolvedValueOnce({
          items: [item("item-1", "video-1", "Original", 0)],
        })
        .mockResolvedValueOnce({
          items: [item("item-4", "video-2", "Current", 3)],
          nextPageToken: "page-3",
        })
        .mockResolvedValueOnce({ items: [{ id: "video-2" }] }),
    } as unknown as YoutubeAuthRequestClient;
    const retainedUnavailableClient = new AuthenticatedYoutubeClient(
      retainedUnavailableRequest,
    );
    const retainedUnavailablePlan =
      await retainedUnavailableClient.planPlaylistCleanup({
        url: "https://www.youtube.com/playlist?list=PL123456789",
        cursor: plan.next_cursor,
        limit: 50,
        maxPages: 1,
      });
    expect(retainedUnavailablePlan.removals).toEqual([
      { playlist_item_id: "item-1", reason: "unavailable_video" },
    ]);
    expect(retainedUnavailablePlan.unavailable_items).toEqual([
      expect.objectContaining({ playlist_item_id: "item-1" }),
    ]);
    const continuedCursor = JSON.parse(
      Buffer.from(retainedUnavailablePlan.next_cursor!, "base64url").toString(
        "utf8",
      ),
    );
    expect(continuedCursor.retained).toEqual([["video-2", "item-4"]]);
  });

  it("preflights every cleanup item before deleting and reports a stopped partial run", async () => {
    const playlist = playlistResource("playlist-1", "Mine");
    const requestMock = vi
      .fn()
      .mockResolvedValueOnce({ items: [playlist] })
      .mockResolvedValueOnce(channelResponse())
      .mockResolvedValueOnce({
        items: [playlistItemResource("item-1", "video-1", 0)],
      })
      .mockResolvedValueOnce({
        items: [playlistItemResource("item-2", "video-2", 1)],
      })
      .mockResolvedValueOnce({
        items: [playlistItemResource("item-1", "video-1", 0)],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ items: [] })
      .mockRejectedValueOnce(
        new YoutubeMcpError(
          "YouTube rejected the deletion.",
          "youtube_api_error",
        ),
      )
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [
          {
            ...playlist,
            contentDetails: { itemCount: 1 },
          },
        ],
      });
    const client = new AuthenticatedYoutubeClient({
      request: requestMock,
    } as unknown as YoutubeAuthRequestClient);

    await expect(
      client.applyPlaylistCleanup({
        url: playlistUrl,
        removals: [
          { playlist_item_id: "item-1", reason: "duplicate_video" },
          { playlist_item_id: "item-2", reason: "unavailable_video" },
        ],
      }),
    ).resolves.toMatchObject({
      removed_playlist_item_ids: ["item-1"],
      remaining_playlist_item_ids: [],
      indeterminate_playlist_item_ids: ["item-2"],
      complete: false,
      failure: { playlist_item_id: "item-2", code: "youtube_api_error" },
    });
  });

  it("rejects a stale cleanup plan before any deletion", async () => {
    const requestMock = vi
      .fn()
      .mockResolvedValueOnce({
        items: [playlistResource("playlist-1", "Mine")],
      })
      .mockResolvedValueOnce(channelResponse())
      .mockResolvedValueOnce({ items: [] });
    const client = new AuthenticatedYoutubeClient({
      request: requestMock,
    } as unknown as YoutubeAuthRequestClient);

    await expect(
      client.applyPlaylistCleanup({
        url: playlistUrl,
        removals: [{ playlist_item_id: "missing", reason: "duplicate_video" }],
      }),
    ).rejects.toMatchObject({ code: "playlist_cleanup_stale" });
    expect(
      requestMock.mock.calls.some(([request]) => request.method === "DELETE"),
    ).toBe(false);
  });

  it("clones a bounded public source in order, retaining duplicate videos", async () => {
    const sourceItems = [
      publicItem("source-1", "video-1", 0),
      publicItem("source-2", "video-1", 1),
    ];
    const publicClient = {
      getPlaylistItems: vi.fn().mockResolvedValue({
        playlist: normalizedPlaylist("source", "Source"),
        items: sourceItems,
        fetched_count: 2,
        next_page_token: "later",
      }),
    };
    const target = {
      ...playlistResource("target", "Copy of Source"),
      contentDetails: { itemCount: 2 },
    };
    const requestMock = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "video-1" }] })
      .mockResolvedValueOnce({ id: "target" })
      .mockResolvedValueOnce({ items: [target] })
      .mockResolvedValueOnce({ id: "copy-1" })
      .mockResolvedValueOnce({
        items: [playlistItemResource("copy-1", "video-1", 0, "target")],
      })
      .mockResolvedValueOnce({ id: "copy-2" })
      .mockResolvedValueOnce({
        items: [playlistItemResource("copy-2", "video-1", 1, "target")],
      })
      .mockResolvedValueOnce({ items: [target] });
    const client = new AuthenticatedYoutubeClient(
      { request: requestMock } as unknown as YoutubeAuthRequestClient,
      publicClient,
    );

    const result = await client.clonePlaylist({
      source_url: playlistUrl,
      source_access: "public",
      privacy_status: "private",
      limit: 50,
      maxPages: 1,
    });

    expect(result).toMatchObject({
      playlist: { title: "Copy of Source" },
      copied_items: [
        { playlist_item_id: "copy-1", video_id: "video-1", position: 0 },
        { playlist_item_id: "copy-2", video_id: "video-1", position: 1 },
      ],
      complete: false,
      remaining_source_page_token: "later",
    });
    expect(publicClient.getPlaylistItems).toHaveBeenCalledWith({
      url: playlistUrl,
      limit: 50,
      pageToken: undefined,
    });
  });

  it("skips unavailable source videos before creating a clone", async () => {
    const publicClient = {
      getPlaylistItems: vi.fn().mockResolvedValue({
        playlist: normalizedPlaylist("source", "Source"),
        items: [publicItem("source-1", "missing", 0)],
        fetched_count: 1,
      }),
    };
    const requestMock = vi.fn().mockResolvedValueOnce({ items: [] });
    const client = new AuthenticatedYoutubeClient(
      { request: requestMock } as unknown as YoutubeAuthRequestClient,
      publicClient,
    );

    await expect(
      client.clonePlaylist({
        source_url: playlistUrl,
        source_access: "public",
        privacy_status: "private",
        limit: 50,
        maxPages: 1,
      }),
    ).rejects.toMatchObject({ code: "playlist_clone_unavailable" });
    expect(
      requestMock.mock.calls.some(([request]) => request.method === "POST"),
    ).toBe(false);
  });

  it("marks an unverified clone insertion as indeterminate", async () => {
    const publicClient = {
      getPlaylistItems: vi.fn().mockResolvedValue({
        playlist: normalizedPlaylist("source", "Source"),
        items: [
          publicItem("source-1", "video-1", 0),
          publicItem("source-2", "video-2", 1),
          publicItem("source-3", "video-3", 2),
        ],
        fetched_count: 3,
      }),
    };
    const target = playlistResource("target", "Copy of Source");
    const requestMock = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ id: "video-1" }, { id: "video-2" }, { id: "video-3" }],
      })
      .mockResolvedValueOnce({ id: "target" })
      .mockResolvedValueOnce({ items: [target] })
      .mockResolvedValueOnce({ id: "copy-1" })
      .mockResolvedValueOnce({
        items: [playlistItemResource("copy-1", "video-1", 0, "target")],
      })
      .mockResolvedValueOnce({ id: "copy-2" })
      .mockRejectedValueOnce(
        new YoutubeMcpError(
          "YouTube could not verify the insertion.",
          "playlist_write_verification_failed",
        ),
      );
    const client = new AuthenticatedYoutubeClient(
      { request: requestMock } as unknown as YoutubeAuthRequestClient,
      publicClient,
    );

    await expect(
      client.clonePlaylist({
        source_url: playlistUrl,
        source_access: "public",
        privacy_status: "private",
        limit: 50,
        maxPages: 1,
      }),
    ).resolves.toMatchObject({
      copied_items: [{ playlist_item_id: "copy-1", video_id: "video-1" }],
      indeterminate_video_ids: ["video-2"],
      remaining_video_ids: ["video-3"],
      complete: false,
      failure: {
        video_id: "video-2",
        code: "playlist_write_verification_failed",
      },
    });
  });

  it("retains a fully copied target when final clone verification fails", async () => {
    const publicClient = {
      getPlaylistItems: vi.fn().mockResolvedValue({
        playlist: normalizedPlaylist("source", "Source"),
        items: [publicItem("source-1", "video-1", 0)],
        fetched_count: 1,
      }),
    };
    const target = playlistResource("target", "Copy of Source");
    const requestMock = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "video-1" }] })
      .mockResolvedValueOnce({ id: "target" })
      .mockResolvedValueOnce({ items: [target] })
      .mockResolvedValueOnce({ id: "copy-1" })
      .mockResolvedValueOnce({
        items: [playlistItemResource("copy-1", "video-1", 0, "target")],
      })
      .mockRejectedValueOnce(
        new YoutubeMcpError(
          "YouTube could not verify the copied playlist.",
          "youtube_api_error",
        ),
      );
    const client = new AuthenticatedYoutubeClient(
      { request: requestMock } as unknown as YoutubeAuthRequestClient,
      publicClient,
    );

    await expect(
      client.clonePlaylist({
        source_url: playlistUrl,
        source_access: "public",
        privacy_status: "private",
        limit: 50,
        maxPages: 1,
      }),
    ).resolves.toMatchObject({
      playlist: { id: "target" },
      copied_items: [{ playlist_item_id: "copy-1", video_id: "video-1" }],
      remaining_video_ids: [],
      indeterminate_video_ids: [],
      complete: false,
      failure: {
        stage: "target_playlist_verification",
        code: "youtube_api_error",
      },
    });
  });

  it("bounds a generated clone title to YouTube's playlist limit", async () => {
    const sourceTitle = "x".repeat(150);
    const publicClient = {
      getPlaylistItems: vi.fn().mockResolvedValue({
        playlist: normalizedPlaylist("source", sourceTitle),
        items: [publicItem("source-1", "video-1", 0)],
        fetched_count: 1,
      }),
    };
    const target = playlistResource("target", `Copy of ${"x".repeat(142)}`);
    const requestMock = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "video-1" }] })
      .mockResolvedValueOnce({ id: "target" })
      .mockResolvedValueOnce({ items: [target] })
      .mockResolvedValueOnce({ id: "copy-1" })
      .mockResolvedValueOnce({
        items: [playlistItemResource("copy-1", "video-1", 0, "target")],
      })
      .mockResolvedValueOnce({ items: [target] });
    const client = new AuthenticatedYoutubeClient(
      { request: requestMock } as unknown as YoutubeAuthRequestClient,
      publicClient,
    );

    await client.clonePlaylist({
      source_url: playlistUrl,
      source_access: "public",
      privacy_status: "private",
      limit: 50,
      maxPages: 1,
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          snippet: expect.objectContaining({
            title: `Copy of ${"x".repeat(142)}`,
          }),
        }),
      }),
    );
  });
});

const playlistUrl = "https://www.youtube.com/playlist?list=PL123456789";

function channelResponse() {
  return {
    items: [
      {
        id: "my-channel",
        snippet: { title: "Mine", publishedAt: "2020-01-01T00:00:00Z" },
      },
    ],
  };
}

function playlistResource(id: string, title: string) {
  return {
    id,
    snippet: {
      title,
      description: "",
      channelId: "my-channel",
      channelTitle: "Mine",
      publishedAt: "2020-01-01T00:00:00Z",
    },
    status: { privacyStatus: "private" },
  };
}

function playlistItemResource(
  id: string,
  videoId: string,
  position: number,
  playlistId = "playlist-1",
) {
  return {
    id,
    snippet: {
      playlistId,
      title: "Video",
      channelTitle: "Creator",
      publishedAt: "2020-01-01T00:00:00Z",
      resourceId: { videoId },
      position,
    },
    contentDetails: { videoId },
  };
}

function publicItem(id: string, videoId: string, position: number) {
  return {
    playlist_item_id: id,
    video_id: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: "Video",
    description: "",
    published_at: "2020-01-01T00:00:00Z",
    position,
    thumbnails: {},
  };
}

function normalizedPlaylist(id: string, title: string) {
  return {
    id,
    url: `https://www.youtube.com/playlist?list=${id}`,
    title,
    description: "",
    channel_id: "source-channel",
    channel_name: "Source",
    published_at: "2020-01-01T00:00:00Z",
    thumbnails: {},
  };
}
