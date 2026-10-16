import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);

it.runIf(process.platform === "darwin")(
  "closes only an unchanged request tab and preserves repurposed windows",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "youtube-cleanup-test-"));
    try {
      const binary = join(directory, "cleanup-test");
      const source = join(directory, "main.swift");
      // One Swift entrypoint lets the fixture replace AX operations throughout
      // the production source without loading the real command-line entrypoint.
      const [production, fixture] = await Promise.all([
        readFile(
          new URL("../../native/firefox-transcript.swift", import.meta.url),
          "utf8",
        ),
        readFile(new URL("../native/main.swift", import.meta.url), "utf8"),
      ]);
      await writeFile(source, production + "\n" + fixture);
      await execFileAsync(
        "/usr/bin/swiftc",
        [
          "-D",
          "NATIVE_CLEANUP_TESTS",
          "-module-cache-path",
          join(directory, "module-cache"),
          source,
          "-o",
          binary,
        ],
        { timeout: 30_000 },
      );
      const { stdout } = await execFileAsync(binary, [], { timeout: 5_000 });
      expect(JSON.parse(stdout).passed).toEqual([
        "unchanged",
        "added-tab",
        "replacement-tab",
        "changed-navigation",
        "unreadable-tabs",
        "missing-identity",
        "cancelled-request",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  40_000,
);
