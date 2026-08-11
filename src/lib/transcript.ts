import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  TranscriptTrack,
  YoutubeTranscriptLanguageList,
  YoutubeTranscriptPage,
  YoutubeTranscriptSegment,
} from "../types.js";
import { YoutubeMcpError } from "../errors.js";
import { parseYoutubeUrl } from "./youtube-url.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 30_000;

type SubtitleFormat = {
  url: string;
  ext?: string;
  name?: string;
  http_headers?: Record<string, string>;
};

type YtDlpMetadata = {
  id?: string;
  title?: string;
  channel?: string;
  duration?: number;
  language?: string;
  http_headers?: Record<string, string>;
  subtitles?: Record<string, SubtitleFormat[]>;
  automatic_captions?: Record<string, SubtitleFormat[]>;
};

type SelectedTrack = Omit<TranscriptTrack, "formats"> & {
  formats: SubtitleFormat[];
};
type Cursor = {
  videoId: string;
  language: string;
  trackType: "creator" | "automatic";
  offset: number;
};

export type TranscriptProcess = (
  path: string,
  args: string[],
) => Promise<string>;

export class TranscriptClient {
  constructor(
    private readonly ytDlpPath: string | undefined,
    private readonly runProcess: TranscriptProcess = runYtDlp,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listLanguages(url: string): Promise<YoutubeTranscriptLanguageList> {
    const parsed = parseYoutubeUrl(url);
    const metadata = await this.getMetadata(parsed.canonicalUrl);
    const tracks = listTracks(metadata);
    if (tracks.length === 0) throw transcriptUnavailable();
    return {
      video: {
        id: parsed.videoId,
        url: parsed.canonicalUrl,
        title: metadata.title || "Unknown title",
      },
      tracks: tracks.map(toPublicTrack),
    };
  }

  async getTranscript(input: {
    url: string;
    language?: string;
    cursor?: string;
    maxSegments: number;
  }): Promise<YoutubeTranscriptPage> {
    const parsed = parseYoutubeUrl(input.url);
    const metadata = await this.getMetadata(parsed.canonicalUrl);
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    if (cursor && cursor.videoId !== parsed.videoId) {
      throw new YoutubeMcpError(
        "The transcript cursor does not match the requested video or transcript track.",
        "transcript_cursor_invalid",
      );
    }
    const track = selectTrack(
      metadata,
      input.language || cursor?.language,
      cursor?.trackType,
    );
    if (!track) {
      if (input.language) {
        throw new YoutubeMcpError(
          `No ${input.language} transcript track is available for this video.`,
          "transcript_language_unavailable",
        );
      }
      throw transcriptUnavailable();
    }
    if (
      cursor &&
      (cursor.videoId !== parsed.videoId ||
        cursor.language !== track.language ||
        cursor.trackType !== track.track_type)
    ) {
      throw new YoutubeMcpError(
        "The transcript cursor does not match the requested video or transcript track.",
        "transcript_cursor_invalid",
      );
    }
    const segments = await this.fetchSegments(track, metadata.http_headers);
    const offset = cursor?.offset || 0;
    if (offset > segments.length) {
      throw new YoutubeMcpError(
        "The transcript cursor points beyond the available transcript.",
        "transcript_cursor_invalid",
      );
    }
    const page = segments.slice(offset, offset + input.maxSegments);
    const nextOffset = offset + page.length;
    const complete = nextOffset >= segments.length;
    return {
      video: {
        id: parsed.videoId,
        url: parsed.canonicalUrl,
        title: metadata.title || "Unknown title",
        channel_name: metadata.channel || "Unknown channel",
        duration_iso8601: toIsoDuration(metadata.duration),
      },
      transcript: {
        language: track.language,
        track_type: track.track_type,
        display_name: track.display_name,
        segments: page,
        text: page.map((segment) => segment.text).join("\n"),
        returned_segments: page.length,
        total_segments: segments.length,
        complete,
        next_cursor: complete
          ? undefined
          : encodeCursor({
              videoId: parsed.videoId,
              language: track.language,
              trackType: track.track_type,
              offset: nextOffset,
            }),
      },
    };
  }

  private async getMetadata(url: string): Promise<YtDlpMetadata> {
    let output: string;
    try {
      output = await this.runProcess(this.ytDlpPath || "yt-dlp", [
        "--skip-download",
        "--dump-single-json",
        "--no-warnings",
        "--no-cache-dir",
        "--",
        url,
      ]);
    } catch (error) {
      if (error instanceof YoutubeMcpError) throw error;
      throw mapProcessError(error);
    }
    try {
      return JSON.parse(output) as YtDlpMetadata;
    } catch {
      throw new YoutubeMcpError(
        "yt-dlp returned malformed video metadata.",
        "yt_dlp_failed",
      );
    }
  }

  private async fetchSegments(
    track: SelectedTrack,
    metadataHeaders?: Record<string, string>,
  ): Promise<YoutubeTranscriptSegment[]> {
    const format = chooseFormat(track.formats);
    if (!format) throw transcriptUnavailable();
    const headers = new Headers(metadataHeaders);
    for (const [name, value] of Object.entries(format.http_headers || {})) {
      headers.set(name, value);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(format.url, {
        headers,
        signal: AbortSignal.timeout(PROCESS_TIMEOUT_MS),
      });
    } catch {
      throw new YoutubeMcpError(
        "The selected transcript track could not be fetched.",
        "transcript_fetch_failed",
      );
    }
    if (!response.ok) {
      throw new YoutubeMcpError(
        "The selected transcript track could not be fetched.",
        "transcript_fetch_failed",
      );
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new YoutubeMcpError(
        "The selected transcript track could not be fetched.",
        "transcript_fetch_failed",
      );
    }
    const segments = parseCaption(text, format.ext);
    if (segments.length === 0) {
      throw new YoutubeMcpError(
        "The selected transcript track could not be parsed.",
        "transcript_parse_failed",
      );
    }
    return segments;
  }
}

export async function checkYtDlp(path?: string): Promise<string> {
  try {
    return (await runYtDlp(path || "yt-dlp", ["--version"])).trim();
  } catch (error) {
    if (error instanceof YoutubeMcpError) throw error;
    throw mapProcessError(error);
  }
}

async function runYtDlp(path: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(path, args, {
      timeout: PROCESS_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    return stdout;
  } catch (error) {
    throw mapProcessError(error);
  }
}

function mapProcessError(error: unknown): YoutubeMcpError {
  const code =
    typeof error === "object" && error
      ? (error as { code?: string }).code
      : undefined;
  if (code === "ENOENT") {
    return new YoutubeMcpError(
      "yt-dlp is not installed or YT_DLP_PATH does not point to an executable.",
      "yt_dlp_unavailable",
    );
  }
  const timedOut =
    typeof error === "object" &&
    error &&
    (error as { killed?: boolean }).killed;
  return new YoutubeMcpError(
    timedOut
      ? "yt-dlp timed out while retrieving video metadata."
      : "yt-dlp could not retrieve video metadata.",
    "yt_dlp_failed",
  );
}

function listTracks(metadata: YtDlpMetadata): SelectedTrack[] {
  return [
    ...toTracks(metadata.subtitles, "creator"),
    ...toTracks(metadata.automatic_captions, "automatic"),
  ].sort((left, right) => {
    if (left.language !== right.language)
      return left.language.localeCompare(right.language);
    return left.track_type === "creator" ? -1 : 1;
  });
}

function toTracks(
  tracks: Record<string, SubtitleFormat[]> | undefined,
  trackType: "creator" | "automatic",
): SelectedTrack[] {
  return Object.entries(tracks || {})
    .filter(([, formats]) => formats.length > 0)
    .map(([language, formats]) => ({
      language,
      display_name: formats[0]?.name,
      track_type: trackType,
      formats,
    }));
}

function toPublicTrack(track: SelectedTrack): TranscriptTrack {
  return {
    language: track.language,
    display_name: track.display_name,
    track_type: track.track_type,
    formats: [
      ...new Set(track.formats.map((format) => format.ext).filter(Boolean)),
    ] as string[],
  };
}

function selectTrack(
  metadata: YtDlpMetadata,
  requestedLanguage?: string,
  requestedTrackType?: "creator" | "automatic",
): SelectedTrack | undefined {
  const tracks = listTracks(metadata).filter(
    (track) => !requestedTrackType || track.track_type === requestedTrackType,
  );
  const languages = requestedLanguage
    ? [requestedLanguage]
    : ["en", metadata.language].filter((value): value is string =>
        Boolean(value),
      );
  for (const language of languages) {
    const exact = tracks.filter((track) => track.language === language);
    const family = tracks.filter((track) =>
      track.language.startsWith(`${language}-`),
    );
    const selected = [...exact, ...family].sort(preferCreator)[0];
    if (selected) return selected;
  }
  return requestedLanguage ? undefined : tracks.sort(preferCreator)[0];
}

function preferCreator(left: SelectedTrack, right: SelectedTrack): number {
  return left.track_type === right.track_type
    ? 0
    : left.track_type === "creator"
      ? -1
      : 1;
}

function chooseFormat(formats: SubtitleFormat[]): SubtitleFormat | undefined {
  return [...formats].sort(
    (left, right) => formatRank(left.ext) - formatRank(right.ext),
  )[0];
}

function formatRank(extension?: string): number {
  return extension === "json3"
    ? 0
    : extension === "vtt"
      ? 1
      : extension === "ttml"
        ? 2
        : 3;
}

function parseCaption(
  text: string,
  extension?: string,
): YoutubeTranscriptSegment[] {
  if (extension === "json3") return parseJson3(text);
  if (extension === "vtt") return parseVtt(text);
  return parseXml(text);
}

function parseJson3(text: string): YoutubeTranscriptSegment[] {
  let payload: {
    events?: Array<{
      tStartMs?: number;
      dDurationMs?: number;
      segs?: Array<{ utf8?: string }>;
    }>;
  };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new YoutubeMcpError(
      "The selected transcript track could not be parsed.",
      "transcript_parse_failed",
    );
  }
  return normalizeSegments(
    (payload.events || []).map((event) => ({
      start_seconds: (event.tStartMs || 0) / 1_000,
      duration_seconds: (event.dDurationMs || 0) / 1_000,
      text: (event.segs || []).map((segment) => segment.utf8 || "").join(""),
    })),
  );
}

function parseVtt(text: string): YoutubeTranscriptSegment[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const segments: YoutubeTranscriptSegment[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const timing = lines[index]?.match(/([\d:.]+)\s+-->\s+([\d:.]+)/);
    if (!timing) continue;
    const caption: string[] = [];
    index += 1;
    while (index < lines.length && lines[index]?.trim()) {
      caption.push(lines[index]!);
      index += 1;
    }
    segments.push({
      start_seconds: parseTimestamp(timing[1]!),
      duration_seconds: Math.max(
        0,
        parseTimestamp(timing[2]!) - parseTimestamp(timing[1]!),
      ),
      text: caption.join(" "),
    });
  }
  return normalizeSegments(segments);
}

function parseXml(text: string): YoutubeTranscriptSegment[] {
  return normalizeSegments([
    ...parseLegacyXmlCaptions(text),
    ...parseTtmlCaptions(text),
  ]).sort((left, right) => left.start_seconds - right.start_seconds);
}

function parseLegacyXmlCaptions(text: string): YoutubeTranscriptSegment[] {
  return [...text.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].flatMap(
    (match) => {
      const start = readAttribute(match[1] || "", "start");
      if (!start) return [];
      return [
        {
          start_seconds: Number(start),
          duration_seconds: Number(readAttribute(match[1] || "", "dur") || 0),
          text: match[2] || "",
        },
      ];
    },
  );
}

function parseTtmlCaptions(text: string): YoutubeTranscriptSegment[] {
  return [...text.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)].flatMap((match) => {
    const attributes = match[1] || "";
    const begin = readAttribute(attributes, "begin");
    if (!begin) return [];
    const startSeconds = parseTimeExpression(begin);
    const duration = readAttribute(attributes, "dur");
    const end = readAttribute(attributes, "end");
    const durationSeconds = duration
      ? parseTimeExpression(duration)
      : end
        ? Math.max(0, parseTimeExpression(end) - startSeconds)
        : 0;
    return [
      {
        start_seconds: roundSeconds(startSeconds),
        duration_seconds: roundSeconds(durationSeconds),
        text: match[2] || "",
      },
    ];
  });
}

function readAttribute(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp(`\\b${name}=["']([^"']+)["']`))?.[1];
}

function parseTimeExpression(value: string): number {
  if (value.endsWith("ms")) return Number(value.slice(0, -2)) / 1_000;
  if (value.endsWith("s")) return Number(value.slice(0, -1));
  return parseTimestamp(value);
}

function roundSeconds(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeSegments(
  segments: YoutubeTranscriptSegment[],
): YoutubeTranscriptSegment[] {
  const result: YoutubeTranscriptSegment[] = [];
  for (const segment of segments) {
    const text = decodeHtml(segment.text.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (
      !text ||
      !Number.isFinite(segment.start_seconds) ||
      !Number.isFinite(segment.duration_seconds)
    )
      continue;
    const previous = result.at(-1);
    if (
      previous &&
      previous.start_seconds === segment.start_seconds &&
      previous.text === text
    )
      continue;
    result.push({ ...segment, text });
  }
  return result;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseTimestamp(value: string): number {
  const parts = value.replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function toIsoDuration(seconds: number | undefined): string | undefined {
  if (!Number.isFinite(seconds) || seconds === undefined) return undefined;
  return `PT${Math.floor(seconds)}S`;
}

function transcriptUnavailable(): YoutubeMcpError {
  return new YoutubeMcpError(
    "No creator or automatic transcript track is available for this video.",
    "transcript_unavailable",
  );
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): Cursor {
  try {
    const cursor = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Cursor;
    if (
      !cursor.videoId ||
      !cursor.language ||
      !["creator", "automatic"].includes(cursor.trackType) ||
      !Number.isInteger(cursor.offset) ||
      cursor.offset < 0
    ) {
      throw new Error();
    }
    return cursor;
  } catch {
    throw new YoutubeMcpError(
      "The transcript cursor is invalid.",
      "transcript_cursor_invalid",
    );
  }
}
