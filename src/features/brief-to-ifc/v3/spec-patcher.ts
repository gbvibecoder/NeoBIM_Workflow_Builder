/**
 * Spec Patcher (TR-033, Phase Beta 3).
 *
 * Combines Hard Verifier mismatches + Vision Inspector issues into a
 * patch decision. If the quality is below threshold, generates patches
 * via Opus and applies them to the spec.
 *
 * The orchestration of iterative rebuilds is handled by the TR-033
 * handler — this module focuses on the patch-generation logic.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { specPatchSchema } from "./types";
import type { BriefSpec, VerifierReport, VisionReport, SpecPatch } from "./types";
import { applyPatches } from "./apply-patches";
import { pusherTrigger } from "@/lib/pusher-server";

// ─── Constants ──────────────────────────────────────────────────────────

const PATCHER_MODEL = "claude-opus-4-7";
const OPUS_INPUT_COST_PER_MILLION = 5;
const OPUS_OUTPUT_COST_PER_MILLION = 25;
const MAX_TOKENS = 4_000;
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_PATCHES = 12;

// ─── Prompt ─────────────────────────────────────────────────────────────

// Inline const — canonical .md copy at `./spec-patcher-prompt.md`.
// MUST stay byte-equal to that file.
export const SPEC_PATCHER_PROMPT_TEMPLATE: string = `You are a spec-patcher for a self-correcting IFC build pipeline. The agent just built an IFC. Two reports came back:

1. HARD VERIFIER REPORT — deterministic comparison of spec vs actual IFC. Reports missing parts, missing aggregations, missing trim, size mismatches with severity.

2. VISION INSPECTOR REPORT — Opus-with-vision rated the rendered IFC against the brief. Reports quality_score, issues with severity.

Your job: emit a JSON array of patches that, when applied to the spec, will guide the agent to fix the issues on the next rebuild. Output ONLY the JSON array. First character must be "[".

Patch types and when to use:

force_parts:
  Use when: missing_parts OR missing_aggregation mismatch from verifier, OR "collapsed" issue from vision (severity med+).
  Required payload: { "item_id": "...", "minimum_parts_count": N, "sample_part_subtypes": ["..."] }

add_position:
  Use when: vision says "item in wrong place" OR designRationale wasn't used.
  Required payload: { "item_id": "...", "position": [x,y,z], "rotation_z_rad": N, "rationale": "why" }

fix_size:
  Use when: size_mismatch from verifier OR "wrong proportions" from vision.
  Required payload: { "item_id": "...", "dims_m": [w,d,h] }

add_trim:
  Use when: missing_trim mismatch from verifier.
  Required payload: { "trim_item": { "id": "...", "type": "...", "hostId": "...", "dims_m": [w,d,h], "material_id": "...", "ifc_class": "..." } }

increase_decomposition:
  Use when: parts_coverage in verifier < 0.6 AND item has parts but few.
  Required payload: { "item_id": "...", "current_part_count": N, "target_part_count": N, "rationale": "why" }

PATCHING RULES:
- One patch per identified issue
- Do not emit duplicate patches for the same item_id and patch_type
- Prefer force_parts when collapse is observed (it is the strongest fix)
- For size_mismatch: only patch if mismatch > 0.2m
- Maximum 12 patches total
- If no patches are needed (verifier verified=true AND quality_score >= 75), return an empty array []

Now produce the patch array for the inputs below.`;

// ─── Types ──────────────────────────────────────────────────────────────

export interface PatchDecision {
  needsPatch: boolean;
  reason: string;
  patches: SpecPatch[];
  patchedSpec: BriefSpec;
  costUsd: number;
}

export interface PatchOptions {
  qualityThreshold?: number;       // default 75
  partsThreshold?: number;         // default 0.85
  costBudget?: number;             // default 0.50
  clientFactory?: () => Anthropic;
  timeoutMs?: number;
}

// ─── Patch decision ─────────────────────────────────────────────────────

/**
 * Decide whether patches are needed and generate them if so.
 */
export async function decidePatchesAndApply(
  spec: BriefSpec,
  verifierReport: VerifierReport,
  visionReport: VisionReport,
  options?: PatchOptions,
): Promise<PatchDecision> {
  const qualityThreshold = options?.qualityThreshold ?? 75;
  const partsThreshold = options?.partsThreshold ?? 0.85;

  // Check if retry is needed
  const needsRetry =
    visionReport.quality_score < qualityThreshold ||
    verifierReport.parts_coverage < partsThreshold ||
    verifierReport.mismatches.some(m => m.severity === "high");

  if (!needsRetry) {
    return {
      needsPatch: false,
      reason: `Quality ${visionReport.quality_score} >= ${qualityThreshold}, parts_coverage ${verifierReport.parts_coverage} >= ${partsThreshold}`,
      patches: [],
      patchedSpec: spec,
      costUsd: 0,
    };
  }

  // Generate patches via Opus
  const patches = await generatePatches(
    spec,
    verifierReport,
    visionReport,
    options,
  );

  // Apply patches to spec
  const patchedSpec = patches.length > 0 ? applyPatches(spec, patches) : spec;

  return {
    needsPatch: patches.length > 0,
    reason: `Quality ${visionReport.quality_score} < ${qualityThreshold} or parts_coverage ${verifierReport.parts_coverage} < ${partsThreshold}`,
    patches,
    patchedSpec,
    costUsd: 0, // updated by caller
  };
}

// ─── Patch generation via Opus ──────────────────────────────────────────

async function generatePatches(
  spec: BriefSpec,
  verifierReport: VerifierReport,
  visionReport: VisionReport,
  options?: PatchOptions,
): Promise<SpecPatch[]> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let client: Anthropic;
  try {
    client = options?.clientFactory
      ? options.clientFactory()
      : createAnthropicClient();
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[spec-patcher] Anthropic client unavailable — returning deterministic patches.");
    return generateDeterministicPatches(verifierReport, visionReport);
  }

  const userMessage = JSON.stringify({
    verifierReport: {
      verified: verifierReport.verified,
      parts_coverage: verifierReport.parts_coverage,
      trim_coverage: verifierReport.trim_coverage,
      mismatches: verifierReport.mismatches,
    },
    visionReport: {
      quality_score: visionReport.quality_score,
      issues: visionReport.issues,
    },
    furniture_summary: (spec.furniture ?? []).map(f => ({
      id: f.id,
      type: f.type,
      parts_count: f.parts?.length ?? 0,
    })),
  }, null, 2);

  try {
    const stream = client.messages.stream(
      {
        model: PATCHER_MODEL,
        max_tokens: MAX_TOKENS,
        system: SPEC_PATCHER_PROMPT_TEMPLATE,
        messages: [{ role: "user", content: userMessage }],
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    const message = await stream.finalMessage();

    const textBlocks = message.content.filter(
      (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
    );
    const raw = textBlocks.map(b => b.text).join("").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return generateDeterministicPatches(verifierReport, visionReport);
      parsed = JSON.parse(match[0]);
    }

    if (!Array.isArray(parsed)) return generateDeterministicPatches(verifierReport, visionReport);

    const validated: SpecPatch[] = [];
    const seenKeys = new Set<string>();
    for (const entry of parsed) {
      const result = specPatchSchema.safeParse(entry);
      if (result.success) {
        const key = `${result.data.item_id}:${result.data.patch_type}`;
        if (!seenKeys.has(key)) {
          validated.push(result.data);
          seenKeys.add(key);
        }
      }
      if (validated.length >= MAX_PATCHES) break;
    }

    return validated;
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[spec-patcher] Opus call failed — falling back to deterministic patches.");
    return generateDeterministicPatches(verifierReport, visionReport);
  }
}

// ─── Deterministic fallback patches ─────────────────────────────────────

function generateDeterministicPatches(
  verifierReport: VerifierReport,
  visionReport: VisionReport,
): SpecPatch[] {
  const patches: SpecPatch[] = [];
  const seenKeys = new Set<string>();

  // From verifier mismatches
  for (const mm of verifierReport.mismatches) {
    if (mm.type === "missing_parts" || mm.type === "missing_aggregation") {
      const key = `${mm.item_id}:force_parts`;
      if (!seenKeys.has(key)) {
        patches.push({
          item_id: mm.item_id,
          patch_type: "force_parts",
          rationale: mm.description,
          payload: { item_id: mm.item_id, minimum_parts_count: mm.expected },
        });
        seenKeys.add(key);
      }
    } else if (mm.type === "missing_trim") {
      const key = `${mm.item_id}:add_trim`;
      if (!seenKeys.has(key)) {
        patches.push({
          item_id: mm.item_id,
          patch_type: "add_trim",
          rationale: mm.description,
          payload: { trim_item: { id: mm.item_id, type: "skirting", hostId: mm.item_id, material_id: "default" } },
        });
        seenKeys.add(key);
      }
    }
    if (patches.length >= MAX_PATCHES) break;
  }

  // From vision issues
  for (const issue of visionReport.issues) {
    if (patches.length >= MAX_PATCHES) break;
    if (issue.type === "collapsed" && issue.affected_element) {
      const key = `${issue.affected_element}:force_parts`;
      if (!seenKeys.has(key)) {
        patches.push({
          item_id: issue.affected_element,
          patch_type: "force_parts",
          rationale: issue.description,
          payload: { item_id: issue.affected_element, minimum_parts_count: 3 },
        });
        seenKeys.add(key);
      }
    }
  }

  return patches;
}

// ─── Iterative rebuild loop ──────────────────────────────────────────────

export interface PatchAndIterateInputs {
  spec: BriefSpec;
  currentResult: import("./agent-rebuild-orchestrator").RebuildIterationResult;
  runId: string;
}

export interface PatchAndIterateOptions {
  maxIterations?: number;       // default 2 (up to 3 total agent runs)
  qualityThreshold?: number;    // default 75
  partsThreshold?: number;      // default 0.85
  costBudgetUsd?: number;       // default 0.50
  timeoutMs?: number;           // default 600_000 (10 min)
  /** HTTP origin for agent build. */
  origin?: string;
  /** Cookie for auth forwarding. */
  cookie?: string;
  /** Override rebuild function (for tests). */
  rebuildFn?: (spec: BriefSpec, opts: import("./agent-rebuild-orchestrator").RebuildOptions) =>
    Promise<import("./agent-rebuild-orchestrator").RebuildIterationResult>;
  /** Override patch generation (for tests). */
  patchFn?: (verifierMismatches: VerifierReport["mismatches"], visionIssues: VisionReport["issues"], spec: BriefSpec) => Promise<SpecPatch[]>;
  /** Callback for progress streaming (Pusher). */
  onIterationComplete?: (result: import("./agent-rebuild-orchestrator").RebuildIterationResult) => void;
}

/**
 * Core iterative rebuild loop. Takes the initial build result,
 * decides if patches are needed, and re-invokes the agent up to
 * maxIterations times to achieve a higher-quality IFC.
 */
export async function patchAndIterate(
  inputs: PatchAndIterateInputs,
  options: PatchAndIterateOptions = {},
): Promise<import("./types").PatcherResult> {
  const maxIterations = options.maxIterations ?? 2;
  const qualityThreshold = options.qualityThreshold ?? 75;
  const partsThreshold = options.partsThreshold ?? 0.85;
  const costBudget = options.costBudgetUsd ?? 0.50;
  const startMs = Date.now();

  const iterations: import("./agent-rebuild-orchestrator").RebuildIterationResult[] = [inputs.currentResult];
  const allPatches: SpecPatch[] = [];
  let totalCost = inputs.currentResult.costUsd;
  let bestIdx = 0; // 0-indexed
  let currentSpec = inputs.spec;

  for (let i = 0; i < maxIterations; i++) {
    const best = iterations[bestIdx];

    // Check if quality is already good enough
    if (best.qualityScore >= qualityThreshold &&
        best.partsCoverage >= partsThreshold &&
        !best.verifierMismatches.some(m => m.severity === "high")) {
      break;
    }

    // Cost cap check
    if (totalCost >= costBudget) {
      // eslint-disable-next-line no-console
      console.warn(`[patchAndIterate] Cost cap reached: $${totalCost.toFixed(3)} >= $${costBudget}`);
      break;
    }

    // Generate patches
    const patchFn = options.patchFn ?? (async (mm, vi, s) =>
      generateDeterministicPatches({ verified: false, parts_coverage: best.partsCoverage, trim_coverage: best.trimCoverage, mismatches: mm, summary: "", verified_at: "" }, { quality_score: best.qualityScore, pass: false, issues: vi, summary: "", inspected_at: "" })
    );
    const patches = await patchFn(best.verifierMismatches, best.visionIssues, currentSpec);

    if (patches.length === 0) {
      break; // Nothing to patch
    }

    // Apply patches
    const patchedSpec = applyPatches(currentSpec, patches);
    allPatches.push(...patches);
    currentSpec = patchedSpec;

    const nextIteration = iterations.length + 1;
    const channel = `private-bf-v3-${inputs.runId}`;

    // Pusher: iteration starting (fire-and-forget, never breaks iteration)
    try {
      await pusherTrigger(channel, "iteration-start", {
        iteration: nextIteration,
        totalPlanned: maxIterations + 1,
        patchCount: patches.length,
        timestamp: new Date().toISOString(),
      });
    } catch { /* Pusher emit must never break the iteration loop */ }

    // Rebuild
    const rebuildFn = options.rebuildFn ??
      (async (s: BriefSpec, o: import("./agent-rebuild-orchestrator").RebuildOptions) => {
        const { rebuildAgentPipeline } = await import("./agent-rebuild-orchestrator");
        return rebuildAgentPipeline(s, o);
      });

    const newResult = await rebuildFn(patchedSpec, {
      iteration: nextIteration,
      previousResult: best,
      runId: inputs.runId,
      origin: options.origin,
      cookie: options.cookie,
    });

    iterations.push(newResult);
    totalCost += newResult.costUsd;

    // Update best if new is better
    const isBest = newResult.qualityScore > iterations[bestIdx].qualityScore;
    if (isBest) {
      bestIdx = iterations.length - 1;
    }

    // Pusher: iteration completed (fire-and-forget)
    try {
      await pusherTrigger(channel, "iteration-complete", {
        iteration: nextIteration,
        qualityScore: newResult.qualityScore,
        partsCoverage: newResult.partsCoverage,
        trimCoverage: newResult.trimCoverage,
        entityCount: newResult.entityCount,
        elapsedMs: newResult.elapsedMs,
        costUsd: newResult.costUsd,
        isBest,
      });
    } catch { /* Pusher emit must never break the iteration loop */ }

    // Notify listener
    options.onIterationComplete?.(newResult);
  }

  const bestResult = iterations[bestIdx];
  const totalElapsedMs = Date.now() - startMs;

  // Pusher: final result (fire-and-forget)
  if (iterations.length > 1) {
    try {
      await pusherTrigger(`private-bf-v3-${inputs.runId}`, "iteration-final", {
        bestIteration: bestIdx + 1,
        finalQualityScore: bestResult.qualityScore,
        totalIterations: iterations.length,
        patchesApplied: allPatches.length,
        totalCostUsd: totalCost,
        totalElapsedMs,
      });
    } catch { /* fire-and-forget */ }
  }

  return {
    finalIfcUrl: bestResult.ifcUrl,
    finalQualityScore: bestResult.qualityScore,
    finalEntityCount: bestResult.entityCount,
    iterations: iterations.map((r, idx) => ({
      iteration: idx + 1,
      ifcUrl: r.ifcUrl,
      qualityScore: r.qualityScore,
      parts_coverage: r.partsCoverage,
      trim_coverage: r.trimCoverage,
      entityCount: r.entityCount,
      elapsedMs: r.elapsedMs,
      costUsd: r.costUsd,
    })),
    bestIteration: bestIdx + 1,
    patches_applied: allPatches,
    total_cost_usd: totalCost,
    total_elapsed_ms: totalElapsedMs,
    summary: `Iterated ${iterations.length} time${iterations.length === 1 ? "" : "s"}, best=#${bestIdx + 1} quality ${bestResult.qualityScore}/100`,
  };
}

// ─── Anthropic client ───────────────────────────────────────────────────

function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  return isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic({ apiKey });
}
