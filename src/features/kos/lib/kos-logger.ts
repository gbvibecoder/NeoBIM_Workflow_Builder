/**
 * kos-logger — structured JSON-line logger for 5I+ code.
 *
 * Why a dedicated logger (vs. the existing `src/lib/logger.ts`):
 *   - 5I code spans routes + workers + the bot orchestrator (PR 2+)
 *     and benefits from grep-able structured fields (tenantId,
 *     customerId, drawingId, durationMs, errorCode).
 *   - `src/lib/logger.ts` only wraps `console.*` with a dev/prod
 *     suppression flag and does not standardise the log shape.
 *
 * Output: one JSON object per line, written to the appropriate
 * console channel (error → console.error, warn → console.warn, info
 * + debug → console.log). `debug` is suppressed unless
 * `NODE_ENV === "development"`.
 *
 * Stability note: the `event` slug is the stable identifier — it
 * MUST be a short snake_case string (e.g. `kos_draw_up_success`)
 * because future log aggregation will group by it. Free-form context
 * fields go in `ctx` and may evolve without breaking aggregations.
 *
 * Server-only by construction (touches `process.env`). Importing from
 * a client component would push `process` into the bundle — flag if
 * lint catches it.
 */

export type KosLogLevel = "debug" | "info" | "warn" | "error";

export interface KosLogContext {
  tenantId?: string;
  customerId?: string;
  conversationId?: string;
  drawingId?: string;
  artifactId?: string;
  errorCode?: string;
  durationMs?: number;
  [k: string]: unknown;
}

function emit(level: KosLogLevel, event: string, ctx?: KosLogContext): void {
  if (level === "debug" && process.env.NODE_ENV !== "development") return;

  let line: string;
  try {
    line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...ctx,
    });
  } catch {
    // Defensive: ctx contained a circular reference or BigInt. Fall
    // back to a minimal line so logging never throws into the route
    // handler's catch block.
    line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      _ctxSerializationError: true,
    });
  }

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
      break;
  }
}

export const kosLog = {
  debug: (event: string, ctx?: KosLogContext) => emit("debug", event, ctx),
  info: (event: string, ctx?: KosLogContext) => emit("info", event, ctx),
  warn: (event: string, ctx?: KosLogContext) => emit("warn", event, ctx),
  error: (event: string, ctx?: KosLogContext) => emit("error", event, ctx),
};
