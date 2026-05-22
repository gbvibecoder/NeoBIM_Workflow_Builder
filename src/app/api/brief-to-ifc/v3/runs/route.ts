/**
 * POST /api/brief-to-ifc/v3/runs
 *
 * Backgrounded entry point to the v3 pipeline (Phase v3 observability).
 *
 * Lifecycle:
 *   1. Auth + canary + rate-limit gates.
 *   2. Body validation (same shape as /generate — brief OR briefSpec).
 *   3. Create `BriefToIfcV3Run` row in PENDING.
 *   4. Schedule `runBackground(...)` via `after()` from `next/server`
 *      — Vercel keeps the function alive past the response flush so
 *      the agent loop runs to completion. `maxDuration = 800` is a
 *      CEILING, not a keepalive; plain `void runBackground(...)` dies
 *      at the first await. See PHASE_EVAL_RESULTS_REPORT_2026-05-16.md
 *      for the post-mortem. The HTTP response returns 202 immediately
 *      with the run id.
 *   5. Background work: enrichBrief (if needed) -> runGenerator ->
 *      transition COMPLETED|FAILED. All progress lands in
 *      ExecutionLog + the run row.
 *
 * Difference from the existing /generate route:
 *   • /generate is the SYNCHRONOUS eval-harness path — returns the full
 *     result inline. Used by `evals/run.ts` and one-off scripts. NOT
 *     backgrounded; no run row created.
 *   • /runs (THIS route) is the production-shaped path — returns the
 *     run id, the dashboard polls for state, all observability surfaces
 *     light up. This is the one Rutik's UI will use.
 *
 * The two coexist deliberately: eval harness gets sync convenience;
 * production gets async observability.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import type { Prisma } from "@prisma/client";

import {
  briefSpecSchema,
  enrichBrief,
  shouldUseBriefToIfcV3,
  type BriefSpec,
} from "@/features/brief-to-ifc/v3";
import { appendLog } from "@/features/brief-to-ifc/v3/runtime/append-log";
import { scheduleAgentBuildWorker } from "@/lib/qstash";
import {
  checkBriefToIfcV3Quota,
  incrementBriefToIfcV3Usage,
} from "@/features/brief-to-ifc/v3/quota/quota";
// TODO: Re-enable when BriefToIfcV3Run has classifiedArchetype field.
// import { classifyBrief } from "@/features/brief-to-ifc/v3/archetype-classifier";

// Phase gamma.1: Direct Agent Mode — 200 turns can take 10-15 min.
// 800s is the Vercel Fluid Compute Pro ceiling (900 rejected at deploy).
export const maxDuration = 800;

const RATE_LIMIT_PER_HOUR = 10;

const BODY_SCHEMA = z
  .object({
    brief: z.string().min(40).max(20_000).optional(),
    briefSpec: briefSpecSchema.optional(),
    project_type: z
      .enum(["exhibition_booth", "office", "residential", "retail"])
      .optional(),
    max_turns: z.number().int().min(1).max(200).optional(),
    cost_cap_usd: z.number().min(0.1).max(15.0).optional(),
    /** Caller-supplied correlation id (e.g. the workflow id from the
     *  canvas). Not enforced; carried back on the status view. */
    workflow_id: z.string().min(1).max(64).optional(),
    // Phase gamma.1: Direct Agent Mode fields
    /** Verbatim user brief text — passed directly to the agent. */
    brief_text: z.string().max(20_000).optional(),
    /** Advisory suggestions from upstream nodes. */
    suggestions: z.record(z.string(), z.unknown()).optional(),
    /** Plain-English retry hint from previous iteration. */
    previous_feedback: z.string().max(10_000).optional(),
    /** Which iteration this is (1-based). */
    iteration: z.number().int().min(1).max(3).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.brief) || Boolean(v.briefSpec), {
    message: "Either `brief` (free text) or `briefSpec` (pre-enriched) is required.",
  });

const NOT_AVAILABLE_ERROR = {
  title: "Feature not available",
  message: "The v3 AI IFC pipeline is not available for your account.",
  code: "BRIEF_TO_IFC_V3_NOT_AVAILABLE",
} as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  const userId = session.user.id;
  const userEmail = session.user.email ?? null;

  if (!shouldUseBriefToIfcV3(userEmail)) {
    return NextResponse.json(formatErrorResponse(NOT_AVAILABLE_ERROR), {
      status: 403,
    });
  }

  const rl = await checkEndpointRateLimit(
    userId, "brief-to-ifc-v3-runs", RATE_LIMIT_PER_HOUR, "1 h",
  );
  if (!rl.success) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Too many requests",
        message: "You've started too many v3 runs in the last hour.",
        code: "RATE_001",
      }),
      { status: 429 },
    );
  }

  // Per-user monthly quota — separate from the per-hour rate limit.
  // Conservative defaults (FREE=0, MINI=2, STARTER=5, PRO=20, TEAM=999)
  // protect margin: each v3 run costs ~$1.50 in Anthropic spend.
  // PLATFORM_ADMIN / TEAM_ADMIN bypass via the TEAM tier limit (999).
  const role = (session.user as { role?: string }).role ?? "FREE";
  const quota = await checkBriefToIfcV3Quota(prisma, userId, role);
  if (!quota.ok) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Monthly quota exceeded",
        message: quota.message ?? "Monthly run limit reached.",
        code: quota.errorCode ?? "QUOTA_EXCEEDED",
      }),
      { status: 429 },
    );
  }

  let body: z.infer<typeof BODY_SCHEMA>;
  try {
    const json = await req.json();
    const parsed = BODY_SCHEMA.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Invalid request",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
            .join("; "),
          code: "INVALID_INPUT",
        }),
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(formatErrorResponse(UserErrors.INVALID_INPUT), {
      status: 400,
    });
  }

  // The run row needs a BriefSpec for the snapshot. If the caller gave
  // a pre-enriched briefSpec we use it directly; otherwise we run Layer
  // 1 SYNCHRONOUSLY here (cheap call, ~30 s) so the row's snapshot is
  // ground truth before background work begins. Doing Layer 1 inside
  // the background would leave a window where the run is RUNNING with
  // an empty briefSpec — confusing for the diagnostic CLI.
  let briefSpec: BriefSpec;
  let enrichmentCostUsd = 0;
  let enrichmentDurationMs = 0;

  if (body.briefSpec) {
    briefSpec = body.briefSpec;
  } else if (body.brief) {
    const enrichment = await enrichBrief({
      brief: body.brief,
      projectType: body.project_type,
    });
    enrichmentCostUsd = enrichment.costUsd;
    enrichmentDurationMs = enrichment.durationMs;
    if (!enrichment.ok || !enrichment.brief) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Brief enrichment failed",
          message: enrichment.error?.message ?? "Unknown error",
          code: enrichment.error?.code ?? "ENRICHMENT_FAILED",
        }),
        { status: 500 },
      );
    }
    briefSpec = enrichment.brief;
  } else {
    return NextResponse.json(
      formatErrorResponse(UserErrors.INVALID_INPUT),
      { status: 400 },
    );
  }

  // NOTE: Item decomposition (TR-028) is NOT called here. The canvas
  // flow runs TR-028 before TR-026 (which calls this route). The
  // standalone API path expects the caller to pass an already-decomposed
  // briefSpec (or accepts a raw spec — the agent builder handles both
  // cases via the Section 4b fallback in its system prompt).

  // Create the run row in PENDING. The row's existence is the
  // observability anchor — the diagnostic CLI keys off `id` here.
  const run = await prisma.briefToIfcV3Run.create({
    data: {
      userId,
      workflowId: body.workflow_id ?? null,
      status: "PENDING",
      briefSpec: briefSpec as unknown as Prisma.InputJsonValue,
      enrichmentCostUsd: enrichmentCostUsd > 0 ? enrichmentCostUsd : null,
      enrichmentMs: enrichmentDurationMs > 0 ? enrichmentDurationMs : null,
      costCapUsd: body.cost_cap_usd,
    },
    select: { id: true, createdAt: true, status: true },
  });

  // Increment monthly quota counter AFTER the row creation succeeds.
  // If this fails (e.g. transient DB error), the run is still created
  // — better to over-allow a single run than fail an already-confirmed
  // submission. The next request will see the un-incremented counter
  // and re-check. Atomicity isn't strict here because the quota check
  // is run-creation pre-flight, not a hard accounting boundary.
  await incrementBriefToIfcV3Usage(prisma, userId).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[bf-v3 quota] increment failed for ${userId}:`, err);
  });

  await appendLog(prisma, {
    executionId: run.id, level: "INFO", source: "LIFECYCLE",
    message: `Run created (briefSpec snapshot persisted). Background work dispatching.`,
    metadata: {
      hasEnrichment: enrichmentCostUsd > 0,
      enrichmentCostUsd, enrichmentDurationMs,
      maxTurns: body.max_turns ?? null,
      costCapUsd: body.cost_cap_usd ?? null,
    },
  });

  // Phase gamma.2: dispatch via QStash instead of after().
  // QStash POSTs to /api/brief-to-ifc/v3/agent-job with { runId }.
  // The worker runs in its OWN Vercel invocation (800s budget per
  // invocation, uncapped from the user's perspective). The frontend
  // polls /runs/{id}/status rather than holding a synchronous request.
  //
  // Why not after(): after() is still bound by this route's maxDuration.
  // The agent needs 15-25 min. QStash gives each invocation a fresh
  // Vercel budget.
  try {
    // Phase gamma.3: pass the full γ.1 Direct Agent Mode payload
    const messageId = await scheduleAgentBuildWorker({
      runId: run.id,
      briefText: body.brief_text,
      suggestions: body.suggestions as Record<string, unknown> | undefined,
      previousFeedback: body.previous_feedback,
      iteration: body.iteration,
    });
    await appendLog(prisma, {
      executionId: run.id, level: "INFO", source: "LIFECYCLE",
      message: `QStash worker dispatched (messageId: ${messageId}).`,
    });
  } catch (err) {
    // QStash dispatch failed — mark the run as failed immediately
    // so the frontend doesn't poll forever.
    const errMsg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[bf-v3 /runs] QStash dispatch failed for ${run.id}:`, errMsg);
    await prisma.briefToIfcV3Run.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorCode: "QSTASH_DISPATCH_FAILED",
        errorMessage: `Worker dispatch failed: ${errMsg.slice(0, 500)}`,
        completedAt: new Date(),
      },
    }).catch(() => {});
  }

  return NextResponse.json(
    {
      runId: run.id,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      statusUrl: `/api/brief-to-ifc/v3/runs/${run.id}/status`,
      logsUrl: `/api/brief-to-ifc/v3/runs/${run.id}/logs`,
    },
    {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
