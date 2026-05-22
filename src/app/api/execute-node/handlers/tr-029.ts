/**
 * TR-029 — Architectural Reasoner (Phase Beta 2)
 *
 * Applies domain-specific positioning logic to furniture items via a
 * single Opus call. Runs after TR-025 (Brief Enricher) and before the
 * parallel decompose/trim/material branch.
 */

import type { NodeHandler } from "./types";
import { briefSpecSchema } from "@/features/brief-to-ifc/v3/types";

export const handleTR029: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const rawSpec =
    (inputData as Record<string, unknown>)?.briefSpec ??
    (inputData as Record<string, unknown>)?.spec ??
    inputData;

  const parsed = briefSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    throw new Error(
      `TR-029 (Architectural Reasoner) needs a valid BriefSpec. ` +
      `Errors: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  // eslint-disable-next-line no-console
  console.info(`[tr-029] handler invoked, furniture=${parsed.data.furniture?.length ?? 0}`);

  const { applyArchitecturalReasoning } = await import(
    "@/features/brief-to-ifc/v3/architectural-reasoner"
  );
  const result = await applyArchitecturalReasoning(parsed.data);

  const rationaleCount = result.spec.designRationale?.length ?? 0;
  const summary =
    `Positioned ${rationaleCount} items with domain logic. ` +
    `($${result.metrics.cost_usd.toFixed(4)}, ${result.metrics.wall_time_ms}ms)`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      briefSpec: result.spec,
      metrics: result.metrics,
      rationaleCount,
      summary,
    },
    metadata: {
      stage: "architectural-reasoner",
      advisoryRole: true,
      costUsd: result.metrics.cost_usd,
      durationMs: result.metrics.wall_time_ms,
    },
    createdAt: new Date(),
  };
};
