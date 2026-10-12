import { afterEach, describe, expect, it, vi } from "vitest";
import { withRequestTiming } from "../../src/lib/request-timing.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("request timing", () => {
  it("correlates pending and completion logs without exposing payloads", async () => {
    vi.useFakeTimers();
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = { isError: true, content: "private response" };
    let finish!: (value: typeof result) => void;
    const handler = vi.fn((argument: string) => {
      expect(argument).toBe("private argument");
      return new Promise<typeof result>((resolve) => {
        finish = resolve;
      });
    });
    const request = withRequestTiming(
      "youtube_test",
      handler,
    )("private argument");
    await vi.advanceTimersByTimeAsync(15_000);
    finish(result);
    expect(await request).toBe(result);
    await vi.advanceTimersByTimeAsync(30_000);

    const entries = stderr.mock.calls.map(([line]) => JSON.parse(line));
    expect(entries.map((entry) => entry.event)).toEqual([
      "tool_start",
      "tool_pending",
      "tool_end",
    ]);
    expect(new Set(entries.map((entry) => entry.requestId)).size).toBe(1);
    expect(entries[2].outcome).toBe("error");
    expect(entries[1].durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(entries)).not.toContain("private");
    expect(handler).toHaveBeenCalledWith("private argument");
  });

  it("preserves exceptions and clears pending logs", async () => {
    vi.useFakeTimers();
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("secret exception detail");
    const request = withRequestTiming("youtube_test", async () => {
      throw error;
    })();
    await expect(request).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(stderr).toHaveBeenCalledTimes(2);
    expect(JSON.parse(stderr.mock.calls[1][0]).outcome).toBe("exception");
    expect(JSON.stringify(stderr.mock.calls)).not.toContain("secret");
  });
});
