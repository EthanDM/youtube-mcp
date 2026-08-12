import "dotenv/config";
import { getYoutubeOAuthConfig } from "../config.js";
import { YoutubeTokenStore } from "./token-store.js";

const tokens = await new YoutubeTokenStore(
  getYoutubeOAuthConfig().tokenFile,
).read();
if (!tokens) {
  console.log("Not logged in. Run pnpm auth:login.");
  process.exitCode = 1;
} else
  console.log(
    `Logged in; token ${tokens.expiresAt <= Date.now() ? "expired and will refresh on use" : "active"}.`,
  );
