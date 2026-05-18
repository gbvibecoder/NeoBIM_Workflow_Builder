/**
 * TR-030 — Trim & Detail Specifier (Phase Beta 2)
 *
 * Adds skirting, door hardware, window handles via a single Opus call.
 * Runs in the parallel branch alongside TR-028 and TR-031.
 */

import type { NodeHandler } from "./types";
import { briefSpecSchema } from "@/features/brief-to-ifc/v3/types";

export const handleTR030: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const rawSpec =
    (inputData as Record<string, unknown>)?.briefSpec ??
    (inputData as Record<string, unknown>)?.spec ??
    inputData;

  const parsed = briefSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    throw new Error(
      `TR-030 (Trim Specifier) needs a valid BriefSpec. ` +
      `Errors: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  // eslint-disable-next-line no-console
  console.info(`[tr-030] handler invoked, openings=${parsed.data.openings?.length ?? 0}`);

  const { applyTrimSpecification } = await import(
    "@/features/brief-to-ifc/v3/trim-specifier"
  );
  const result = await applyTrimSpecification(parsed.data);

  const trimCount = result.spec.trim?.length ?? 0;
  const summary =
    `Added ${trimCount} trim items. ` +
    `($${result.metrics.cost_usd.toFixed(4)}, ${result.metrics.wall_time_ms}ms)`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      briefSpec: result.spec,
      metrics: result.metrics,
      trimCount,
      summary,
    },
    metadata: {
      stage: "trim-specifier",
      costUsd: result.metrics.cost_usd,
      durationMs: result.metrics.wall_time_ms,
    },
    createdAt: new Date(),
  };
};
