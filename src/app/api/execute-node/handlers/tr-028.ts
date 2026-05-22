/**
 * TR-028 — Item Decomposer (Phase Alpha)
 *
 * Canvas-visible node that decomposes furniture/equipment items in a
 * BriefSpec into their physical parts via parallel Opus calls. Runs
 * between TR-025 (Brief Enricher) and TR-026 (IFC Agent Builder).
 *
 * Input:
 *   • `briefSpec: BriefSpec` — from TR-025 upstream (required)
 *   • `classification?: string` — optional archetype override
 *
 * Output:
 *   • Type "json" artifact with the enriched BriefSpec (parts[] embedded)
 *     and decomposer metrics.
 */

import type { NodeHandler } from "./types";
import { decomposeBriefSpecItems } from "@/features/brief-to-ifc/v3/item-decomposer";
import { briefSpecSchema } from "@/features/brief-to-ifc/v3/types";

export const handleTR028: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  // Extract briefSpec from upstream (TR-025 output)
  const rawSpec =
    (inputData as Record<string, unknown>)?.briefSpec ??
    (inputData as Record<string, unknown>)?.spec ??
    inputData;

  // eslint-disable-next-line no-console
  console.info(
    `[tr-028] handler invoked, briefSpec keys=${Object.keys((rawSpec && typeof rawSpec === "object" ? rawSpec : {}) as Record<string, unknown>).join(",")}, ` +
    `furniture items=${Array.isArray((rawSpec as Record<string, unknown>)?.furniture) ? ((rawSpec as Record<string, unknown>).furniture as unknown[]).length : 0}`,
  );

  const parsed = briefSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    throw new Error(
      `TR-028 (Item Decomposer) needs a valid BriefSpec from upstream TR-025. ` +
      `Validation errors: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  const classification =
    typeof (inputData as Record<string, unknown>)?.classification === "string"
      ? ((inputData as Record<string, unknown>).classification as string)
      : undefined;

  const result = await decomposeBriefSpecItems(parsed.data, classification);

  const furnitureCount = result.spec.furniture?.length ?? 0;
  const summary =
    `Decomposed ${result.metrics.decomposed_items}/${furnitureCount} items ` +
    `into ${result.metrics.total_parts} parts. ` +
    `(${result.metrics.opus_calls} Opus calls, ` +
    `$${result.metrics.cost_usd.toFixed(4)}, ` +
    `${result.metrics.wall_time_ms}ms)`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      briefSpec: result.spec,
      metrics: result.metrics,
      furnitureCount,
      decomposedCount: result.metrics.decomposed_items,
      totalParts: result.metrics.total_parts,
      summary,
    },
    metadata: {
      stage: "item-decomposer",
      advisoryRole: true,
      costUsd: result.metrics.cost_usd,
      durationMs: result.metrics.wall_time_ms,
    },
    createdAt: new Date(),
  };
};
