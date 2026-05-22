/**
 * TR-034 — Spec Validator (Phase Beta 2)
 *
 * Deterministic validation gate. Fails fast on structural errors,
 * warns on quality issues. Runs after the parallel branch merge.
 */

import type { NodeHandler } from "./types";
import { briefSpecSchema } from "@/features/brief-to-ifc/v3/types";

export const handleTR034: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const rawSpec =
    (inputData as Record<string, unknown>)?.briefSpec ??
    (inputData as Record<string, unknown>)?.spec ??
    inputData;

  const parsed = briefSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    throw new Error(
      `TR-034 (Spec Validator) needs a valid BriefSpec. ` +
      `Errors: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  // eslint-disable-next-line no-console
  console.info(`[tr-034] handler invoked`);

  const { validateSpec } = await import(
    "@/features/brief-to-ifc/v3/spec-validator-node"
  );
  const result = validateSpec(parsed.data);

  if (!result.valid) {
    throw new Error(
      `TR-034 (Spec Validator) found ${result.errors.length} errors: ` +
      result.errors.map((e) => `${e.field}: ${e.message}`).join("; "),
    );
  }

  const summary =
    `Spec valid. ${result.warnings.length} warnings.`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      briefSpec: parsed.data,
      validation: result,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      summary,
    },
    metadata: {
      stage: "spec-validator",
      durationMs: 0,
    },
    createdAt: new Date(),
  };
};
