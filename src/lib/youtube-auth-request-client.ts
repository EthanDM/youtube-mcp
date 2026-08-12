import { YOUTUBE_API_BASE_URL } from "../config.js";
import { YoutubeApiError, YoutubeAuthError } from "../errors.js";
import { YoutubeOAuthClient } from "../auth/oauth.js";
import type {
  YoutubeTokenStoreLike,
  YoutubeTokens,
} from "../auth/token-store.js";

/** Performs authenticated YouTube API requests and refreshes local tokens when needed. */
export class YoutubeAuthRequestClient {
  constructor(
    private readonly tokenStore: YoutubeTokenStoreLike,
    private readonly oauthClient: YoutubeOAuthClient,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  async request<T>(input: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    query?: URLSearchParams;
    body?: Record<string, unknown>;
  }): Promise<T> {
    let tokens = await this.getUsableTokens();
    let response = await this.send(input, tokens.accessToken);
    if (response.status === 401) {
      tokens = await this.refresh(tokens);
      response = await this.send(input, tokens.accessToken);
    }
    if (!response.ok) throw await readYoutubeError(response);
    if (response.status === 204) return {} as T;
    return (await response.json()) as T;
  }

  private async getUsableTokens(): Promise<YoutubeTokens> {
    const tokens = await this.tokenStore.read();
    if (!tokens) {
      throw new YoutubeAuthError(
        "Run pnpm auth:login before using authenticated playlist tools.",
        "auth_not_logged_in",
      );
    }
    return tokens.expiresAt <= Date.now() + 60_000
      ? this.refresh(tokens)
      : tokens;
  }

  private async refresh(tokens: YoutubeTokens): Promise<YoutubeTokens> {
    if (!tokens.refreshToken) {
      throw new YoutubeAuthError(
        "The stored OAuth session cannot be refreshed. Run pnpm auth:login again.",
        "auth_refresh_missing",
      );
    }
    const refreshed = await this.oauthClient.refresh(tokens.refreshToken);
    await this.tokenStore.write(refreshed);
    return refreshed;
  }

  private async send(
    input: {
      method: string;
      path: string;
      query?: URLSearchParams;
      body?: Record<string, unknown>;
    },
    accessToken: string,
  ): Promise<Response> {
    const query = input.query?.toString();
    return this.fetchImpl(
      `${YOUTUBE_API_BASE_URL}${input.path}${query ? `?${query}` : ""}`,
      {
        method: input.method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(input.body ? { "content-type": "application/json" } : {}),
        },
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
  }
}

async function readYoutubeError(response: Response): Promise<YoutubeApiError> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    return new YoutubeApiError(
      payload.error?.message ||
        `YouTube API request failed with status ${response.status}.`,
      response.status,
      payload.error?.errors?.[0]?.reason,
    );
  } catch {
    return new YoutubeApiError(
      `YouTube API request failed with status ${response.status}.`,
      response.status,
    );
  }
}
