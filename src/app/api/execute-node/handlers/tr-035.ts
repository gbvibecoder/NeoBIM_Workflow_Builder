/**
 * TR-035 — Hard Verifier (Phase Beta 3)
 *
 * Deterministic comparison of spec.furniture[*].parts vs actual IFC.
 * Always succeeds — it's a reporter, not a gate. Downstream nodes
 * (TR-033 Spec Patcher) consume the report and decide whether to retry.
 */

import type { NodeHandler } from "./types";
import { briefSpecSchema } from "@/features/brief-to-ifc/v3/types";

export const handleTR035: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const ifcUrl =
    typeof inputData?.ifcUrl === "string" && inputData.ifcUrl.length > 8
      ? inputData.ifcUrl
      : null;
  if (!ifcUrl) {
    throw new Error("TR-035 (Hard Verifier) requires an `ifcUrl` from upstream.");
  }

  const rawSpec = inputData?.briefSpec ?? inputData?.spec;
  const specParsed = rawSpec ? briefSpecSchema.safeParse(rawSpec) : null;

  // eslint-disable-next-line no-console
  console.info(`[tr-035] handler invoked, ifcUrl=${ifcUrl.slice(0, 60)}...`);

  const { verifyBuild } = await import("@/features/brief-to-ifc/v3/hard-verifier");

  const startMs = Date.now();
  const verifierReport = await verifyBuild(
    ifcUrl,
    specParsed?.success ? specParsed.data : ({} as import("@/features/brief-to-ifc/v3/types").BriefSpec),
  );
  const durationMs = Date.now() - startMs;

  const mismatchCount = verifierReport.mismatches.length;
  const summary =
    `Verified: ${verifierReport.verified ? "PASS" : "FAIL"} — ` +
    `parts_coverage=${(verifierReport.parts_coverage * 100).toFixed(0)}%, ` +
    `trim_coverage=${(verifierReport.trim_coverage * 100).toFixed(0)}%, ` +
    `${mismatchCount} mismatch${mismatchCount === 1 ? "" : "es"}. (${durationMs}ms)`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      ifcUrl,
      briefSpec: specParsed?.success ? specParsed.data : null,
      verifierReport,
      mismatchCount,
      parts_coverage: verifierReport.parts_coverage,
      trim_coverage: verifierReport.trim_coverage,
      verified: verifierReport.verified,
      summary,
    },
    metadata: {
      stage: "hard-verifier",
      durationMs,
      verified: verifierReport.verified,
    },
    createdAt: new Date(),
  };
};
