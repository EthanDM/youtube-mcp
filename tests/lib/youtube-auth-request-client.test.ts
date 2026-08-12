import { describe, expect, it, vi } from "vitest";

import { YoutubeOAuthClient } from "../../src/auth/oauth.js";
import type { YoutubeTokenStoreLike } from "../../src/auth/token-store.js";
import type { YoutubeOAuthConfig } from "../../src/config.js";
import { YoutubeAuthRequestClient } from "../../src/lib/youtube-auth-request-client.js";

const config: YoutubeOAuthConfig = {
  clientId: "client",
  redirectUri: "http://127.0.0.1:8787/callback",
  tokenFile: "/tmp/tokens.json",
};

describe("YoutubeAuthRequestClient", () => {
  it("refreshes an expired token before the authenticated request", async () => {
    const store = tokenStore({
      accessToken: "old",
      refreshToken: "refresh",
      expiresAt: 0,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "new", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ ok: true }));
    const client = new YoutubeAuthRequestClient(
      store,
      new YoutubeOAuthClient(config, fetchMock as typeof fetch),
      fetchMock as typeof fetch,
    );

    await expect(
      client.request<{ ok: boolean }>({ method: "GET", path: "/channels" }),
    ).resolves.toEqual({ ok: true });
    expect(store.write).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "new", refreshToken: "refresh" }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers.authorization).toBe(
      "Bearer new",
    );
  });

  it("refreshes and retries once after a 401", async () => {
    const store = tokenStore({
      accessToken: "old",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3_600_000,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(json({ access_token: "new", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ ok: true }));
    const client = new YoutubeAuthRequestClient(
      store,
      new YoutubeOAuthClient(config, fetchMock as typeof fetch),
      fetchMock as typeof fetch,
    );

    await expect(
      client.request<{ ok: boolean }>({ method: "GET", path: "/channels" }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[2]?.[1]?.headers.authorization).toBe(
      "Bearer new",
    );
  });
});

function tokenStore(
  tokens: Awaited<ReturnType<YoutubeTokenStoreLike["read"]>>,
): YoutubeTokenStoreLike & { write: ReturnType<typeof vi.fn> } {
  return {
    read: vi.fn(async () => tokens),
    write: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
