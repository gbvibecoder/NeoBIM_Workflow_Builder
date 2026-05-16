/**
 * Heartbeat ticker for backgrounded BriefToIfcV3 runs (Phase v3 §D2).
 *
 * The contract: while a long-running async function runs in the
 * background, a `setInterval`-driven ticker updates the run row's
 * `lastHeartbeatAt` every `HEARTBEAT_INTERVAL_MS`. A separate cron sweep
 * marks RUNNING rows whose `lastHeartbeatAt` is older than
 * `STUCK_THRESHOLD_MS` as FAILED with code `STUCK_NO_HEARTBEAT`.
 *
 * The ticker MUST be non-blocking — `setInterval`, not `await sleep` —
 * so the agent loop's I/O isn't serialized behind heartbeat DB writes.
 * Each tick fires-and-forgets a `prisma.briefToIfcV3Run.update`; an
 * isolated DB hiccup never aborts the surrounding work.
 *
 * Cancellation:
 *   - Returned `stopHeartbeat()` clears the interval. The caller wraps
 *     the long-running work in `try { await fn() } finally { stop() }`
 *     so the ticker dies regardless of success / error / throw.
 *
 * Race notes:
 *   - A tick that fires after `transitionStatus` has moved the row to a
 *     terminal status would UPDATE the row's `lastHeartbeatAt` (still
 *     allowed by Prisma — Prisma update doesn't check status). To prevent
 *     a stale tick from "un-staling" a freshly-terminated run, every
 *     update is guarded by `where: { id, status: 'RUNNING' }` via
 *     `updateMany`. count=0 ⇒ no-op silently.
 */

import type { PrismaClient } from "@prisma/client";

/** Default ticker interval. Tight enough that a 5-minute stuck threshold
 *  catches genuine stalls quickly; loose enough that the DB isn't hammered
 *  during a multi-minute agent loop (~60 writes/run worst case). */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/** A RUNNING row whose last heartbeat is older than this is presumed
 *  stuck — the sweep job (cron) marks it FAILED. */
export const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

export interface HeartbeatHandle {
  /** Stop the ticker. Idempotent — safe to call multiple times. */
  stop(): void;
  /** Force a synchronous tick — used by tests + the diagnostic CLI. */
  tickNow(): Promise<void>;
}

/**
 * Start a heartbeat ticker for `runId`. Call `.stop()` when the work
 * the heartbeat is covering is done (typically in a `finally` block).
 */
export function startHeartbeat(
  prisma: PrismaClient,
  runId: string,
  options: { intervalMs?: number } = {},
): HeartbeatHandle {
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;

  const tick = async (): Promise<void> => {
    try {
      // Guarded by status=RUNNING so a stale tick doesn't reactivate a
      // terminated row. count=0 means the row is already terminal —
      // expected, silent.
      await prisma.briefToIfcV3Run.updateMany({
        where: { id: runId, status: "RUNNING" },
        data: { lastHeartbeatAt: new Date() },
      });
    } catch (err) {
      // Never propagate — the heartbeat is best-effort liveness
      // signalling; a transient DB blip must not abort the long
      // running work the heartbeat is covering. Logged so a sustained
      // outage shows up in server logs.
      // eslint-disable-next-line no-console
      console.error(
        `[bf-v3-heartbeat] tick failed for run ${runId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, intervalMs);

  // Don't keep the Node event loop alive solely for the heartbeat —
  // important so process.exit() in scripts / tests isn't blocked by
  // the ticker.
  if (typeof interval.unref === "function") {
    interval.unref();
  }

  let stopped = false;
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
    },
    async tickNow(): Promise<void> {
      await tick();
    },
  };
}

/** True if `lastHeartbeatAt` is older than `STUCK_THRESHOLD_MS` (or null
 *  while status=RUNNING, which is itself a stuck state — bootstrap
 *  should have set it). */
export function isStuck(
  lastHeartbeatAt: Date | null,
  now: Date = new Date(),
  thresholdMs: number = STUCK_THRESHOLD_MS,
): boolean {
  if (lastHeartbeatAt === null) return true;
  return now.getTime() - lastHeartbeatAt.getTime() > thresholdMs;
}
