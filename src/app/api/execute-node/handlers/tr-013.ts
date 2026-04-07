import type { NodeHandler } from "./types";

/**
 * TR-013 — Condition Router
 * Evaluates a condition string against the upstream data and returns either
 * the data (if true) or null (if false), with a hint about which output port
 * the workflow runner should follow.
 *
 * Pure copy from the original execute-node/route.ts (lines 5876-5896 of the
 * pre-decomposition file). No logic changes.
 */
export const handleTR013: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // ── Condition Router ──────────────────────────────────────
  const conditionText = (inputData?.condition as string) || (inputData?.content as string) || "true";
  const dataStr = typeof inputData === "string" ? inputData : JSON.stringify(inputData || {});
  const conditionMet = conditionText.toLowerCase() === "true" || dataStr.toLowerCase().includes(conditionText.toLowerCase());

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      result: conditionMet ? (inputData || {}) : null,
      conditionMet,
      condition: conditionText,
      outputPort: conditionMet ? "true-out" : "false-out",
      summary: `Condition "${conditionText}" evaluated to ${conditionMet}`,
    },
    metadata: { engine: "condition-router", real: true, conditionMet },
    createdAt: new Date(),
  };
};
