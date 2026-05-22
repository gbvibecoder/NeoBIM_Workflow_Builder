/**
 * TR-031 — Material Resolver (Phase Beta 2)
 *
 * Deterministic fuzzy-match resolver. No Opus call. Sub-50ms.
 * Runs in the parallel branch alongside TR-028 and TR-030.
 */

import type { NodeHandler } from "./types";
import { briefSpecSchema } from "@/features/brief-to-ifc/v3/types";

export const handleTR031: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const rawSpec =
    (inputData as Record<string, unknown>)?.briefSpec ??
    (inputData as Record<string, unknown>)?.spec ??
    inputData;

  const parsed = briefSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    throw new Error(
      `TR-031 (Material Resolver) needs a valid BriefSpec. ` +
      `Errors: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  // eslint-disable-next-line no-console
  console.info(`[tr-031] handler invoked, materials=${parsed.data.materials?.length ?? 0}`);

  const { resolveMaterials } = await import(
    "@/features/brief-to-ifc/v3/material-resolver"
  );
  const result = resolveMaterials(parsed.data);

  const summary =
    `Resolved ${result.metrics.resolved} materials ` +
    `(${result.metrics.fuzzy} fuzzy, ${result.metrics.fallback} fallback).`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      briefSpec: result.spec,
      metrics: result.metrics,
      summary,
    },
    metadata: {
      stage: "material-resolver",
      durationMs: 0,
    },
    createdAt: new Date(),
  };
};
