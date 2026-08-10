import { YOUTUBE_API_BASE_URL, type YoutubeConfig } from "../config.js";
import { YoutubeApiError } from "../errors.js";

export type FetchLike = typeof fetch;

/** Owns authentication, timeouts, HTTP errors, and bounded retry behavior. */
export class YoutubeRequestClient {
  constructor(
    private readonly config: YoutubeConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  /** Executes a GET request. No mutation method exists by design. */
  async get<T>(
    path: string,
    query: URLSearchParams = new URLSearchParams(),
    retriesRemaining = 2,
  ): Promise<T> {
    query.set("key", this.config.apiKey);
    const response = await this.fetchImpl(
      `${YOUTUBE_API_BASE_URL}${path}?${query}`,
      {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (shouldRetry(response.status) && retriesRemaining > 0) {
      await delay(readRetryAfter(response) ?? 1_000);
      return this.get(path, query, retriesRemaining - 1);
    }

    if (!response.ok) throw await readYoutubeError(response);
    return (await response.json()) as T;
  }
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

async function readYoutubeError(response: Response): Promise<YoutubeApiError> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    const message =
      payload.error?.message ||
      `YouTube API request failed with status ${response.status}.`;
    return new YoutubeApiError(
      message,
      response.status,
      payload.error?.errors?.[0]?.reason,
      readRetryAfter(response),
    );
  } catch {
    return new YoutubeApiError(
      `YouTube API request failed with status ${response.status}.`,
      response.status,
      undefined,
      readRetryAfter(response),
    );
  }
}

function readRetryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt)
    ? Math.max(0, retryAt - Date.now())
    : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
