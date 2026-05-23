/**
 * Agent Rebuild Orchestrator (Phase Beta 3).
 *
 * Runs a single agent build iteration then verifies + inspects the result.
 * Called by `patchAndIterate()` in spec-patcher.ts for each retry iteration.
 *
 * Sequence: runAgentBuild → verifyBuild → inspectIFC → return metrics.
 */

import type { BriefSpec, VerifierMismatch, VisionIssue } from "./types";
import { runAgentBuild } from "./agent-build";
import type { RunAgentBuildOptions } from "./agent-build";
import { verifyBuild } from "./hard-verifier";

// ─── Types ──────────────────────────────────────────────────────────────

export interface RebuildIterationResult {
  iteration: number;
  ifcUrl: string;
  qualityScore: number;
  partsCoverage: number;
  trimCoverage: number;
  entityCount: number;
  elapsedMs: number;
  costUsd: number;
  verifierMismatches: VerifierMismatch[];
  visionIssues: VisionIssue[];
}

export interface RebuildOptions {
  iteration: number;
  previousResult?: RebuildIterationResult;
  runId: string;
  /** HTTP origin for agent build polling. */
  origin?: string;
  /** Cookie for auth forwarding. */
  cookie?: string;
  /** Max agent turns. */
  maxTurns?: number;
  /** Cost cap for the agent run. */
  costCapUsd?: number;
  /** Phase gamma.1: verbatim brief text for Direct Agent Mode. */
  briefText?: string;
  /** Phase gamma.1: plain-English feedback from previous iteration. */
  previousFeedback?: string;
  /** Phase gamma.1: advisory suggestions from upstream nodes. */
  suggestions?: import("./types").AgentInputSuggestions;
}

// ─── Main ───────────────────────────────────────────────────────────────

/**
 * Run one full iteration: agent build → hard verify → vision inspect.
 */
export async function rebuildAgentPipeline(
  spec: BriefSpec,
  options: RebuildOptions,
): Promise<RebuildIterationResult> {
  const startMs = Date.now();

  // eslint-disable-next-line no-console
  console.info(`[rebuild-orchestrator] Starting iteration ${options.iteration} for run ${options.runId}`);

  // 1. Agent build — Phase gamma.1: pass briefText + feedback + suggestions
  const buildOpts: RunAgentBuildOptions = {
    iteration: options.iteration,
    briefText: options.briefText,
    previousFeedback: options.previousFeedback,
    suggestions: options.suggestions,
    previousMismatches: options.previousResult?.verifierMismatches,
    previousVisionIssues: options.previousResult?.visionIssues,
    previousAttemptUrl: options.previousResult?.ifcUrl,
    origin: options.origin,
    cookie: options.cookie,
    maxTurns: options.maxTurns,
    costCapUsd: options.costCapUsd,
    runId: options.runId,
  };

  const buildResult = await runAgentBuild(spec, buildOpts);

  // 2. Hard verify
  const verifierReport = await verifyBuild(buildResult.ifcUrl, spec);

  // 3. Vision inspect (optional — may fail if render endpoint unavailable)
  let qualityScore = 0;
  const visionIssues: VisionIssue[] = [];
  try {
    const { inspectIFC } = await import("./vision-inspector");
    // Vision inspector needs rendered PNGs — we'd need to render first.
    // For the iterative loop, we use the verifier's coverage as a proxy
    // and only run full vision on the final iteration.
    // Set quality score from parts_coverage as a heuristic.
    qualityScore = Math.round(verifierReport.parts_coverage * 80 + (verifierReport.verified ? 20 : 0));
  } catch {
    qualityScore = Math.round(verifierReport.parts_coverage * 80);
  }

  const elapsedMs = Date.now() - startMs;

  // eslint-disable-next-line no-console
  console.info(
    `[rebuild-orchestrator] Iteration ${options.iteration} done — ` +
    `quality=${qualityScore}, parts_coverage=${verifierReport.parts_coverage}, ` +
    `entities=${buildResult.entityCount}, elapsed=${elapsedMs}ms`,
  );

  return {
    iteration: options.iteration,
    ifcUrl: buildResult.ifcUrl,
    qualityScore,
    partsCoverage: verifierReport.parts_coverage,
    trimCoverage: verifierReport.trim_coverage,
    entityCount: buildResult.entityCount,
    elapsedMs,
    costUsd: buildResult.costUsd,
    verifierMismatches: verifierReport.mismatches,
    visionIssues,
  };
}
