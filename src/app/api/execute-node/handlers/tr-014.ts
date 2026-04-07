import type { NodeHandler } from "./types";

/**
 * TR-014 — Data Merge
 * Merges all top-level fields from the upstream input(s) into a single object.
 *
 * Pure copy from the original execute-node/route.ts (lines 5898-5919 of the
 * pre-decomposition file). No logic changes.
 */
export const handleTR014: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // ── Data Merge ────────────────────────────────────────────
  const mergedData: Record<string, unknown> = {};
  if (inputData && typeof inputData === "object") {
    Object.entries(inputData).forEach(([key, value]) => {
      mergedData[key] = value;
    });
  }

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      merged: mergedData,
      inputCount: Object.keys(mergedData).length,
      summary: `Merged ${Object.keys(mergedData).length} field(s) into a single dataset`,
    },
    metadata: { engine: "data-merge", real: true, inputCount: Object.keys(mergedData).length },
    createdAt: new Date(),
  };
};
