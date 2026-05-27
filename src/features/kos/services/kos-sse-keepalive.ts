/**
 * 5I PR 3 — SSE keepalive helper.
 *
 * Writes the SSE comment line `: keepalive\n\n` to the stream every
 * `intervalMs` to keep TCP alive past intermediate-proxy idle timeouts
 * (AWS ALB default 60s; some corporate proxies 30s).
 *
 * The line is a SSE comment per the spec (lines starting with `:`),
 * which all conformant clients (including our own KosSseDecoder at
 * `kos-sse.ts:89`) silently skip — so the keepalive does NOT register
 * as an event in the consumer.
 *
 * The interval is cleared:
 *   - Explicitly when `stop()` is called (idempotent)
 *   - Implicitly when the stream's `controller.enqueue` throws
 *     (closed/errored), to avoid leaking timers in the error path.
 *
 * Usage:
 *   const stop = startSseKeepalive(controller, encoder, 15_000);
 *   try { ...stream work... } finally { stop(); }
 */

import { kosLog } from "@/features/kos/lib/kos-logger";

/** Function returned by startSseKeepalive — call to cancel the interval. */
export type SseKeepaliveStop = () => void;

const KEEPALIVE_PAYLOAD = ": keepalive\n\n";

export function startSseKeepalive(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  intervalMs: number,
): SseKeepaliveStop {
  if (intervalMs <= 0 || !Number.isFinite(intervalMs)) {
    throw new Error(
      `startSseKeepalive: intervalMs must be a positive finite number; got ${intervalMs}`,
    );
  }

  let stopped = false;
  const handle: ReturnType<typeof setInterval> = setInterval(() => {
    if (stopped) return;
    try {
      controller.enqueue(encoder.encode(KEEPALIVE_PAYLOAD));
    } catch (err) {
      // Stream already closed or errored. Silently stop the interval —
      // letting it keep firing would leak the timer and spam logs.
      stopped = true;
      clearInterval(handle);
      kosLog.warn("kos_sse_keepalive_write_failed", { err: String(err) });
    }
  }, intervalMs);

  return () => {
    if (stopped) return; // idempotent
    stopped = true;
    clearInterval(handle);
  };
}

/** Exposed only for tests. */
export const __SSE_KEEPALIVE_PAYLOAD_FOR_TESTS = KEEPALIVE_PAYLOAD;
