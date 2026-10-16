import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import {
  parseNativeFirefoxTranscript,
  readNativeFirefoxTranscript,
} from "../../src/lib/native-firefox-transcript.js";

const videoId = "LfGenpmOjDQ";
const transcript = {
  videoId,
  selectedLanguage: "English (auto-generated)",
  rows: [{ timestamp: "0:02", text: "Caption" }],
};

describe("native Firefox transcripts", () => {
  it.each([
    ["English", "creator"],
    ["English (auto-generated)", "automatic"],
  ])(
    "identifies the actual selected UI track: %s",
    (selectedLanguage, trackType) => {
      expect(
        parseNativeFirefoxTranscript(
          { ...transcript, selectedLanguage },
          videoId,
        ),
      ).toEqual({
        rows: transcript.rows,
        tracks: [{ language: "en", trackType }],
      });
    },
  );

  it.each([
    { ...transcript, videoId: "dQw4w9WgXcQ" },
    { ...transcript, selectedLanguage: "English (United States)" },
    { ...transcript, selectedLanguage: "Spanish" },
    { ...transcript, rows: [] },
    { ...transcript, rows: [{ timestamp: "0:02" }] },
  ])("rejects incomplete results and unproven track identity", (output) => {
    expect(() => parseNativeFirefoxTranscript(output, videoId)).toThrow(
      expect.objectContaining({ code: "native_firefox_result_invalid" }),
    );
  });

  it.runIf(process.platform === "darwin")(
    "binds the helper to the explicit profile and canonical video",
    async () => {
      const run = vi
        .fn()
        .mockResolvedValueOnce("123\n")
        .mockResolvedValueOnce(JSON.stringify(transcript));
      await readNativeFirefoxTranscript(
        { url: `https://youtu.be/${videoId}?list=private`, profile: "/tmp" },
        run,
      );
      expect(run.mock.calls[0]).toEqual([
        "/usr/sbin/lsof",
        ["-t", "--", "/tmp/.parentlock"],
      ]);
      expect(run.mock.calls[1][0]).toBe(
        fileURLToPath(
          new URL("../../dist/native-firefox-transcript", import.meta.url),
        ),
      );
      expect(run.mock.calls[1][1]).toEqual([
        "123",
        `https://www.youtube.com/watch?v=${videoId}`,
      ]);
    },
  );

  it
    .runIf(process.platform === "darwin")
    .each(["123\n456", "123; private", "", "0"])(
    "rejects an ambiguous or invalid profile PID (%s)",
    async (pids) => {
      const run = vi.fn().mockResolvedValue(pids);
      await expect(
        readNativeFirefoxTranscript(
          { url: `https://youtu.be/${videoId}`, profile: "/tmp" },
          run,
        ),
      ).rejects.toMatchObject({ code: "native_firefox_profile_not_open" });
      expect(run).toHaveBeenCalledOnce();
    },
  );

  it.runIf(process.platform === "darwin")(
    "preserves focus loss during pointer preparation without helper content",
    async () => {
      const run = vi
        .fn()
        .mockResolvedValueOnce("123")
        .mockResolvedValueOnce(
          JSON.stringify({
            error: {
              code: "focus_lost",
              stage: "native_pointer_prepare",
              message: "private browser content",
            },
          }),
        );
      await expect(
        readNativeFirefoxTranscript(
          { url: `https://youtu.be/${videoId}`, profile: "/tmp" },
          run,
        ),
      ).rejects.toMatchObject({
        code: "native_firefox_focus_lost",
        message: expect.not.stringContaining("private"),
        details: { stage: "native_pointer_prepare", videoId },
      });
    },
  );

  it.runIf(process.platform === "darwin")(
    "sanitizes native process exceptions",
    async () => {
      const run = vi
        .fn()
        .mockResolvedValueOnce("123")
        .mockRejectedValueOnce(new Error("private cookies and caption text"));
      await expect(
        readNativeFirefoxTranscript(
          { url: `https://youtu.be/${videoId}`, profile: "/tmp" },
          run,
        ),
      ).rejects.toMatchObject({
        code: "native_firefox_failed",
        message: expect.not.stringContaining("private"),
      });
    },
  );
});
