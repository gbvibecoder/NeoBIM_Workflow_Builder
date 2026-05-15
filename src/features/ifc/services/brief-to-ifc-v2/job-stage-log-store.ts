/**
 * Brief-to-IFC v2 stageLog persister.
 *
 * Mirrors `brief-renders`' `stage-log-store.ts` exactly. Each call
 * replaces the entire `BriefToIfcJob.stageLog` JSONB column atomically —
 * full-array writes are simpler than delta merges and the payloads are
 * tiny (3 entries × ~250 bytes each).
 *
 * Returns a `BriefToIfcStageLogPersister` that `BriefToIfcJobLogger`
 * invokes after every stage event. Persister errors propagate here — the
 * logger's `flush()` swallows them, so silent persistence drift never
 * crashes the worker.
 *
 * The `prisma` parameter is injected for testability — production calls
 * pass `prisma` from `@/lib/db`; unit tests pass a mock.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import type { BriefToIfcStageLogEntry } from "./job-types";
import type { BriefToIfcStageLogPersister } from "./job-logger";

/**
 * Bind a persister to a specific job. Returns a function the
 * `BriefToIfcJobLogger` calls after every stage event.
 *
 * Type note on `Prisma.InputJsonValue`: Prisma's JSON column type is
 * structural, and `BriefToIfcStageLogEntry[]` is JSON-compatible (no Date
 * objects, no functions, no symbols). The cast is safe because the type
 * system can't statically prove "this is JSON-serialisable" — same cast
 * the `brief-renders` persister uses.
 */
export function createBriefToIfcStageLogPersister(
  jobId: string,
  prisma: PrismaClient,
): BriefToIfcStageLogPersister {
  return async (entries: BriefToIfcStageLogEntry[]) => {
    await prisma.briefToIfcJob.update({
      where: { id: jobId },
      data: {
        stageLog: entries as unknown as Prisma.InputJsonValue,
      },
    });
  };
}

/**
 * Read the persisted stageLog for a job. Used by the worker on resume so
 * a freshly-instantiated logger can seed itself with existing entries.
 */
export async function readBriefToIfcStageLog(
  jobId: string,
  prisma: PrismaClient,
): Promise<BriefToIfcStageLogEntry[]> {
  const row = await prisma.briefToIfcJob.findUnique({
    where: { id: jobId },
    select: { stageLog: true },
  });
  if (!row) return [];
  const raw: unknown = row.stageLog;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is BriefToIfcStageLogEntry =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as { stage?: unknown }).stage === "number",
  );
}
