/**
 * TR-033 — Spec Patcher + Iterative Build Orchestrator (Phase Beta 3)
 *
 * Reads the Hard Verifier report + Vision Inspector report from upstream.
 * If quality is below threshold OR parts are collapsed, generates patches
 * via Opus, applies them to the spec, and re-invokes the agent builder
 * up to 2 additional times. Keeps the best-quality IFC across iterations.
 *
 * Uses runAgentBuild() for each rebuild iteration (same code path as
 * TR-026), then hard-verifies each iteration's output.
 */

import { headers } from "next/headers";

import type { NodeHandler } from "./types";
import { briefSpecSchema, verifierReportSchema, visionReportSchema } from "@/features/brief-to-ifc/v3/types";

async function getOriginAndCookie(): Promise<{ origin: string; cookie: string }> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    new URL(process.env.NEXTAUTH_URL ?? "https://trybuildflow.in").host;
  return { origin: `${proto}://${host}`, cookie: h.get("cookie") ?? "" };
}

export const handleTR033: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const ifcUrl =
    typeof inputData?.ifcUrl === "string" && inputData.ifcUrl.length > 8
      ? inputData.ifcUrl
      : null;
  if (!ifcUrl) {
    throw new Error("TR-033 (Spec Patcher) requires an `ifcUrl` from upstream.");
  }

  const rawSpec = inputData?.briefSpec ?? inputData?.spec;
  const specParsed = rawSpec ? briefSpecSchema.safeParse(rawSpec) : null;

  // eslint-disable-next-line no-console
  console.info(`[tr-033] handler invoked, ifcUrl=${ifcUrl.slice(0, 60)}...`);

  // Extract upstream reports
  const rawVerifier = inputData?.verifierReport;
  const verifierParsed = rawVerifier ? verifierReportSchema.safeParse(rawVerifier) : null;

  const rawVision = inputData?.visionReport;
  const visionParsed = rawVision ? visionReportSchema.safeParse(rawVision) : null;

  const startMs = Date.now();

  // Full path: both reports available → run iterative rebuild loop
  if (specParsed?.success && verifierParsed?.success && visionParsed?.success) {
    const { patchAndIterate } = await import("@/features/brief-to-ifc/v3/spec-patcher");
    const { origin, cookie } = await getOriginAndCookie();

    // Build initial result from upstream data
    const initialResult = {
      iteration: 1,
      ifcUrl,
      qualityScore: visionParsed.data.quality_score,
      partsCoverage: verifierParsed.data.parts_coverage,
      trimCoverage: verifierParsed.data.trim_coverage,
      entityCount: typeof inputData?.entityCount === "number" ? inputData.entityCount : 0,
      elapsedMs: 0,
      costUsd: 0,
      verifierMismatches: verifierParsed.data.mismatches,
      visionIssues: visionParsed.data.issues,
    };

    const patcherResult = await patchAndIterate(
      {
        spec: specParsed.data,
        currentResult: initialResult,
        runId: executionId ?? `exec-${tileInstanceId}`,
      },
      {
        maxIterations: 2,
        qualityThreshold: 75,
        partsThreshold: 0.85,
        costBudgetUsd: 0.50,
        origin,
        cookie,
      },
    );

    const durationMs = Date.now() - startMs;

    return {
      id: `art_${tileInstanceId}_${Date.now()}`,
      executionId,
      tileInstanceId,
      type: "json",
      data: {
        ifcUrl: patcherResult.finalIfcUrl,
        briefSpec: specParsed.data,
        verifierReport: verifierParsed.data,
        visionReport: visionParsed.data,
        patches_applied: patcherResult.patches_applied,
        patch_count: patcherResult.patches_applied.length,
        iterations: patcherResult.iterations,
        bestIteration: patcherResult.bestIteration,
        qualityScore: patcherResult.finalQualityScore,
        entityCount: patcherResult.finalEntityCount,
        total_cost_usd: patcherResult.total_cost_usd,
        summary: patcherResult.summary,
      },
      metadata: {
        stage: "spec-patcher",
        durationMs,
        patchCount: patcherResult.patches_applied.length,
        iterationCount: patcherResult.iterations.length,
        bestIteration: patcherResult.bestIteration,
        finalQualityScore: patcherResult.finalQualityScore,
      },
      createdAt: new Date(),
    };
  }

  // Fallback: pass through without patching (missing upstream reports)
  const durationMs = Date.now() - startMs;
  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      ifcUrl,
      briefSpec: specParsed?.success ? specParsed.data : null,
      patches_applied: [],
      patch_count: 0,
      iterations: [{
        iteration: 1,
        ifcUrl: ifcUrl ?? "",
        qualityScore: 0,
        parts_coverage: 0,
        trim_coverage: 0,
        entityCount: 0,
        elapsedMs: durationMs,
        costUsd: 0,
      }],
      bestIteration: 1,
      needs_rebuild: false,
      summary: `Pass-through: missing verifier or vision report. (${durationMs}ms)`,
    },
    metadata: { stage: "spec-patcher", durationMs },
    createdAt: new Date(),
  };
};
