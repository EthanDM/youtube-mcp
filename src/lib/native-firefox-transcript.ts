import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

import { YoutubeMcpError } from "../errors.js";
import { parseYoutubeUrl } from "./youtube-url.js";

const execFileAsync = promisify(execFile);
const nativeStageSchema = z.object({
  event: z.literal("youtube_native_firefox_stage"),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  stage: z.enum([
    "native_window",
    "native_page",
    "native_description",
    "native_pointer_prepare",
    "native_transcript_open",
    "native_transcript_rows",
  ]),
  durationMs: z.number().int().nonnegative(),
  observedRows: z.number().int().nonnegative().max(40_000),
  selectedLanguageSeen: z.boolean(),
});
const nativeTranscriptSchema = z.object({
  videoId: z.string(),
  selectedLanguage: z.enum(["English", "English (auto-generated)"]),
  rows: z
    .array(z.object({ timestamp: z.string(), text: z.string() }))
    .min(1)
    .max(20_000),
});
const nativeFailureSchema = z.object({
  error: z.object({
    code: z.enum([
      "busy",
      "accessibility_required",
      "browser_missing",
      "focus_lost",
      "window_focus_lost",
      "target_obscured",
      "target_missing",
      "navigation_changed",
      "navigation_failed",
      "window_ambiguous",
      "window_missing",
      "tree_limit",
      "row_limit",
      "row_invalid",
      "cancelled",
      "timeout",
      "input_invalid",
      "native_error",
    ]),
    stage: z.enum([
      "native_setup",
      "native_window",
      "native_page",
      "native_description",
      "native_pointer_prepare",
      "native_transcript_open",
      "native_transcript_rows",
    ]),
    observedRows: z.number().int().nonnegative().max(40_000).optional(),
    selectedLanguageSeen: z.boolean().optional(),
    panelFound: z.boolean().optional(),
  }),
});

type NativeProcess = (path: string, args: string[]) => Promise<string>;

/** Calls the macOS helper only for the process locking the explicitly configured profile. */
export async function readNativeFirefoxTranscript(
  input: { url: string; profile?: string },
  runProcess: NativeProcess = runNativeProcess,
) {
  const { canonicalUrl, videoId } = parseYoutubeUrl(input.url);
  if (process.platform !== "darwin") {
    throw new YoutubeMcpError(
      "Native Firefox transcripts require macOS.",
      "native_firefox_platform_unsupported",
    );
  }
  if (
    !input.profile ||
    !isAbsolute(input.profile) ||
    !(await stat(input.profile).catch(() => undefined))?.isDirectory()
  ) {
    throw new YoutubeMcpError(
      "Set YOUTUBE_NATIVE_FIREFOX_PROFILE to an existing dedicated Firefox profile directory.",
      "native_firefox_profile_required",
    );
  }
  let processes: string;
  try {
    processes = await runProcess("/usr/sbin/lsof", [
      "-t",
      "--",
      join(input.profile, ".parentlock"),
    ]);
  } catch {
    throw new YoutubeMcpError(
      "Open the dedicated Firefox profile before using the native transcript fallback.",
      "native_firefox_profile_not_open",
    );
  }
  const pids = [...new Set(processes.trim().split(/\s+/))];
  if (pids.length !== 1 || !/^[1-9]\d{0,9}$/.test(pids[0])) {
    throw new YoutubeMcpError(
      "The dedicated Firefox profile does not resolve to one browser process.",
      "native_firefox_profile_not_open",
    );
  }
  let output: unknown;
  try {
    const text = await runProcess(
      fileURLToPath(
        new URL("../../dist/native-firefox-transcript", import.meta.url),
      ),
      [pids[0], canonicalUrl],
    );
    output = JSON.parse(text);
  } catch {
    throw new YoutubeMcpError(
      "The native Firefox helper failed. Build the server and check macOS Accessibility access for its runtime.",
      "native_firefox_failed",
    );
  }
  const failure = nativeFailureSchema.safeParse(output);
  if (failure.success) {
    const { code, stage, observedRows, selectedLanguageSeen, panelFound } =
      failure.data.error;
    const message =
      code === "accessibility_required"
        ? "The MCP runtime needs macOS Accessibility access to use native Firefox clicks."
        : code === "focus_lost" ||
            code === "window_focus_lost" ||
            code === "target_obscured"
          ? "The native Firefox transcript request stopped because its window lost focus or was obscured. Leave its request window in front while it runs."
          : "The native Firefox transcript request failed. Check the safe stage and code diagnostics.";
    throw new YoutubeMcpError(message, `native_firefox_${code}`, {
      code: `native_firefox_${code}`,
      stage,
      videoId,
      observedRows,
      selectedLanguageSeen,
      panelFound,
    });
  }
  return parseNativeFirefoxTranscript(output, videoId);
}

/** The selected UI label identifies the actual original English track and its creator/automatic type. */
export function parseNativeFirefoxTranscript(output: unknown, videoId: string) {
  const result = nativeTranscriptSchema.safeParse(output);
  if (!result.success || result.data.videoId !== videoId) {
    throw new YoutubeMcpError(
      "The native Firefox helper returned an invalid transcript or track identity.",
      "native_firefox_result_invalid",
    );
  }
  return {
    rows: result.data.rows,
    tracks: [
      {
        language: "en",
        trackType:
          result.data.selectedLanguage === "English (auto-generated)"
            ? ("automatic" as const)
            : ("creator" as const),
      },
    ],
  };
}

async function runNativeProcess(path: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(path, args, {
    timeout: path === "/usr/sbin/lsof" ? 5_000 : 70_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (path !== "/usr/sbin/lsof") {
    for (const line of stderr.split("\n")) {
      try {
        const stage = nativeStageSchema.safeParse(JSON.parse(line));
        if (stage.success) console.error(JSON.stringify(stage.data));
      } catch {
        /* Discard unrecognized native diagnostics. */
      }
    }
  }
  return stdout;
}
