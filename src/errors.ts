import { ZodError } from "zod";

export class YoutubeMcpError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "YoutubeMcpError";
  }
}

export class YoutubeApiError extends YoutubeMcpError {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message, "youtube_api_error");
    this.name = "YoutubeApiError";
  }
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
  }

  if (error instanceof YoutubeMcpError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected YouTube MCP error.";
}
