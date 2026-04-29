/**
 * Brief-to-Renders stageLog persister.
 *
 * Mirrors VIP's `src/features/floor-plan/lib/vip-pipeline/stage-log-store.ts:35-50`.
 * Each call replaces the entire `BriefRenderJob.stageLog` JSONB column
 * atomically — full-array writes are simpler than delta merges and the
 * payloads are tiny (≤16 entries × ~200 bytes each).
 *
 * Returns a `StageLogPersister` that the `BriefRenderLogger` invokes
 * after every stage event. Persister errors propagate (the orchestrator's
 * outer try/catch maps them to FAILED status); we do NOT swallow here
 * because silent persistence drift is harder to debug than a loud throw.
 *
 * The `prisma` parameter is injected for testability — production calls
 * pass `prisma` from `@/lib/db`; unit tests pass a mock.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import type { BriefStageLogEntry } from "./types";
import type { StageLogPersister } from "./logger";

/**
 * Bind a persister to a specific job. Returns a function the
 * `BriefRenderLogger` calls after every stage event.
 *
 * Type note on `Prisma.InputJsonValue`: Prisma's JSON column type is
 * structural, and our `BriefStageLogEntry[]` shape is JSON-compatible
 * (no Date objects, no functions, no symbols). Routing through
 * `JSON.parse(JSON.stringify(...))` would also work but adds a
 * pointless serialise/deserialise hop. The cast is safe because the
 * type system can't statically prove "this is JSON-serialisable".
 */
export function createStageLogPersister(
  jobId: string,
  prisma: PrismaClient,
): StageLogPersister {
  return async (entries: BriefStageLogEntry[]) => {
    await prisma.briefRenderJob.update({
      where: { id: jobId },
      data: {
        stageLog: entries as unknown as Prisma.InputJsonValue,
      },
    });
  };
}

/**
 * Read the persisted stageLog for a job. Used by the worker on resume
 * so a freshly-instantiated logger can seed itself with existing entries
 * (mirrors VIP's `seedStageLog` pattern).
 */
export async function readStageLog(
  jobId: string,
  prisma: PrismaClient,
): Promise<BriefStageLogEntry[]> {
  const row = await prisma.briefRenderJob.findUnique({
    where: { id: jobId },
    select: { stageLog: true },
  });
  if (!row) return [];
  const raw: unknown = row.stageLog;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is BriefStageLogEntry =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as { stage?: unknown }).stage === "number",
  );
}
