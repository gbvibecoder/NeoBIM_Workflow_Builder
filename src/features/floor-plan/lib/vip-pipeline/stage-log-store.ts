/**
 * Phase 2.6 — helpers for reading/writing VipJob.stageLog from
 * the worker routes. The DB column is JSONB; Prisma returns it as
 * `Prisma.JsonValue`, so callers need a safe narrowing helper.
 *
 * The worker:
 *   1. Reads existing stageLog when resuming (Phase B / regenerate).
 *   2. Provides onStageLog callback to the orchestrator — each event
 *      replaces the DB column atomically with the full snapshot.
 *   3. Optionally seeds stage 0 (parse) entries before invoking
 *      the orchestrator so the UI sees parse timing too.
 */

import { prisma } from "@/lib/db";
import type { StageLogEntry } from "./types";

/** Narrow a JSON value into a StageLogEntry[] or an empty array. */
export function readStageLog(raw: unknown): StageLogEntry[] {
  if (!Array.isArray(raw)) return [];
  // Light shape check — JSONB can contain anything, but we trust the worker wrote it.
  return raw.filter(
    (x): x is StageLogEntry =>
      !!x && typeof x === "object" && typeof (x as StageLogEntry).stage === "number",
  );
}

/**
 * Returns a fire-and-forget persister bound to `jobId`. Pass the returned
 * function as `VIPPipelineConfig.onStageLog` — the orchestrator will
 * call it after every stage event.
 *
 * Failures are swallowed because VIPLogger must never throw. We log a
 * warning so silent DB-persistence drift is visible in Vercel logs.
 */
export function createStageLogPersister(jobId: string): (entries: StageLogEntry[]) => Promise<void> {
  return async (entries) => {
    try {
      await prisma.vipJob.update({
        where: { id: jobId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma Json type is structural
        data: { stageLog: JSON.parse(JSON.stringify(entries)) as any },
      });
    } catch (err) {
      console.warn(
        `[vip-worker] stageLog persist failed for job ${jobId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  };
}

/**
 * Append a single terminal entry (e.g. stage 0 "parse") and persist.
 * Used when the worker runs code outside the orchestrator (parse
 * constraints, top-level errors) and still wants it on the timeline.
 */
export async function appendStageLogEntry(
  jobId: string,
  entry: StageLogEntry,
): Promise<void> {
  try {
    const existing = await prisma.vipJob.findUnique({
      where: { id: jobId },
      select: { stageLog: true },
    });
    const prior = readStageLog(existing?.stageLog as unknown);
    await prisma.vipJob.update({
      where: { id: jobId },
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma Json type is structural
        stageLog: JSON.parse(JSON.stringify([...prior, entry])) as any,
      },
    });
  } catch (err) {
    console.warn(
      `[vip-worker] stageLog append failed for job ${jobId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
