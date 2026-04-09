import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit, logRateLimitHit, isExecutionAlreadyCounted, isAdminUser, checkNodeTypeLimit, consumeReferralBonus } from "@/lib/rate-limit";
import { VIDEO_NODES, MODEL_3D_NODES, RENDER_NODES, getNodeTypeLimits } from "@/features/billing/lib/stripe";
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
const REAL_NODE_IDS = new Set(["TR-001", "TR-003", "TR-004", "TR-005", "TR-012", "GN-001", "GN-003", "GN-004", "GN-007", "GN-008", "GN-009", "GN-010", "GN-011", "GN-012", "TR-007", "TR-008", "TR-013", "TR-014", "TR-015", "TR-016", "EX-001", "EX-002", "EX-003"]);

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

  // Email verification is now enforced via pre-execution check on the client.
  // Unverified users get 1 free execution; subsequent runs are blocked by the frontend popup.
  // Backend still allows execution through — the client is responsible for showing the modal.

  const userId: string = session.user.id;
  const userRole = (session.user as { role?: string }).role as "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN" || "FREE";
  const userEmail = session.user.email || "";

  // Parse body first so we can read executionId for rate-limit deduplication
  const { catalogueId, executionId, tileInstanceId, inputData, userApiKey } = await req.json();
  const nodeStartTime = Date.now();

  // ── Detailed file logging (dev only) ──
  await logWorkflowStart(executionId, userId, userRole, userEmail);
  await logNodeStart(executionId, catalogueId, tileInstanceId, inputData);

  // Admin users bypass ALL rate limiting — check before any Redis calls
  const isAdmin = isAdminUser(userEmail) ||
    userRole === "PLATFORM_ADMIN" ||
    userRole === "TEAM_ADMIN";

  // Track remaining executions for success response headers
  let rateLimitRemaining: number | null = null;
  let rateLimitTotal: number | null = null;

  // Hoisted to outer scope so the regen-count check below can read it.
  // Stays false for admins (they bypass that check too) and for the first
  // node call of the execution (the fast-path skip).
  let alreadyCounted = false;

  if (!isAdmin) {
    // Apply rate limiting — count once per workflow execution, not per node.
    // The first node in a workflow run consumes the rate limit slot.
    // Subsequent nodes in the same execution (same executionId) pass through.
    try {
      alreadyCounted = executionId
        ? await isExecutionAlreadyCounted(userId, executionId)
        : false;

      if (!alreadyCounted) {
        const rateLimitResult = await checkRateLimit(userId, userRole, userEmail);

        if (!rateLimitResult.success) {
          // Try consuming a referral bonus execution before rejecting
          const usedBonus = await consumeReferralBonus(userId);
          if (!usedBonus) {
            const resetDate = new Date(rateLimitResult.reset);
            const msUntilReset = resetDate.getTime() - Date.now();
            const daysUntilReset = Math.ceil(msUntilReset / (1000 * 60 * 60 * 24));

            // Log the rate limit hit
            logRateLimitHit(userId, userRole, rateLimitResult.remaining);
            await logRateLimit(executionId, false, {
              remaining: rateLimitResult.remaining, limit: rateLimitResult.limit,
              reset: rateLimitResult.reset, userRole,
            });

            const rateLimitError = userRole === "FREE"
              ? UserErrors.RATE_LIMIT_FREE(daysUntilReset)
              : userRole === "MINI"
              ? UserErrors.RATE_LIMIT_MINI(daysUntilReset)
              : userRole === "STARTER"
              ? UserErrors.RATE_LIMIT_STARTER(daysUntilReset)
              : UserErrors.RATE_LIMIT_PRO(daysUntilReset);

            return NextResponse.json(
              formatErrorResponse(rateLimitError),
              {
                status: 429,
                headers: {
                  "X-RateLimit-Limit": rateLimitResult.limit.toString(),
                  "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
                  "X-RateLimit-Reset": rateLimitResult.reset.toString(),
                }
              }
            );
          }
          // Bonus consumed — allow execution to proceed
        }

        await logRateLimit(executionId, true, {
          remaining: rateLimitResult.remaining, limit: rateLimitResult.limit,
          reset: rateLimitResult.reset, userRole,
        });
        rateLimitRemaining = rateLimitResult.remaining;
        rateLimitTotal = rateLimitResult.limit;
      }

    } catch (error) {
      console.error("[execute-node] Rate limit check failed:", error);
      await logNodeError(executionId, catalogueId, tileInstanceId, error, Date.now() - nodeStartTime);
      return NextResponse.json(
        formatErrorResponse({ title: "Service unavailable", message: "Rate limit service temporarily unavailable. Please try again in a moment.", code: "RATE_LIMIT_UNAVAILABLE" }),
        { status: 503 }
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
  if (!isAdmin && executionId && tileInstanceId && alreadyCounted) {
    try {
      const overLimit = await prisma.$transaction(async (tx) => {
        const exec = await tx.execution.findFirst({
          where: { id: executionId, userId },
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
          where: { id: executionId },
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
