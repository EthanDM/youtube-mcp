import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

/**
 * Logs tool lifecycle metadata to stderr only. Arguments, results, and exception
 * details are deliberately excluded; stdout remains reserved for MCP messages.
 * The handler's result and thrown errors pass through unchanged.
 */
export function withRequestTiming<
  Args extends unknown[],
  Result extends { isError?: boolean },
>(
  tool: string,
  handler: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    const requestId = randomUUID();
    const started = performance.now();
    const log = (event: string, outcome?: string) => {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          event,
          tool,
          requestId,
          durationMs: Math.round(performance.now() - started),
          ...(outcome ? { outcome } : {}),
        }),
      );
    };

    log("tool_start");
    const pendingLog = setInterval(() => log("tool_pending"), 15_000);
    pendingLog.unref();
    try {
      const result = await handler(...args);
      log("tool_end", result.isError ? "error" : "success");
      return result;
    } catch (error) {
      log("tool_end", "exception");
      throw error;
    } finally {
      clearInterval(pendingLog);
    }
  };
}
