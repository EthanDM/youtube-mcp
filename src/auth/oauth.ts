import { YoutubeAuthError } from "../errors.js";
import type { YoutubeOAuthConfig } from "../config.js";
import type { YoutubeTokens } from "./token-store.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** Encapsulates Google OAuth requests so the MCP transport stays non-interactive. */
export class YoutubeOAuthClient {
  constructor(
    private readonly config: YoutubeOAuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  createAuthorizeUrl(codeChallenge: string, state: string): string {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "consent",
    }).toString();
    return url.toString();
  }

  exchangeCode(code: string, codeVerifier: string): Promise<YoutubeTokens> {
    return this.requestTokens({
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: this.config.redirectUri,
    });
  }

  async refresh(refreshToken: string): Promise<YoutubeTokens> {
    return this.requestTokens(
      { grant_type: "refresh_token", refresh_token: refreshToken },
      refreshToken,
    );
  }

  async revoke(token: string): Promise<void> {
    const response = await this.fetchImpl(REVOCATION_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    if (!response.ok)
      throw new YoutubeAuthError(
        "Google could not revoke the OAuth token.",
        "auth_revoke_failed",
      );
  }

  private async requestTokens(
    fields: Record<string, string>,
    existingRefreshToken?: string,
  ): Promise<YoutubeTokens> {
    const response = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        ...(this.config.clientSecret
          ? { client_secret: this.config.clientSecret }
          : {}),
        ...fields,
      }),
    });
    let payload: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      payload = {};
    }
    if (!response.ok || !payload.access_token || !payload.expires_in) {
      throw new YoutubeAuthError(
        `Google OAuth token request failed${payload.error ? `: ${payload.error}` : "."}`,
        fields.grant_type === "refresh_token"
          ? "auth_refresh_failed"
          : "auth_code_exchange_failed",
      );
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || existingRefreshToken,
      expiresAt: Date.now() + payload.expires_in * 1_000,
    };
  }
}
