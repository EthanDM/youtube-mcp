import "dotenv/config";
import { getYoutubeOAuthConfig } from "../config.js";
import { YoutubeOAuthClient } from "./oauth.js";
import { YoutubeTokenStore } from "./token-store.js";

const config = getYoutubeOAuthConfig();
const store = new YoutubeTokenStore(config.tokenFile);
const tokens = await store.read();
if (tokens) {
  try {
    await new YoutubeOAuthClient(config).revoke(
      tokens.refreshToken || tokens.accessToken,
    );
  } finally {
    await store.clear();
  }
}
console.log("YouTube OAuth session removed.");
