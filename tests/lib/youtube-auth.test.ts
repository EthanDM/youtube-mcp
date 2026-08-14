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
    await client.createPlaylist({ title: "New", privacy_status: "private" });
    expect(request.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ status: { privacyStatus: "private" } }),
      }),
    );
  });
});
