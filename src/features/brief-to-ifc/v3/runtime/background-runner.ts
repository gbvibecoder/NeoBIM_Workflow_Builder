/**
 * `runBackground` — the lifecycle wrapper for every async generator job
 * on the v3 critical path (Phase v3 observability §D3).
 *
 * Contract (the load-bearing piece):
 *   • On entry: transitions PENDING -> RUNNING and starts a heartbeat
 *     ticker.
 *   • On success: transitions RUNNING -> COMPLETED with the success
 *     payload from `fn`.
 *   • On `fn` throw: catches, coerces to a known errorCode via
 *     `toBriefToIfcV3ErrorCode`, transitions to FAILED, persists the
 *     errorMessage. The error is also written as a final log line.
 *   • On timeout: races `fn` against `setTimeout(timeoutMs)`. When the
 *     timer wins, the run is marked FAILED with `EXECUTION_TIMEOUT`.
 *     `fn` is allowed to continue (no AbortController plumbing required
 *     by the spec — Node will finish it; the row is terminal so future
 *     writes from the now-orphaned task are race-rejected by
 *     `transitionStatus`'s atomic guard).
 *   • On any exit path: heartbeat is stopped and a final log line is
 *     written. NO `Execution` row stays `RUNNING` after this function
 *     returns.
 *
 * The route does NOT block on the returned Promise — but it MUST
 * schedule the call via `after()` from `next/server` to keep the
 * Vercel function alive past the response flush. Plain
 * `void runBackground(...)` dies at the first `await` because the
 * runtime suspends the V8 isolate when the response is sent;
 * `maxDuration` is a CEILING on how long the function CAN run, NOT
 * a keepalive. The client polls / SSE-streams the DB row for status.
 * See PHASE_EVAL_RESULTS_REPORT_2026-05-16.md for the post-mortem.
 */

import type { PrismaClient } from "@prisma/client";

import {
  toBriefToIfcV3ErrorCode,
  type BriefToIfcV3ErrorCode,
} from "../lifecycle/error-codes";
import { startHeartbeat, type HeartbeatHandle } from "../lifecycle/heartbeat";
import {
  InvalidStatusTransitionError,
  TransitionRaceLostError,
  transitionStatus,
  type CompletedPayload,
  type FailedPayload,
} from "../lifecycle/transitions";
import { appendLog } from "./append-log";

export const DEFAULT_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface RunBackgroundArgs<TSuccess> {
  prisma: PrismaClient;
  /** The run row already exists in PENDING — `runBackground` advances it
   *  to RUNNING on entry, then to a terminal status on exit. */
  runId: string;
  /** The async work. Resolve with the COMPLETED payload on success;
   *  throw to signal failure (any thrown value is coerced to an
   *  errorCode + message). */
  fn: (ctx: BackgroundRunContext) => Promise<TSuccess>;
  /** Map the success result `TSuccess` into the COMPLETED-transition
   *  payload. Kept separate from `fn` so the work function can return
   *  rich domain types while the lifecycle gets the schema-validated
   *  payload it needs. */
  toCompletedPayload: (result: TSuccess) => CompletedPayload;
  /** Optional override; defaults to `DEFAULT_EXECUTION_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Optional override; defaults to `HEARTBEAT_INTERVAL_MS`. */
  heartbeatIntervalMs?: number;
}

/** Surface the work function can use to emit logs without re-importing
 *  `appendLog` everywhere. */
export interface BackgroundRunContext {
  runId: string;
  log: (
    level: "DEBUG" | "INFO" | "WARN" | "ERROR",
    source: "ENRICH" | "GENERATE" | "TOOL_CALL" | "SANDBOX" | "LIFECYCLE",
    message: string,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
}

export interface RunBackgroundResult {
  runId: string;
  terminalStatus: "COMPLETED" | "FAILED" | "CANCELLED";
  /** When the run failed, the errorCode that landed in the DB. */
  errorCode: BriefToIfcV3ErrorCode | null;
  durationMs: number;
}

/**
 * Run `fn` as a backgrounded task with full lifecycle bookkeeping.
 * The route should return its 202 response and let `runBackground`
 * resolve after the HTTP cycle.
 *
 * In a serverless environment that suspends the function on response,
 * the caller MUST schedule this via `after()` from `next/server` to
 * keep the runtime alive past the response flush. `maxDuration` is
 * the UPPER BOUND on how long the function CAN run once kept alive —
 * it does NOT keep the function alive on its own. Plain
 * `void runBackground(...)` would die at the first await.
 */
export async function runBackground<TSuccess>(
  args: RunBackgroundArgs<TSuccess>,
): Promise<RunBackgroundResult> {
  const {
    prisma,
    runId,
    fn,
    toCompletedPayload,
    timeoutMs = DEFAULT_EXECUTION_TIMEOUT_MS,
    heartbeatIntervalMs,
  } = args;

  const startedAt = Date.now();

  // ── 1. PENDING -> RUNNING (atomic) ────────────────────────────────
  try {
    await transitionStatus(prisma, runId, "PENDING", { to: "RUNNING" });
  } catch (err) {
    // The row is gone, or someone else already advanced it. Either way
    // we have no work to do and shouldn't pretend we did.
    await appendLog(prisma, {
      executionId: runId,
      level: "ERROR",
      source: "LIFECYCLE",
      message: `runBackground: could not enter RUNNING — ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return {
      runId,
      terminalStatus: "FAILED",
      errorCode: err instanceof InvalidStatusTransitionError ? "INVALID_STATUS_TRANSITION" : "RUN_NOT_FOUND",
      durationMs: Date.now() - startedAt,
    };
  }

  // ── 2. Heartbeat ticker ───────────────────────────────────────────
  const heartbeat: HeartbeatHandle = startHeartbeat(prisma, runId, {
    intervalMs: heartbeatIntervalMs,
  });

  // Log-emission context the work function uses.
  const ctx: BackgroundRunContext = {
    runId,
    async log(level, source, message, metadata) {
      await appendLog(prisma, {
        executionId: runId, level, source, message, metadata,
      });
    },
  };

  await appendLog(prisma, {
    executionId: runId,
    level: "INFO",
    source: "LIFECYCLE",
    message: `Run entered RUNNING state (timeout ${timeoutMs} ms).`,
  });

  // ── 3. Race `fn` against the timeout ──────────────────────────────
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new ExecutionTimeoutError(timeoutMs));
    }, timeoutMs);
    // Don't keep the process alive solely for this timer.
    if (timeoutHandle && typeof timeoutHandle.unref === "function") {
      timeoutHandle.unref();
    }
  });

  let success: TSuccess | null = null;
  let failure: unknown = null;
  try {
    success = (await Promise.race([fn(ctx), timeoutPromise])) as TSuccess;
  } catch (err) {
    failure = err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    heartbeat.stop();
  }

  // ── 4. Terminal-status transition ────────────────────────────────
  if (success !== null && failure === null) {
    try {
      const payload = toCompletedPayload(success);
      await transitionStatus(prisma, runId, "RUNNING", {
        to: "COMPLETED",
        payload,
      });
      await appendLog(prisma, {
        executionId: runId, level: "INFO", source: "LIFECYCLE",
        message:
          `Run COMPLETED in ${Date.now() - startedAt} ms. ` +
          `entityCount=${payload.entityCount} ifcUrl=${payload.ifcUrl}`,
      });
      return {
        runId, terminalStatus: "COMPLETED", errorCode: null,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      // The COMPLETED transition itself failed (race with cancel, or
      // payload invariant violation). Surface as FAILED so the row
      // never lingers in RUNNING.
      failure = err;
    }
  }

  // Failure path — `failure` is non-null at this point.
  const errorCode = isExecutionTimeoutError(failure)
    ? "EXECUTION_TIMEOUT"
    : toBriefToIfcV3ErrorCode(failure);
  const errorMessage =
    failure instanceof Error ? failure.message : String(failure);

  await appendLog(prisma, {
    executionId: runId, level: "ERROR", source: "LIFECYCLE",
    message: `Run FAILED with code ${errorCode}: ${errorMessage}`,
    metadata: { errorCode, errorMessage },
  });

  try {
    const failedPayload: FailedPayload = { errorCode, errorMessage };
    await transitionStatus(prisma, runId, "RUNNING", {
      to: "FAILED",
      payload: failedPayload,
    });
  } catch (transitionErr) {
    // The FAILED transition can race with cancel. If the row is already
    // terminal (e.g. CANCELLED by user mid-run), that's the desired
    // outcome — leave the row as-is.
    if (
      !(
        transitionErr instanceof TransitionRaceLostError ||
        transitionErr instanceof InvalidStatusTransitionError
      )
    ) {
      // eslint-disable-next-line no-console
      console.error(
        `[bf-v3-runBackground] FAILED transition write itself failed for ${runId}:`,
        transitionErr,
      );
    }
  }

  return {
    runId,
    terminalStatus: "FAILED",
    errorCode,
    durationMs: Date.now() - startedAt,
  };
}

// --- Internal --------------------------------------------------------

class ExecutionTimeoutError extends Error {
  readonly code = "EXECUTION_TIMEOUT";
  constructor(public readonly timeoutMs: number) {
    super(`Execution exceeded ${timeoutMs} ms wall-clock budget.`);
    this.name = "ExecutionTimeoutError";
  }
}

function isExecutionTimeoutError(err: unknown): err is ExecutionTimeoutError {
  return err instanceof ExecutionTimeoutError;
}
