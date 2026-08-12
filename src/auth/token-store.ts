import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type YoutubeTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

export type YoutubeTokenStoreLike = {
  read(): Promise<YoutubeTokens | null>;
  write(tokens: YoutubeTokens): Promise<void>;
  clear(): Promise<void>;
};

/** Stores one local account's OAuth credentials in a private user-scoped file. */
export class YoutubeTokenStore implements YoutubeTokenStoreLike {
  constructor(private readonly filePath: string) {}

  async read(): Promise<YoutubeTokens | null> {
    try {
      return JSON.parse(
        await fs.readFile(this.filePath, "utf8"),
      ) as YoutubeTokens;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async write(tokens: YoutubeTokens): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const temporaryPath = `${this.filePath}.tmp`;
    const handle = await fs.open(
      temporaryPath,
      constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY,
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify(tokens, null, 2), "utf8");
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, this.filePath);
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
