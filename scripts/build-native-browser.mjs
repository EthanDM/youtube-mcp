import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Other platforms retain the existing Chromium fallback.
if (process.platform === "darwin") {
  const cache = mkdtempSync(join(tmpdir(), "youtube-swift-build-"));
  try {
    execFileSync(
      "/usr/bin/swiftc",
      [
        "-O",
        "-module-cache-path",
        cache,
        "native/firefox-transcript.swift",
        "-o",
        "dist/native-firefox-transcript",
      ],
      { stdio: "inherit" },
    );
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}
