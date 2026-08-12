import "dotenv/config";

import { getYoutubeConfig, getYoutubeOAuthConfig } from "./config.js";
import { YoutubeOAuthClient } from "./auth/oauth.js";
import { YoutubeTokenStore } from "./auth/token-store.js";
import { YoutubeApiError } from "./errors.js";
import { YoutubeClient } from "./lib/youtube.js";
import { TranscriptClient } from "./lib/transcript.js";
import { AuthenticatedYoutubeClient } from "./lib/youtube-auth.js";
import { YoutubeAuthRequestClient } from "./lib/youtube-auth-request-client.js";

const defaultSmokeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

async function main(): Promise<void> {
  const client = new YoutubeClient(getYoutubeConfig());
  const transcriptClient = new TranscriptClient(getYoutubeConfig().ytDlpPath);
  const videoUrl = process.env.YOUTUBE_SMOKE_URL?.trim() || defaultSmokeUrl;
  const video = await client.getVideo(videoUrl);
  if (!video.id || !video.title)
    throw new Error("Video smoke response was incomplete.");

  const commentsUrl =
    process.env.YOUTUBE_SMOKE_COMMENTS_URL?.trim() || videoUrl;
  try {
    const comments = await client.getComments({
      url: commentsUrl,
      limit: 1,
      order: "relevance",
      includeReplies: false,
    });
    if (!comments.video.id)
      throw new Error("Comment smoke response had no video ID.");
    console.log(
      `Smoke passed: ${video.title}; ${comments.fetched_count} comment thread(s).`,
    );
  } catch (error) {
    if (!process.env.YOUTUBE_SMOKE_COMMENTS_URL && isCommentsDisabled(error)) {
      console.log(
        `Smoke passed: ${video.title}; default video has comments disabled.`,
      );
    } else {
      throw error;
    }
  }

  const transcriptUrl = process.env.YOUTUBE_SMOKE_TRANSCRIPT_URL?.trim();
  if (transcriptUrl) {
    const transcript = await transcriptClient.getTranscript({
      url: transcriptUrl,
      maxSegments: 1,
    });
    if (transcript.transcript.returned_segments < 1) {
      throw new Error("Transcript smoke response had no caption segments.");
    }
    console.log("Transcript smoke passed.");
  }

  const ownedPlaylistUrl = process.env.YOUTUBE_SMOKE_OWNED_PLAYLIST_URL?.trim();
  if (ownedPlaylistUrl) {
    const oauthConfig = getYoutubeOAuthConfig();
    const ownedClient = new AuthenticatedYoutubeClient(
      new YoutubeAuthRequestClient(
        new YoutubeTokenStore(oauthConfig.tokenFile),
        new YoutubeOAuthClient(oauthConfig),
      ),
    );
    await ownedClient.getOwnedPlaylistItems({
      url: ownedPlaylistUrl,
      limit: 1,
    });
    console.log("Authenticated playlist smoke passed.");
  }
}

function isCommentsDisabled(error: unknown): boolean {
  return (
    error instanceof YoutubeApiError && error.reason === "commentsDisabled"
  );
}

await main();
