import "dotenv/config";
import http from "node:http";

import { getYoutubeOAuthConfig } from "../config.js";
import { YoutubeAuthError } from "../errors.js";
import { YoutubeOAuthClient } from "./oauth.js";
import { createPkceLogin } from "./pkce.js";
import { YoutubeTokenStore } from "./token-store.js";

/** Starts a one-time loopback PKCE login and persists the resulting local session. */
async function main(): Promise<void> {
  const config = getYoutubeOAuthConfig();
  const redirect = new URL(config.redirectUri);
  if (
    redirect.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(redirect.hostname)
  ) {
    throw new YoutubeAuthError(
      "YOUTUBE_REDIRECT_URI must use a local http callback such as http://127.0.0.1:8787/callback.",
      "auth_invalid_redirect_uri",
    );
  }
  const pkce = createPkceLogin();
  const oauth = new YoutubeOAuthClient(config);
  console.log(
    "Open this URL in your browser and approve YouTube playlist access:\n",
  );
  console.log(oauth.createAuthorizeUrl(pkce.codeChallenge, pkce.state));
  console.log(`\nWaiting for callback on ${config.redirectUri} ...`);
  const code = await waitForCode(redirect, pkce.state);
  await new YoutubeTokenStore(config.tokenFile).write(
    await oauth.exchangeCode(code, pkce.codeVerifier),
  );
  console.log(`Saved YouTube OAuth tokens to ${config.tokenFile}`);
}

function waitForCode(redirect: URL, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || "/", redirect.origin);
      if (requestUrl.pathname !== redirect.pathname) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }
      const state = requestUrl.searchParams.get("state");
      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      if (state !== expectedState) {
        response.statusCode = 400;
        response.end("Invalid state");
        server.close();
        reject(
          new YoutubeAuthError(
            "Google OAuth state mismatch.",
            "auth_state_mismatch",
          ),
        );
        return;
      }
      if (error || !code) {
        response.statusCode = 400;
        response.end(
          error
            ? `Authorization failed: ${error}`
            : "Missing authorization code",
        );
        server.close();
        reject(
          new YoutubeAuthError(
            error
              ? `Google OAuth authorization failed: ${error}`
              : "Google OAuth callback did not include a code.",
            error ? "auth_denied" : "auth_missing_code",
          ),
        );
        return;
      }
      response.end(
        "YouTube authorization complete. You can close this window.",
      );
      server.close();
      resolve(code);
    });
    server.on("error", reject);
    server.listen(Number(redirect.port || 80), redirect.hostname);
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
