import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { YoutubeTokenStore } from "../../src/auth/token-store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("YoutubeTokenStore", () => {
  it("persists a local session with private directory and file permissions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "youtube-mcp-test-"));
    temporaryRoots.push(root);
    const tokenPath = path.join(root, "credentials", "tokens.json");
    const store = new YoutubeTokenStore(tokenPath);

    await store.write({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 1,
    });

    expect(await store.read()).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: 1,
    });
    expect((await fs.stat(path.dirname(tokenPath))).mode & 0o777).toBe(0o700);
    expect((await fs.stat(tokenPath)).mode & 0o777).toBe(0o600);
    await store.clear();
    await expect(store.read()).resolves.toBeNull();
  });
});
