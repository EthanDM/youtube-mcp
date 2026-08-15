import { describe, expect, it, vi } from "vitest";

import { AuthenticatedYoutubeClient } from "../../src/lib/youtube-auth.js";
import { YoutubeAuthRequestClient } from "../../src/lib/youtube-auth-request-client.js";

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
        .mockResolvedValueOnce({
          items: [
            item("item-1", "video-1", "Deleted video", 0),
            item("item-2", "video-1", "A duplicate", 1),
            item("item-3", "missing-video", "Normal title", 2),
          ],
          nextPageToken: "page-2",
        })
        .mockResolvedValueOnce({ items: [{ id: "video-1" }] }),
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
  });
});
