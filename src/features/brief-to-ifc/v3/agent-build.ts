/**
 * Callable Agent Build — programmatic wrapper around the brief-to-IFC
 * v3 runs endpoint for use by the iterative rebuild orchestrator (TR-033).
 *
 * Uses the same HTTP → poll pattern as the TR-026 canvas handler, but
 * returns structured metrics suitable for iteration comparison.
 *
 * Phase gamma.1 (Direct Agent Mode): the agent now receives the
 * original brief verbatim, upstream suggestions as advisory context,
 * and plain-English retry hints on iteration 2+. The spec is still
 * passed but the brief is the primary input.
 *
 * @module
 */

import type { BriefSpec, AgentInputSuggestions } from "./types";
import type { VerifierMismatch, VisionIssue } from "./types";
import { AGENT_MAX_TURNS_DIRECT_MODE } from "./constants";

// ─── Types ──────────────────────────────────────────────────────────────

export interface RunAgentBuildOptions {
  /** Verbatim user brief text. Phase gamma.1: primary agent input. */
  briefText?: string;
  /** Advisory suggestions from upstream analysis nodes. */
  suggestions?: AgentInputSuggestions;
  /** Plain-English retry hint from previous iteration (Phase gamma.1). */
  previousFeedback?: string;
  /** Which iteration this is (1-based). Default 1. */
  iteration?: number;
  /** Max agent turns. Default AGENT_MAX_TURNS_DIRECT_MODE (200). */
  maxTurns?: number;
  /** IFC URL from the previous attempt (for observability). */
  previousAttemptUrl?: string;
  /** Mismatches from the previous hard verifier run. */
  previousMismatches?: VerifierMismatch[];
  /** Vision issues from the previous inspection. */
  previousVisionIssues?: VisionIssue[];
  /** Correlation ID for observability. */
  runId?: string;
  /** Override origin URL (for tests). */
  origin?: string;
  /** Override cookie (for auth forwarding). */
  cookie?: string;
  /** Override polling timeout in ms. Default 500_000. */
  pollTimeoutMs?: number;
  /** Cost cap in USD for the agent run. */
  costCapUsd?: number;
}

export interface RunAgentBuildResult {
  ifcUrl: string;
  runId: string;
  entityCount: number;
  turns: number;
  costUsd: number;
  elapsedMs: number;
  /** Summary of which MUST_BUILD flags were in the spec (for debugging). */
  retryContext: string;
}

// ─── Internal types (matching /api/brief-to-ifc/v3/runs responses) ──────

interface RunsCreateResponse {
  runId: string;
  status: "PENDING" | "RUNNING";
  statusUrl: string;
}

interface RunStatusView {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  ifcUrl: string | null;
  entityCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  generatorCostUsd: number;
  generatorMs: number;
  turns: number;
}

// ─── Constants ──────────────────────────────────────────────────────────

const POLL_INITIAL_MS = 3_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_INTERVAL_MS = 8_000;
const DEFAULT_POLL_TIMEOUT_MS = 500_000;

// ─── Helpers ────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildRetryContext(options: RunAgentBuildOptions): string {
  const parts: string[] = [];
  if (options.iteration && options.iteration > 1) {
    parts.push(`Iteration ${options.iteration}`);
  }
  if (options.previousAttemptUrl) {
    parts.push(`Previous IFC: ${options.previousAttemptUrl.slice(0, 60)}`);
  }
  const flaggedItems = [] as string[];
  if (options.previousMismatches?.length) {
    for (const m of options.previousMismatches) {
      if (m.type === "missing_parts" || m.type === "missing_aggregation") {
        flaggedItems.push(`${m.item_id} (${m.type})`);
      }
    }
  }
  if (flaggedItems.length > 0) {
    parts.push(`Flagged items: ${flaggedItems.join(", ")}`);
  }
  return parts.join("; ") || "First iteration";
}

// ─── Main entry point ───────────────────────────────────────────────────

/**
 * Run a single agent build via the /api/brief-to-ifc/v3/runs endpoint.
 *
 * The spec may carry must_build/force_parts flags from the Spec Patcher
 * — the agent's Section 4f enforces them during the build.
 */
export async function runAgentBuild(
  spec: BriefSpec,
  options: RunAgentBuildOptions = {},
): Promise<RunAgentBuildResult> {
  const origin = options.origin ?? "";
  const cookie = options.cookie ?? "";
  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const retryContext = buildRetryContext(options);
  const startedAt = Date.now();

  // eslint-disable-next-line no-console
  console.info(
    `[agent-build] Starting — iteration=${options.iteration ?? 1}, ` +
    `briefText=${options.briefText ? `${options.briefText.length}ch` : "absent"}, ` +
    `retry_context="${retryContext}"`,
  );

  // 1. Submit run
  const body: Record<string, unknown> = { briefSpec: spec };
  if (options.maxTurns) body.max_turns = options.maxTurns;
  if (options.costCapUsd) body.cost_cap_usd = options.costCapUsd;
  // Phase gamma.1: Direct Agent Mode — pass verbatim brief, suggestions, feedback
  if (options.briefText) body.brief_text = options.briefText;
  if (options.suggestions) body.suggestions = options.suggestions;
  if (options.previousFeedback) body.previous_feedback = options.previousFeedback;
  if (options.iteration) body.iteration = options.iteration;

  const createRes = await fetch(`${origin}/api/brief-to-ifc/v3/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    const payload = (await createRes.json().catch(() => ({}))) as {
      error?: { message?: string; code?: string };
    };
    throw new Error(
      `Agent run submission failed (HTTP ${createRes.status}): ` +
      `${payload.error?.message ?? "unknown"} (${payload.error?.code ?? "?"})`,
    );
  }
  const created = (await createRes.json()) as RunsCreateResponse;

  // 2. Poll status until terminal
  await delay(POLL_INITIAL_MS);

  const pollStart = Date.now();
  let interval = POLL_INTERVAL_MS;
  let last: RunStatusView | null = null;

  while (Date.now() - pollStart < pollTimeoutMs) {
    const statusRes = await fetch(
      `${origin}/api/brief-to-ifc/v3/runs/${created.runId}/status`,
      { headers: { cookie } },
    );
    if (!statusRes.ok) {
      if (statusRes.status >= 500) {
        await delay(interval);
        interval = Math.min(POLL_MAX_INTERVAL_MS, interval + 1_000);
        continue;
      }
      throw new Error(
        `Run status polling failed (HTTP ${statusRes.status}) for run ${created.runId}.`,
      );
    }
    last = (await statusRes.json()) as RunStatusView;
    if (last.status === "COMPLETED" || last.status === "FAILED" || last.status === "CANCELLED") {
      break;
    }
    await delay(interval);
    interval = Math.min(POLL_MAX_INTERVAL_MS, interval + 500);
  }

  if (!last) {
    throw new Error(`Agent run ${created.runId} produced no status within polling window.`);
  }

  if (last.status !== "COMPLETED" || !last.ifcUrl) {
    throw new Error(
      `Agent run ${created.runId} ended with status=${last.status}` +
      (last.errorMessage ? `: ${last.errorMessage}` : ""),
    );
  }

  const elapsedMs = Date.now() - startedAt;

  // eslint-disable-next-line no-console
  console.info(
    `[agent-build] Done — iteration=${options.iteration ?? 1}, ` +
    `entities=${last.entityCount ?? 0}, turns=${last.turns}, ` +
    `cost=$${last.generatorCostUsd.toFixed(3)}, elapsed=${elapsedMs}ms`,
  );

  return {
    ifcUrl: last.ifcUrl,
    runId: last.id,
    entityCount: last.entityCount ?? 0,
    turns: last.turns,
    costUsd: last.generatorCostUsd,
    elapsedMs,
    retryContext,
  };
}
