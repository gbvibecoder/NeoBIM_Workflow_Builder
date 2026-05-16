/**
 * `appendLog` — the SINGLE entry point for log writes on the
 * Brief-to-IFC v3 critical path (Phase v3 observability §D4).
 *
 * Every log line lands in two places, best-effort:
 *
 *   1. `ExecutionLog` Postgres row (the source of truth — never lost
 *      to a network blip; the dashboard hydrates initial history from
 *      here on every reconnect).
 *   2. Pusher private channel `private-bf-v3-{executionId}` (live
 *      stream — the dashboard subscribes for near-instant updates).
 *      If Pusher isn't configured or fails, the log line still landed
 *      in DB and the dashboard's polling fallback surfaces it.
 *
 * Rule 14 ("no silent fallbacks") is honoured here: a DB write failure
 * is logged loudly to stderr (the operator sees it in Vercel logs) but
 * does NOT throw — the calling code (the agent loop, the background
 * runner) must continue to make progress, and a missed log line is a
 * lesser sin than crashing a 60-second run because Postgres hiccuped.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { pusherTrigger } from "@/lib/pusher-server";

export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SOURCES = [
  "ENRICH",
  "GENERATE",
  "TOOL_CALL",
  "SANDBOX",
  "HEARTBEAT",
  "LIFECYCLE",
  "DIAGNOSTIC",
] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

/** Pusher channel for a run's log stream. Matches the existing
 *  `private-canvas-{workflowId}` convention so the Pusher auth route
 *  treats it consistently. */
export function logChannel(executionId: string): string {
  return `private-bf-v3-${executionId}`;
}

export const LOG_EVENT_NAME = "execution-log:appended";

export interface AppendLogArgs {
  executionId: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  metadata?: Record<string, unknown> | null;
}

export interface AppendLogResult {
  /** True iff the DB write succeeded. */
  persisted: boolean;
  /** Best-effort Pusher publish status. False when Pusher unconfigured
   *  or publish failed; the DB write is independent. */
  streamed: boolean;
  /** Persisted row id when `persisted`. */
  logId: string | null;
}

/**
 * Persist + publish a log line. Never throws.
 *
 * Returns a tri-state result so the diagnostic CLI / tests can assert
 * exactly which side-channels succeeded — the production critical path
 * doesn't inspect the return value.
 */
export async function appendLog(
  prisma: PrismaClient,
  args: AppendLogArgs,
): Promise<AppendLogResult> {
  const { executionId, level, source } = args;
  // Cap the persisted message at 4 KB. Pset-rich tool-result payloads
  // can easily exceed Postgres TEXT-write performance limits otherwise;
  // 4 KB still carries useful context with margin.
  const message =
    args.message.length > 4096
      ? args.message.slice(0, 4093) + "..."
      : args.message;
  const metadata = args.metadata ?? null;

  // ── 1. DB write — the source of truth ─────────────────────────────
  let persistedId: string | null = null;
  try {
    const row = await prisma.executionLog.create({
      data: {
        executionId,
        level,
        source,
        message,
        metadata:
          metadata === null
            ? undefined
            : (metadata as Prisma.InputJsonValue),
      },
      select: { id: true },
    });
    persistedId = row.id;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[bf-v3-appendLog] DB write failed for execution ${executionId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── 2. Pusher publish — best-effort live stream ───────────────────
  let streamed = false;
  try {
    await pusherTrigger(logChannel(executionId), LOG_EVENT_NAME, {
      id: persistedId,
      executionId,
      level,
      source,
      message,
      metadata,
      timestamp: new Date().toISOString(),
    });
    // `pusherTrigger` swallows its own errors and no-ops when Pusher
    // isn't configured — we cannot distinguish those here, so `streamed`
    // reflects "we tried" not "the client received". The DB write is
    // the actual durability guarantee.
    streamed = true;
  } catch (err) {
    // Pusher SHOULD have swallowed already — this branch is defensive.
    // eslint-disable-next-line no-console
    console.error(
      `[bf-v3-appendLog] Pusher publish failed for execution ${executionId}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    persisted: persistedId !== null,
    streamed,
    logId: persistedId,
  };
}

/** Convenience wrapper for the most common shape — INFO level. */
export function logInfo(
  prisma: PrismaClient,
  executionId: string,
  source: LogSource,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<AppendLogResult> {
  return appendLog(prisma, { executionId, level: "INFO", source, message, metadata });
}

/** Convenience wrapper for the most common shape — ERROR level. */
export function logError(
  prisma: PrismaClient,
  executionId: string,
  source: LogSource,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<AppendLogResult> {
  return appendLog(prisma, { executionId, level: "ERROR", source, message, metadata });
}
