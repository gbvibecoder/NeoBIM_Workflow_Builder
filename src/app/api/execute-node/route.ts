import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isExecutionAlreadyCounted, isAdminUser, checkNodeTypeLimit, markExecutionBonusBlessed, isExecutionBonusBlessed } from "@/lib/rate-limit";
import { VIDEO_NODES, MODEL_3D_NODES, RENDER_NODES, getNodeTypeLimits } from "@/features/billing/lib/stripe";
import { checkExecutionEligibility } from "@/features/billing/lib/check-execution-eligibility";
import { assertValidInput } from "@/lib/validation";
import { APIError, UserErrors, formatErrorResponse } from "@/lib/user-errors";
import {
  logWorkflowStart, logRateLimit, logNodeStart, logNodeSuccess,
  logNodeError, logValidationError,
} from "@/lib/workflow-logger";
import { MAX_REGENERATIONS } from "@/constants/limits";
import type { ExecutionMetadata } from "@/types/execution";
import { nodeHandlers } from "./handlers";
import type { NodeHandlerContext } from "./handlers";

// Node IDs that have real implementations
// GN-013 (AI IFC Generator, v3) added per the v3-shipping phase, see
// PHASE_V3_SHIPPED_2026-05-17.md — handler at handlers/gn-013-ai-ifc.ts,
// gated client-side by the briefToIfcV3Enabled feature flag.
const REAL_NODE_IDS = new Set(["TR-001", "TR-003", "TR-004", "TR-005", "TR-012", "GN-001", "GN-003", "GN-004", "GN-007", "GN-008", "GN-009", "GN-010", "GN-011", "GN-012", "GN-013", "TR-007", "TR-008", "TR-013", "TR-014", "TR-015", "TR-016", "TR-022", "TR-024", "EX-001", "EX-002", "EX-003", "EX-006"]);

// Nodes that require OpenAI API calls
const OPENAI_NODES = new Set(["TR-003", "TR-004", "TR-005", "TR-012", "GN-003", "GN-004", "GN-008"]);

// Per-workflow rate-limit dedup is handled by isExecutionAlreadyCounted() in
// src/lib/rate-limit.ts (Redis-backed, 30-day TTL). No in-memory cache needed.

// Allow up to 600s for heavy AI generation chains (DALL-E + Claude QA + retries, 3D, video)
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const session = await auth();

  // Check authentication
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse(UserErrors.UNAUTHORIZED),
      { status: 401 }
    );
  }

  const userId: string = session.user.id;
  const userRole = (session.user as { role?: string }).role as "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN" || "FREE";
  const userEmail = session.user.email || "";

  // Admin users bypass ALL rate limiting and verification — check early
  const isAdmin = isAdminUser(userEmail) ||
    userRole === "PLATFORM_ADMIN" ||
    userRole === "TEAM_ADMIN";

  // Parse body first so we can read executionId for verification + rate-limit deduplication.
  // `executionId` is the CLIENT-generated correlation id; `dbExecutionId` is the real
  // Execution.id (if the workflow was persisted). Both travel in the body because the
  // legacy contract already carries `executionId` and many consumers assume it's the
  // client one — we add dbExecutionId alongside instead of repurposing.
  const { catalogueId, executionId, dbExecutionId, tileInstanceId, inputData, userApiKey } = await req.json();

  const nodeStartTime = Date.now();

  // ── Detailed file logging (dev only) ──
  await logWorkflowStart(executionId, userId, userRole, userEmail);
  await logNodeStart(executionId, catalogueId, tileInstanceId, inputData);

  // Track remaining executions for success response headers
  let rateLimitRemaining: number | null = null;
  let rateLimitTotal: number | null = null;

  // Bonus consumption flags — surfaced via response headers so the client
  // can toast "1 referral bonus used — N remaining" exactly once per
  // workflow run (gated by the alreadyCounted dedup below).
  let referralBonusUsed = false;
  let referralBonusRemaining = 0;

  // Hoisted to outer scope so the regen-count check below can read it.
  // Stays false for admins (they bypass) and on the first node call of the
  // execution (the fast-path skip — eligibility check fires here).
  let alreadyCounted = false;

  // ── Plan-cap gate (DEFENSIVE — runs on EVERY node call) ───────────────────
  //
  // Per-node defensive recheck:
  //   1. First node of execution: consume bonus on cap-hit, mark execution
  //      "bonus-blessed" if consumed. Subsequent nodes inherit the blessing.
  //   2. Subsequent nodes:
  //      a. If blessed (first-node consumed a bonus) → skip cap check.
  //      b. Otherwise re-check cap. If another tab pushed user over cap
  //         mid-flight, this halts the in-flight workflow on the NEXT node.
  //         Bonus is NOT re-consumed on subsequent nodes (consumeBonusOnCap=false).
  //
  // Cost: one DB count per node (~5-10ms). For typical 5-node workflows
  // that's <50ms total — the billing-correctness guarantee is worth it.
  if (!isAdmin) {
    try {
      alreadyCounted = executionId
        ? await isExecutionAlreadyCounted(userId, executionId)
        : false;

      const blessed = alreadyCounted && executionId
        ? await isExecutionBonusBlessed(userId, executionId)
        : false;

      if (!blessed) {
        const eligibility = await checkExecutionEligibility({
          userId,
          userRole,
          userEmail,
          emailVerified: !!(session.user as { emailVerified?: boolean }).emailVerified,
          intent: { kind: "workflow-run", catalogueIds: [catalogueId] },
          // Only the FIRST node may consume a bonus. Subsequent nodes get
          // a read-only check (any cap-hit halts the loop, no bonus thrash).
          options: { consumeBonusOnCap: !alreadyCounted },
        });

        if (!eligibility.canExecute) {
          const block = eligibility.blocks[0];
          await logRateLimit(executionId, false, {
            remaining: eligibility.remaining,
            limit: eligibility.limit,
            reset: 0,
            userRole: alreadyCounted ? `${userRole} (mid-flight halt)` : userRole,
          });
          return NextResponse.json(
            formatErrorResponse({
              title: block.title,
              message: block.message,
              code: "RATE_001",
              action: block.action,
              actionUrl: block.actionUrl,
            }),
            {
              status: 429,
              headers: {
                "X-Plan-Limit": String(eligibility.limit),
                "X-Plan-Used": String(eligibility.used),
                "X-Plan-Remaining": String(eligibility.remaining),
                ...(alreadyCounted ? { "X-Plan-Halt-Reason": "mid-flight-cap" } : {}),
              },
            },
          );
        }

        rateLimitRemaining = eligibility.remaining;
        rateLimitTotal = eligibility.limit;

        if (eligibility.usedReferralBonus && executionId) {
          referralBonusUsed = true;
          referralBonusRemaining = eligibility.bonusRemaining;
          // Bless this execution so subsequent nodes don't re-block on the
          // same at-cap state (bonus consumption doesn't decrement count).
          await markExecutionBonusBlessed(userId, executionId);
          console.log(
            `[referral] user=${userId} exec=${executionId} consumed bonus, remaining=${eligibility.bonusRemaining}`,
          );
        }

        await logRateLimit(executionId, true, {
          remaining: eligibility.remaining,
          limit: eligibility.limit,
          reset: 0,
          userRole,
        });
      } else {
        await logRateLimit(executionId, true, { skipped: true, userRole: `${userRole} (bonus-blessed)` });
      }
    } catch (error) {
      console.error("[execute-node] Eligibility check failed:", error);
      await logNodeError(executionId, catalogueId, tileInstanceId, error, Date.now() - nodeStartTime);
      return NextResponse.json(
        formatErrorResponse({
          title: "Service unavailable",
          message: "Plan-cap service temporarily unavailable. Please try again in a moment.",
          code: "RATE_LIMIT_UNAVAILABLE",
        }),
        { status: 503 },
      );
    }
  } else {
    await logRateLimit(executionId, true, { skipped: true, userRole });
  }

  // ── Per-node-type metered limits (video, 3D, renders) ──
  // Enforced server-side for all users including admins' direct node runs
  if (!isAdmin) {
    const nodeLimits = getNodeTypeLimits(userRole);

    if (VIDEO_NODES.has(catalogueId)) {
      const result = await checkNodeTypeLimit(userId, "video", nodeLimits.videoPerMonth);
      if (!result.allowed) {
        return NextResponse.json(
          formatErrorResponse(UserErrors.VIDEO_LIMIT_REACHED(nodeLimits.videoPerMonth)),
          { status: 429 }
        );
      }
    }

    if (MODEL_3D_NODES.has(catalogueId)) {
      const result = await checkNodeTypeLimit(userId, "3d", nodeLimits.modelsPerMonth);
      if (!result.allowed) {
        return NextResponse.json(
          formatErrorResponse(UserErrors.MODEL_3D_LIMIT_REACHED(nodeLimits.modelsPerMonth)),
          { status: 429 }
        );
      }
    }

    if (RENDER_NODES.has(catalogueId)) {
      const result = await checkNodeTypeLimit(userId, "render", nodeLimits.rendersPerMonth);
      if (!result.allowed) {
        return NextResponse.json(
          formatErrorResponse(UserErrors.RENDER_LIMIT_REACHED(nodeLimits.rendersPerMonth)),
          { status: 429 }
        );
      }
    }
  }

  // ── Server-side regen-count enforcement ──────────────────────────────
  // Phase 2 Task 4: blocks the F5-bypass that made the client-side regen
  // cap toothless. Detection is honest: we read the existing tileResults
  // for this execution and consider any (tileInstanceId, executionId) that
  // already has an artifact entry to be a regeneration. The counter lives
  // in Execution.metadata.regenerationCounts and is incremented atomically.
  //
  // Skip conditions (in priority order):
  //   - admin                  → admins regen freely for testing
  //   - missing executionId    → no anchor to enforce against
  //   - missing tileInstanceId → can't key the counter
  //   - !alreadyCounted        → fast-path: first node call of the execution
  //                              can't possibly be a regen, save the DB tx
  //
  // Fail mode: open on Prisma errors. The regen cap is a soft-money-saver,
  // not a security boundary. A brief Neon outage allowing one extra regen
  // is better UX than blocking the user entirely on a transient DB hiccup.
  // Phase 2.5 fix: the original code gated + queried by `executionId`, which
  // is the CLIENT-generated correlation id (see handler ctx plumbing, Phase 2
  // §2 Q1). CUIDs never matched it → findFirst always returned null →
  // `if (!exec) return false` fell through → regen cap was a server-side
  // no-op in production. Using `dbExecutionId` (Phase 2 ctx-plumbed, the real
  // Execution.id) enforces the cap as originally intended.
  if (!isAdmin && dbExecutionId && tileInstanceId && alreadyCounted) {
    try {
      const overLimit = await prisma.$transaction(async (tx) => {
        const exec = await tx.execution.findFirst({
          where: { id: dbExecutionId, userId },
          select: { tileResults: true, metadata: true },
        });
        if (!exec) return false; // Demo / unsaved exec — no enforcement

        const tileResults = Array.isArray(exec.tileResults)
          ? (exec.tileResults as Array<{ nodeId?: string }>)
          : [];
        const hasExistingResult = tileResults.some(r => r?.nodeId === tileInstanceId);
        if (!hasExistingResult) return false; // First run for this tile — not a regen

        // It's a regen — increment + cap check
        const metadata = (exec.metadata as ExecutionMetadata | null) ?? {};
        const counts = { ...(metadata.regenerationCounts ?? {}) };
        const newCount = (counts[tileInstanceId] ?? 0) + 1;

        if (newCount > MAX_REGENERATIONS) {
          return true; // Over cap — caller returns 429
        }

        counts[tileInstanceId] = newCount;
        const updatedMetadata: ExecutionMetadata = { ...metadata, regenerationCounts: counts };
        await tx.execution.update({
          where: { id: dbExecutionId },
          data: {
            // Double-cast through unknown — Prisma.InputJsonValue is recursive
            // and TypeScript can't simplify the ExecutionMetadata union to it.
            // The metadata route uses the same pattern (see Task 2/3 commits).
            metadata: updatedMetadata as unknown as Prisma.InputJsonValue,
          },
        });
        return false;
      });

      if (overLimit) {
        return NextResponse.json(
          formatErrorResponse(UserErrors.REGEN_MAX_REACHED(MAX_REGENERATIONS)),
          { status: 429 },
        );
      }
    } catch (error) {
      // Fail open: don't block the user on transient DB issues
      console.warn("[execute-node] Regen check failed (allowing through):", error);
    }
  }

  if (!REAL_NODE_IDS.has(catalogueId)) {
    await logValidationError(executionId, catalogueId, `Node ${catalogueId} not in REAL_NODE_IDS`);
    return NextResponse.json(
      formatErrorResponse(UserErrors.NODE_NOT_IMPLEMENTED(catalogueId)),
      { status: 400 }
    );
  }

  const apiKey = userApiKey || undefined;

  // Validate OpenAI key for nodes that need it
  if (OPENAI_NODES.has(catalogueId) && !apiKey && !process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      formatErrorResponse({ title: "API key required", message: "OpenAI API key not configured. Add your key in Settings or contact support.", code: "MISSING_API_KEY" }),
      { status: 400 }
    );
  }

  try {
    // STEP 1: Validate input BEFORE hitting any APIs
    assertValidInput(catalogueId, inputData);

    // STEP 2: Look up the handler in the registry and dispatch
    const handler = nodeHandlers[catalogueId];
    if (!handler) {
      // Should be unreachable: REAL_NODE_IDS guards above ensure we never
      // reach here for an unknown catalogueId. Belt-and-suspenders.
      return NextResponse.json(
        formatErrorResponse(UserErrors.NODE_NOT_IMPLEMENTED(catalogueId)),
        { status: 400 }
      );
    }

    const ctx: NodeHandlerContext = {
      catalogueId,
      executionId,
      tileInstanceId,
      inputData,
      userId,
      userRole,
      userEmail,
      isAdmin,
      apiKey,
      dbExecutionId: typeof dbExecutionId === "string" && dbExecutionId.length >= 20 ? dbExecutionId : undefined,
    };

    const result = await handler(ctx);

    // Handlers may return either an ExecutionArtifact (success) or a
    // NextResponse (early-return for validation errors). We pass NextResponse
    // through verbatim so the original early-error responses are preserved.
    if (result instanceof NextResponse) {
      return result;
    }

    const artifact = result;

    await logNodeSuccess(executionId, catalogueId, tileInstanceId, Date.now() - nodeStartTime, {
      type: artifact.type, dataKeys: Object.keys(artifact.data ?? {}),
    });
    const successHeaders: Record<string, string> = {};
    if (rateLimitRemaining !== null) successHeaders["X-RateLimit-Remaining"] = String(rateLimitRemaining);
    if (rateLimitTotal !== null) successHeaders["X-RateLimit-Limit"] = String(rateLimitTotal);
    if (referralBonusUsed) {
      successHeaders["X-Referral-Bonus-Used"] = "1";
      successHeaders["X-Referral-Bonus-Remaining"] = String(referralBonusRemaining);
    }
    return NextResponse.json({ artifact }, { headers: successHeaders });
  } catch (err) {
    // Handle APIError (user-friendly errors)
    if (err instanceof APIError) {
      console.error("[execute-node] API Error:", {
        code: err.userError.code,
        message: err.userError.message,
      });
      await logNodeError(executionId, catalogueId, tileInstanceId, err, Date.now() - nodeStartTime);
      return NextResponse.json(
        formatErrorResponse(err.userError),
        { status: err.statusCode }
      );
    }

    // Handle generic errors — surface the real message so users can debug
    const message = err instanceof Error ? err.message : "Execution failed";
    console.error("[execute-node] " + catalogueId + ":", message, err);
    await logNodeError(executionId, catalogueId, tileInstanceId, err, Date.now() - nodeStartTime);

    return NextResponse.json(
      {
        error: {
          title: `${catalogueId} failed`,
          message,
          code: "SYS_001",
          action: "Try Again",
        },
      },
      { status: 500 }
    );
  }
}
