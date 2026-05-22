/**
 * POST /api/brief-to-ifc/v3/agent-job
 *
 * QStash-triggered background worker for ONE iteration of the v3 agent
 * build. Each iteration gets its own Vercel invocation (800s budget).
 *
 * Phase δ.3 — per-iteration QStash chaining (kills the dead loop).
 *
 *   Iteration 1: QStash → agent-job → atomic counter=1 → build → verify
 *     - quality ≥ threshold       → COMPLETED with this iteration's result
 *     - quality < threshold       → append to iterationHistory, enqueue
 *                                   iteration 2 with compressed prior state
 *   Iteration N: QStash → agent-job → atomic counter=N → build → verify
 *     - quality ≥ threshold OR N == MAX_ITERATIONS → COMPLETED with BEST
 *       iteration's artifacts (never a regressed later iteration)
 *     - quality < threshold and iterations remain → enqueue iteration N+1
 *
 * Idempotency (Rule 8): the atomic counter check-and-set against
 * `BriefToIfcV3Run.currentIteration` is the authoritative guard. A
 * duplicate QStash delivery of iteration N finds `currentIteration`
 * already at N (or beyond), the conditional `updateMany` reports
 * `count: 0`, and the worker returns 200 OK without doing the work.
 * The `Upstash-Deduplication-Id` header is a belt-and-braces measure
 * at the queue layer.
 *
 * Runaway guard (Rule 3): three independent stop conditions, all
 * enforced — quality ≥ threshold, iteration ≥ MAX_ITERATIONS, hard
 * failure. The runaway-guard assertion at the top refuses any
 * iteration > MAX_ITERATIONS even with a logic bug elsewhere.
 *
 * Best-so-far (Rule 5): each iteration appends its result to
 * iterationHistory. The bestIteration field tracks the highest-quality
 * entry. The final COMPLETED transition lifts the best iteration's
 * IFC/entityCount/finalValidation/ledger/turnRecords into the run's
 * user-facing columns — never a worse later iteration.
 *
 * Compressed prior state (Rule 6): when re-enqueueing iteration N+1,
 * we build a compact summary of iteration N's IFC state + verifier
 * findings via `buildPriorStateSummary`, prepend it to the retry hint,
 * and pass it as `previousFeedback` in the new QStash payload. The
 * agent's existing slot in driver.ts:391-396 renders it under
 * "## PREVIOUS ITERATION FEEDBACK".
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  verifyQstashSignature,
  scheduleAgentBuildWorker,
} from "@/lib/qstash";
import type { AgentBuildWorkerPayload } from "@/lib/qstash";
import { runGenerator } from "@/features/brief-to-ifc/v3/generator/driver";
import type {
  AgentInputSuggestions,
  BriefSpec,
  GeneratorResult,
  IterationHistoryEntry,
  VerifierReport,
} from "@/features/brief-to-ifc/v3/types";
import { appendLog } from "@/features/brief-to-ifc/v3/runtime/append-log";
import {
  toBriefToIfcV3ErrorCode,
  type BriefToIfcV3ErrorCode,
} from "@/features/brief-to-ifc/v3/lifecycle/error-codes";
import { verifyBuild } from "@/features/brief-to-ifc/v3/hard-verifier";
import { generateRetryHint } from "@/features/brief-to-ifc/v3/retry-hint";
import { transitionStatus } from "@/features/brief-to-ifc/v3/lifecycle/transitions";
import { startHeartbeat } from "@/features/brief-to-ifc/v3/lifecycle/heartbeat";
import {
  QUALITY_THRESHOLD,
  MAX_ITERATIONS,
  RUN_COST_CAP_USD,
} from "@/features/brief-to-ifc/v3/constants";
import {
  BuildTelemetryCollector,
  emitBuildTelemetry,
  snapshotAndEmit,
} from "@/features/brief-to-ifc/v3/telemetry";
import { buildPriorStateSummary } from "@/features/brief-to-ifc/v3/prior-state-summary";
import {
  assertSafeEnqueue,
  decideIteration,
  findBestIterationIdx,
} from "@/features/brief-to-ifc/v3/iteration-decisions";
import {
  computeLegacyQualityScore,
  computeQualityScore,
} from "@/features/brief-to-ifc/v3/quality-score";
import { renderFinalizedIfcPreviews } from "@/features/brief-to-ifc/v3/runtime/sandbox-render";
import { inspectIFC } from "@/features/brief-to-ifc/v3/vision-inspector";
import type { VisionReport } from "@/features/brief-to-ifc/v3/types";

export const maxDuration = 800;

/** Per-iteration wall-clock budget. 50s below Vercel's 800s ceiling to
 *  leave room for the post-build verifier + retry-hint LLM call + QStash
 *  re-enqueue before the function is killed. */
const ITERATION_TIMEOUT_MS = 750_000;

/** Sentinel error used by the timeout race so the worker can distinguish
 *  a generator timeout from other failures. */
class IterationTimeoutError extends Error {
  readonly code = "EXECUTION_TIMEOUT";
  constructor(timeoutMs: number) {
    super(`Iteration exceeded ${timeoutMs} ms wall-clock budget.`);
    this.name = "IterationTimeoutError";
  }
}

export async function POST(req: NextRequest) {
  // ── 1. QStash signature verification (unchanged from γ.3) ──
  const rawBody = await req.text();
  const signature = req.headers.get("upstash-signature");

  const skipVerify = process.env.SKIP_QSTASH_SIG_VERIFY === "true";
  if (skipVerify && process.env.NODE_ENV === "production") {
    throw new Error("SECURITY: SKIP_QSTASH_SIG_VERIFY must not be true in production");
  }
  if (!skipVerify) {
    const valid = await verifyQstashSignature(signature, rawBody);
    if (!valid) {
      console.warn("[agent-job] rejected — invalid or missing QStash signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: AgentBuildWorkerPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const runId = typeof payload.runId === "string" ? payload.runId : null;
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  const briefText = typeof payload.briefText === "string" ? payload.briefText : undefined;
  const suggestions = payload.suggestions as AgentInputSuggestions | undefined;
  const rawIteration = typeof payload.iteration === "number" ? payload.iteration : 1;
  const iteration = Math.max(1, Math.floor(rawIteration));
  const previousFeedback =
    typeof payload.previousFeedback === "string" ? payload.previousFeedback : undefined;

  // ── 2. RUNAWAY GUARD (Rule 3) — hard ceiling assertion ──
  // No code path may enqueue past MAX_ITERATIONS, but the worker itself
  // refuses to act on a payload that already breached the ceiling. This
  // is the inner-circle defense against an upstream logic bug billing
  // an infinite QStash chain.
  if (iteration > MAX_ITERATIONS) {
    console.warn(
      `[agent-job] runaway guard: iteration ${iteration} > MAX_ITERATIONS=${MAX_ITERATIONS}. ` +
        `Refusing run ${runId}.`,
    );
    await appendLog(prisma, {
      executionId: runId,
      level: "ERROR",
      source: "LIFECYCLE",
      message: `Runaway guard tripped: iteration=${iteration}, max=${MAX_ITERATIONS}`,
      metadata: { iteration, max: MAX_ITERATIONS, runawayGuard: true },
    });
    return NextResponse.json(
      { error: "iteration > MAX_ITERATIONS", iteration, max: MAX_ITERATIONS },
      { status: 400 },
    );
  }

  // ── 3. Load run from DB ──
  const run = await prisma.briefToIfcV3Run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      briefSpec: true,
      costCapUsd: true,
      currentIteration: true,
      iterationHistory: true,
      bestIteration: true,
    },
  });

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  if (run.status !== "PENDING" && run.status !== "RUNNING") {
    return NextResponse.json({ status: run.status, message: "Already processed" });
  }

  const briefSpec = run.briefSpec as unknown as BriefSpec;
  if (!briefSpec) {
    return NextResponse.json({ error: "Run has no briefSpec snapshot" }, { status: 400 });
  }

  // ── 4. ATOMIC counter check-and-set (Rule 8 — primary idempotency) ──
  // Only proceed if currentIteration is exactly N-1. Duplicate / stale
  // QStash deliveries find a mismatch and drop silently. Iteration 1
  // additionally accepts PENDING → RUNNING; iteration N>1 requires
  // status to already be RUNNING.
  const claim = await prisma.briefToIfcV3Run.updateMany({
    where: {
      id: runId,
      currentIteration: iteration - 1,
      status: iteration === 1 ? { in: ["PENDING", "RUNNING"] } : "RUNNING",
    },
    data: {
      currentIteration: iteration,
      status: "RUNNING",
      lastHeartbeatAt: new Date(),
      ...(iteration === 1 ? { startedAt: new Date() } : {}),
    },
  });

  if (claim.count === 0) {
    // Duplicate or out-of-order delivery. Log and ack — never throw,
    // never enqueue, never bill.
    await appendLog(prisma, {
      executionId: runId,
      level: "WARN",
      source: "LIFECYCLE",
      message:
        `iteration ${iteration} dropped — atomic counter mismatch ` +
        `(observed currentIteration=${run.currentIteration}, status=${run.status})`,
      metadata: {
        iteration,
        observedCounter: run.currentIteration,
        observedStatus: run.status,
        droppedReason: "duplicate_or_stale",
      },
    });
    return NextResponse.json({ status: "duplicate", iteration });
  }

  // ── 5. Build the agent's "previousFeedback" (compressed prior state
  //      + retry hint). On iteration 1 it stays whatever the original
  //      enqueuer set (typically undefined). On iteration N>1 the
  //      QStash payload already carries the compressed string produced
  //      by iteration N-1's worker. ──
  const effectivePreviousFeedback = previousFeedback;
  const iterationHistory: IterationHistoryEntry[] = Array.isArray(run.iterationHistory)
    ? (run.iterationHistory as unknown as IterationHistoryEntry[])
    : [];

  // ── 5b. Phase ζ.2 — PER-RUN cost cap pre-check.
  // Cumulative Anthropic spend = sum of prior iterations' `costUsd`
  // values (already persisted to `iterationHistory` after each
  // iteration at line ~514 below — no schema change). If the remaining
  // run-level budget is non-positive, don't start this iteration:
  //   • prior iteration(s) exist → finalize the best one rather than
  //     discarding it (the IFC is already paid for and uploaded to R2).
  //   • no prior iteration succeeded → mark the run FAILED with
  //     RUN_COST_CAP_EXCEEDED (rare: only happens if iter-1 spent enough
  //     to exhaust the cap before producing a finalizable IFC, which
  //     the per-iter cap of $5 against the $7 run cap normally prevents).
  // The check ALSO catches the runaway-guard / re-enqueue path's escape
  // route: if iter-N+1 was enqueued before this worker's pre-check
  // landed, the pre-check is the second line of defence.
  const spentSoFar = iterationHistory.reduce(
    (s, e) => s + (e.costUsd ?? 0),
    0,
  );
  const remainingRunBudgetUsd = RUN_COST_CAP_USD - spentSoFar;
  if (remainingRunBudgetUsd <= 0) {
    await appendLog(prisma, {
      executionId: runId,
      level: "WARN",
      source: "LIFECYCLE",
      message:
        `Iteration ${iteration} not started — cumulative run cost ` +
        `$${spentSoFar.toFixed(4)} has exhausted the $${RUN_COST_CAP_USD.toFixed(2)} ` +
        `per-run cap (RUN_COST_CAP_USD). ` +
        (iterationHistory.length > 0
          ? `Finalizing with best-so-far (${iterationHistory.length} prior iteration(s)).`
          : `No prior iteration produced an IFC — marking FAILED.`),
      metadata: {
        iteration,
        spentSoFarUsd: spentSoFar,
        runCapUsd: RUN_COST_CAP_USD,
        priorIterations: iterationHistory.length,
      },
    });
    if (iterationHistory.length === 0) {
      try {
        await transitionStatus(prisma, runId, "RUNNING", {
          to: "FAILED",
          payload: {
            errorCode: "RUN_COST_CAP_EXCEEDED",
            errorMessage:
              `Run cost cap $${RUN_COST_CAP_USD.toFixed(2)} exhausted ` +
              `before iteration ${iteration} could start; cumulative spend ` +
              `$${spentSoFar.toFixed(4)}.`,
          },
        });
      } catch (transitionErr) {
        // Race with cancel sweep or another writer — silently swallow.
        console.warn(
          `[agent-job] FAILED transition raced for ${runId}: ${
            transitionErr instanceof Error ? transitionErr.message : String(transitionErr)
          }`,
        );
      }
      return NextResponse.json({
        status: "budget_exhausted",
        runId,
        iteration,
        spentSoFarUsd: spentSoFar,
        noPriorResult: true,
      });
    }
    const bestIdx = findBestIterationIdx(iterationHistory);
    await finalizeWithBest({
      runId,
      history: iterationHistory,
      bestIdx,
      completedReason: "run_budget_exhausted",
    });
    return NextResponse.json({
      status: "budget_exhausted",
      runId,
      iteration,
      spentSoFarUsd: spentSoFar,
      finalizedBestIteration: iterationHistory[bestIdx].iteration,
    });
  }

  // ── 6. Per-iteration BuildTelemetryCollector (δ.0 reuse) ──
  const telemetry = new BuildTelemetryCollector({
    runId,
    iteration,
    briefType: briefSpec.project?.type ?? null,
  });
  try {
    for (const el of briefSpec.elements ?? []) {
      telemetry.recordRequestedElementType(el.type);
    }
  } catch {
    /* swallow — telemetry never crashes the build */
  }

  // ── 7. Heartbeat + timeout race ──
  const heartbeat = startHeartbeat(prisma, runId, {});
  const iterationStartMs = Date.now();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    await appendLog(prisma, {
      executionId: runId,
      level: "INFO",
      source: "GENERATE",
      message:
        `Iteration ${iteration} starting (δ.3 chained worker). ` +
        `briefText=${briefText ? `${briefText.length}ch` : "absent"}, ` +
        `hasFeedback=${!!effectivePreviousFeedback}, ` +
        `historyLength=${iterationHistory.length}`,
      metadata: {
        iteration,
        max: MAX_ITERATIONS,
        priorIterations: iterationHistory.length,
      },
    });

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new IterationTimeoutError(ITERATION_TIMEOUT_MS));
      }, ITERATION_TIMEOUT_MS);
      if (timeoutHandle && typeof timeoutHandle.unref === "function") {
        timeoutHandle.unref();
      }
    });

    // ── 7b. Phase ζ.1 — pre-turn cancellation probe.
    // Closes over `runId` + `prisma` so the driver doesn't need either.
    // Fires once per agent turn at the top of the loop (BEFORE the
    // Anthropic stream call). Returns true when the user cancelled the
    // run; the driver short-circuits via the existing `failed(...)`
    // path with `CANCELLED_BY_USER`. Errors are swallowed by the
    // driver so a transient DB blip never aborts a healthy run.
    const checkCancelled = async (): Promise<boolean> => {
      const row = await prisma.briefToIfcV3Run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      return row?.status === "CANCELLED";
    };

    // ── 8. Run generator + verifier (raced against the timeout) ──
    const built = await Promise.race([
      runIterationAndVerify({
        briefSpec,
        briefText,
        suggestions,
        previousFeedback: effectivePreviousFeedback,
        iteration,
        iterationStartMs,
        telemetry,
        checkCancelled,
        // ζ.2 — pass the remaining run-budget so the driver's per-turn
        // cap collapses to `min(per-iter, remaining)`. The driver will
        // exit via `failed(RUN_COST_CAP_EXCEEDED)` if the run budget is
        // the tighter constraint and it gets breached mid-iteration.
        remainingRunBudgetUsd,
        onTurn: (record) => {
          try {
            if (record.toolName === "render_preview") {
              telemetry.recordRenderPreviewCall();
            }
            if (!record.toolOk) {
              telemetry.recordToolError();
            }
          } catch {
            /* swallow */
          }
          void appendLog(prisma, {
            executionId: runId,
            level: "INFO",
            source: "TOOL_CALL",
            message:
              `[iter${iteration}] Turn ${record.turn}: ${record.toolName ?? "<no tool>"} ` +
              `(${record.toolDurationMs}ms, ` +
              `${record.toolOk ? "ok" : "FAIL " + (record.toolErrorType ?? "?")})`,
            metadata: {
              turn: record.turn,
              toolName: record.toolName,
              toolDurationMs: record.toolDurationMs,
              toolOk: record.toolOk,
              toolErrorType: record.toolErrorType,
              iteration,
            },
          });
        },
      }),
      timeoutPromise,
    ]);

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }

    // ── 9. Record stats into telemetry ──
    try {
      telemetry.setTurns(built.result.turns);
      telemetry.setGeneratorCostUsd(built.result.costUsd);
      telemetry.setEntityCount(built.result.entityCount);
      telemetry.setFinalized(built.result.ok);
      // δ.2 — record BOTH scores side-by-side (Rule 6).
      // `finalQualityScore` is the NEW composite (what the loop gates
      // on); `legacyQualityScore` is the OLD broken formula recomputed
      // for validation that the new metric tracks reality better.
      telemetry.setFinalQualityScore(built.qualityScore);
      telemetry.setLegacyQualityScore(built.legacyQualityScore);
      telemetry.setQualityBreakdown(
        built.qualityBreakdown as unknown as Record<string, unknown>,
      );
      if (built.verifierReport && built.verifierReport.source !== "railway") {
        telemetry.recordRailwayError({
          endpoint: "/api/v3/verifier/check-build",
          kind: built.verifierReport.source,
          message: built.verifierReport.summary,
        });
      }
    } catch {
      /* swallow */
    }

    // Phase ζ.1 — cancellation short-circuit. The cancel-probe inside
    // `runGenerator` returned the same `failed(...)` shape as any other
    // graceful exit, with `error.code = "CANCELLED_BY_USER"`. We DO NOT
    // throw here: the user already set the run's status to CANCELLED via
    // the cancel endpoint, and trying to transition `RUNNING → FAILED`
    // would race against (and lose to) the user's CANCELLED transition.
    // Instead we log the abort, leave the row in its CANCELLED state,
    // stop the heartbeat, and acknowledge the QStash invocation. No
    // further iteration enqueues — chaining is gated below.
    if (
      built.result.error?.code === "CANCELLED_BY_USER" ||
      toBriefToIfcV3ErrorCode(built.result.error?.code) === "CANCELLED_BY_USER"
    ) {
      await appendLog(prisma, {
        executionId: runId,
        level: "INFO",
        source: "LIFECYCLE",
        message:
          `Iteration ${iteration} aborted by user cancel — agent turn loop ` +
          `exited via CANCELLED_BY_USER guard after ${built.result.turns} ` +
          `turn(s), cumulative cost $${built.result.costUsd.toFixed(4)}. ` +
          `No further iterations will be enqueued.`,
        metadata: {
          iteration,
          turnsCompleted: built.result.turns,
          costUsdAtCancel: built.result.costUsd,
        },
      });
      void snapshotAndEmit(prisma, telemetry).catch(() => {
        /* swallow — telemetry never crashes the worker */
      });
      heartbeat.stop();
      return NextResponse.json({
        status: "cancelled",
        runId,
        iteration,
        turnsCompleted: built.result.turns,
      });
    }

    // If the generator failed (ok=false), abort this iteration as a
    // hard failure. We do NOT try to chain past a generator failure —
    // that's a SEV that needs human attention, not more LLM spend.
    if (!built.result.ok) {
      throw Object.assign(
        new Error(built.result.error?.message ?? "generator failed"),
        { code: toBriefToIfcV3ErrorCode(built.result.error?.code) },
      );
    }

    await appendLog(prisma, {
      executionId: runId,
      level: "INFO",
      source: "GENERATE",
      message:
        `Iteration ${iteration} verified: quality=${built.qualityScore}, ` +
        `entities=${built.result.entityCount}, turns=${built.result.turns}, ` +
        `$${built.result.costUsd.toFixed(3)}`,
      metadata: {
        iteration,
        qualityScore: built.qualityScore,
        verifierSource: built.verifierReport?.source ?? "unavailable",
      },
    });

    // ── 10. DECISION: pass / retry / max (Rule 3 — three stop conditions) ──
    const decision = decideIteration({
      qualityScore: built.qualityScore,
      iteration,
      maxIterations: MAX_ITERATIONS,
      qualityThreshold: QUALITY_THRESHOLD,
    });
    const passed = decision.kind === "completed" && decision.reason === "quality_passed";
    const shouldRetry = decision.kind === "retry";

    // Build this iteration's history entry.
    const iterationDurationMs = Date.now() - iterationStartMs;
    const thisEntry: IterationHistoryEntry = {
      iteration,
      qualityScore: built.qualityScore,
      ifcUrl: built.result.ifcUrl ?? "",
      entityCount: built.result.entityCount,
      costUsd: built.result.costUsd,
      durationMs: iterationDurationMs,
      turns: built.result.turns,
      verifierSource: built.verifierReport?.source ?? "unavailable",
      finishedAt: new Date().toISOString(),
      finalValidation: built.result.finalValidation ?? null,
      ledger: built.result.ledger,
      turnRecords: built.result.turnRecords,
    };

    // If retrying, generate the retry hint + compressed prior-state
    // BEFORE persisting iterationHistory, so the forwardFeedback is
    // captured in the same write.
    let forwardFeedback = "";
    if (shouldRetry) {
      const hint = await generateRetryHint({
        brief: briefText || briefSpec.project?.description || "",
        iteration,
        previousIfcUrl: thisEntry.ifcUrl,
        verifierReport: built.verifierReport ?? {
          verified: false,
          parts_coverage: 0,
          trim_coverage: 0,
          mismatches: [],
          summary: "verifier report unavailable",
          verified_at: new Date().toISOString(),
          source: "unavailable",
        },
        visionReport: {
          quality_score: built.qualityScore,
          pass: false,
          issues: [],
          summary: `Quality ${built.qualityScore} below threshold`,
          inspected_at: new Date().toISOString(),
        },
        qualityScore: built.qualityScore,
      });
      forwardFeedback = buildPriorStateSummary({
        iteration,
        qualityScore: built.qualityScore,
        finalValidation: built.result.finalValidation,
        verifierReport: built.verifierReport,
        visionReport: null,
        retryHint: hint.hint,
      });
      thisEntry.forwardFeedback = forwardFeedback;
    }

    // Compute the new bestIteration via the shared pure helper. Ties
    // go to the earlier iteration so a regression cannot replace an
    // equally-good earlier result (Rule 5).
    const newHistory = [...iterationHistory, thisEntry];
    const bestIdx = findBestIterationIdx(newHistory);
    const bestIteration = newHistory[bestIdx].iteration;

    // Persist iterationHistory + bestIteration. Plain update (not a
    // status transition) — status stays RUNNING.
    await prisma.briefToIfcV3Run.update({
      where: { id: runId },
      data: {
        iterationHistory: newHistory as unknown as object,
        bestIteration,
        lastHeartbeatAt: new Date(),
      },
    });

    // Emit this iteration's δ.0 telemetry. Fire-and-forget; never crashes.
    void snapshotAndEmit(prisma, telemetry).catch(() => {
      /* swallow — telemetry never crashes the build */
    });

    if (shouldRetry && decision.kind === "retry") {
      // ── 10a. RE-ENQUEUE iteration N+1 ──
      const nextIteration = decision.nextIteration;

      // Phase ζ.1 — between-iterations cancel guard. The user may have
      // cancelled the run AFTER this iteration's atomic claim but
      // BEFORE the agent-loop's in-turn probe fired (rare window if
      // cancel + quality-pass land in the same millisecond, BUT also
      // common when iteration N completes normally and the user
      // cancels in the brief moment before N+1 enqueues). Re-read the
      // row's status here; if CANCELLED, do NOT enqueue the next
      // iteration. The user's CANCELLED row is authoritative; we leave
      // the iterationHistory in place (already persisted above) but do
      // not bill another iteration's Anthropic spend.
      const currentRow = await prisma.briefToIfcV3Run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (currentRow?.status === "CANCELLED") {
        await appendLog(prisma, {
          executionId: runId,
          level: "INFO",
          source: "LIFECYCLE",
          message:
            `Iteration ${nextIteration} NOT enqueued — run was cancelled ` +
            `by user between iteration ${iteration}'s finalize and the ` +
            `re-enqueue decision. iterationHistory persisted; no further ` +
            `Anthropic spend.`,
          metadata: {
            iteration,
            wouldHaveEnqueued: nextIteration,
            cancelledBetweenIterations: true,
          },
        });
        heartbeat.stop();
        return NextResponse.json({
          status: "cancelled",
          runId,
          iteration,
          skippedNextIteration: nextIteration,
        });
      }

      // Phase ζ.2 — between-iterations PER-RUN budget gate. Re-compute
      // cumulative spend from `newHistory` (which now includes this
      // iteration's cost) and refuse to chain iteration N+1 if the
      // run-level cap is exhausted. Finalize-with-best-so-far instead —
      // the prior iteration(s) are paid for; returning the best result
      // beats discarding it. Distinct from the pre-iteration check at
      // §5b: that one fires when a freshly-claimed worker has no budget
      // left; this one fires when iteration N JUST completed but iter
      // N+1 would breach the cap.
      const cumulativeAfterThis = newHistory.reduce(
        (s, e) => s + (e.costUsd ?? 0),
        0,
      );
      if (cumulativeAfterThis >= RUN_COST_CAP_USD) {
        await appendLog(prisma, {
          executionId: runId,
          level: "INFO",
          source: "LIFECYCLE",
          message:
            `Iteration ${nextIteration} NOT enqueued — cumulative run cost ` +
            `$${cumulativeAfterThis.toFixed(4)} has reached the ` +
            `$${RUN_COST_CAP_USD.toFixed(2)} per-run cap. ` +
            `Finalizing with best-so-far (iteration ${
              newHistory[bestIdx].iteration
            }, quality ${newHistory[bestIdx].qualityScore}).`,
          metadata: {
            iteration,
            wouldHaveEnqueued: nextIteration,
            cumulativeCostUsd: cumulativeAfterThis,
            runCapUsd: RUN_COST_CAP_USD,
            bestIteration: newHistory[bestIdx].iteration,
          },
        });
        await finalizeWithBest({
          runId,
          history: newHistory,
          bestIdx,
          completedReason: "run_budget_exhausted",
        });
        heartbeat.stop();
        return NextResponse.json({
          status: "ok",
          runId,
          iteration,
          completedReason: "run_budget_exhausted",
        });
      }

      // Runaway guard re-check (Rule 3 — defense in depth). The pure
      // assertion refuses any nextIteration that breaches the ceiling
      // even if `decideIteration` had a logic bug.
      try {
        assertSafeEnqueue(nextIteration, MAX_ITERATIONS);
      } catch (guardErr) {
        console.error(
          `[agent-job] runaway guard caught: ${
            guardErr instanceof Error ? guardErr.message : String(guardErr)
          }. Forcing COMPLETED with best-so-far for run ${runId}.`,
        );
        await finalizeWithBest({
          runId,
          history: newHistory,
          bestIdx,
          completedReason: "runaway_guard_tripped",
        });
        heartbeat.stop();
        return NextResponse.json({ status: "ok", runId, completedReason: "runaway_guard_tripped" });
      }

      try {
        const messageId = await scheduleAgentBuildWorker(
          {
            runId,
            briefText,
            suggestions: suggestions as Record<string, unknown> | undefined,
            previousFeedback: forwardFeedback,
            iteration: nextIteration,
          },
          {
            dedupId: `${runId}-iter-${nextIteration}`,
          },
        );
        await appendLog(prisma, {
          executionId: runId,
          level: "INFO",
          source: "LIFECYCLE",
          message:
            `Iteration ${nextIteration} enqueued (messageId=${messageId}, ` +
            `quality=${built.qualityScore} < ${QUALITY_THRESHOLD}).`,
          metadata: {
            iteration: nextIteration,
            previousScore: built.qualityScore,
            dedupId: `${runId}-iter-${nextIteration}`,
            messageId,
          },
        });
        heartbeat.stop();
        return NextResponse.json({
          status: "ok",
          runId,
          iteration,
          nextIteration,
          qualityScore: built.qualityScore,
        });
      } catch (enqueueErr) {
        // QStash enqueue failed. Rather than leave the run RUNNING
        // forever (until the stuck-sweep), fall back to COMPLETED
        // with the best-so-far. The user gets the best build we
        // managed; the operator sees the QStash failure in logs.
        const errMsg = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
        console.error(
          `[agent-job] QStash enqueue failed for run ${runId} iter ${nextIteration}: ${errMsg}`,
        );
        await appendLog(prisma, {
          executionId: runId,
          level: "ERROR",
          source: "LIFECYCLE",
          message:
            `Iteration ${nextIteration} enqueue FAILED: ${errMsg.slice(0, 300)}. ` +
            `Finalizing with best-so-far (iteration ${bestIteration}, quality=${newHistory[bestIdx].qualityScore}).`,
          metadata: { iteration: nextIteration, enqueueError: errMsg.slice(0, 500) },
        });
        await finalizeWithBest({
          runId,
          history: newHistory,
          bestIdx,
          completedReason: "enqueue_failed",
        });
        heartbeat.stop();
        return NextResponse.json({
          status: "ok",
          runId,
          completedReason: "enqueue_failed",
        });
      }
    }

    // ── 10b. PASS or MAX_ITERATIONS reached — COMPLETED with best ──
    await finalizeWithBest({
      runId,
      history: newHistory,
      bestIdx,
      completedReason: passed ? "quality_passed" : "max_iterations",
    });
    heartbeat.stop();
    return NextResponse.json({
      status: "ok",
      runId,
      iteration,
      bestIteration,
      qualityScore: built.qualityScore,
      completedReason: passed ? "quality_passed" : "max_iterations",
    });
  } catch (err) {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    heartbeat.stop();

    const errMsg = err instanceof Error ? err.message : String(err);
    const errCode: BriefToIfcV3ErrorCode =
      err instanceof IterationTimeoutError
        ? "EXECUTION_TIMEOUT"
        : toBriefToIfcV3ErrorCode(err);
    console.error(
      `[agent-job] Worker failed for run ${runId} iter ${iteration}: ${errCode} — ${errMsg}`,
    );

    // Transition to FAILED. If a prior iteration succeeded, the best
    // record stays in iterationHistory for diagnostics — but FAILED is
    // FAILED; the user-facing fields will be cleared per the
    // transitionStatus invariant.
    try {
      await transitionStatus(prisma, runId, "RUNNING", {
        to: "FAILED",
        payload: {
          errorCode: errCode,
          errorMessage: errMsg.slice(0, 1000),
        },
      });
    } catch (transitionErr) {
      console.error(
        `[agent-job] FAILED transition itself failed for ${runId}: ${
          transitionErr instanceof Error ? transitionErr.message : String(transitionErr)
        }`,
      );
    }

    void snapshotAndEmit(prisma, telemetry).catch(() => {
      /* swallow */
    });

    return NextResponse.json(
      { error: "worker error", detail: errMsg.slice(0, 500), iteration, errorCode: errCode },
      { status: 500 },
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

interface BuiltIteration {
  result: GeneratorResult;
  /** Phase δ.2 — the composite quality score (0-100) from
   *  `computeQualityScore`. This is what the δ.3 iteration loop
   *  gates on. */
  qualityScore: number;
  /** Phase δ.2 — the legacy `parts_coverage * 80 + verified * 20`
   *  score, recomputed in parallel for backward-compat telemetry
   *  validation. The loop does NOT gate on this. */
  legacyQualityScore: number;
  /** Phase δ.2 — structured breakdown of every sub-signal that fed
   *  the composite. Persisted in BuildTelemetry so we can answer
   *  "why did this build score X" from logs alone. */
  qualityBreakdown: ReturnType<typeof computeQualityScore>;
  verifierReport: VerifierReport | null;
}

async function runIterationAndVerify(args: {
  briefSpec: BriefSpec;
  briefText: string | undefined;
  suggestions: AgentInputSuggestions | undefined;
  previousFeedback: string | undefined;
  iteration: number;
  telemetry: BuildTelemetryCollector;
  onTurn: NonNullable<Parameters<typeof runGenerator>[0]["onTurn"]>;
  /** Phase ε.5 (forensic-audit FIX 5): wall-clock start of THIS
   *  iteration. Used by the vision-skip guard to compare elapsed
   *  generator+verifier time against the 600s safe-budget threshold;
   *  past that, vision is skipped to keep the iteration under the
   *  750s ITERATION_TIMEOUT_MS cap. */
  iterationStartMs: number;
  /** Phase ζ.1 — pre-turn cancellation probe. Closes over the runId
   *  + Prisma to re-read the run row at every turn boundary; returns
   *  true when the user has cancelled the run. Forwarded verbatim to
   *  `runGenerator` so the driver stays decoupled from Prisma. */
  checkCancelled: () => Promise<boolean>;
  /** Phase ζ.2 — remaining run-level budget in USD (RUN_COST_CAP_USD -
   *  sum of prior iterations' costUsd). Forwarded verbatim to
   *  `runGenerator`; clamps the per-turn cost cap so a single iteration
   *  cannot blow the whole run's budget. */
  remainingRunBudgetUsd: number;
}): Promise<BuiltIteration> {
  const result = await runGenerator({
    brief: args.briefSpec,
    briefText: args.briefText,
    suggestions: args.suggestions,
    previousFeedback: args.previousFeedback,
    iteration: args.iteration,
    telemetry: args.telemetry,
    onTurn: args.onTurn,
    checkCancelled: args.checkCancelled,
    remainingRunBudgetUsd: args.remainingRunBudgetUsd,
  });

  // Generator failed — no verifier call; return zero score on both
  // metrics. The empty breakdown signals "no signals available" so
  // the loop will retry or accept-best as appropriate.
  if (!result.ok || !result.ifcUrl) {
    const emptyBreakdown = computeQualityScore({
      briefSpec: args.briefSpec,
      finalValidation: null,
      verifierReport: null,
      visionReport: null,
    });
    return {
      result,
      qualityScore: 0,
      legacyQualityScore: 0,
      qualityBreakdown: emptyBreakdown,
      verifierReport: null,
    };
  }

  let verifierReport: VerifierReport | null = null;
  try {
    verifierReport = await verifyBuild(result.ifcUrl, args.briefSpec);
  } catch (err) {
    // Verifier blew up. Score from whatever signals remain — the
    // structural+sanity signals come from finalValidation (already
    // present on result), so the composite still produces a meaningful
    // number. Never mask the IFC artifact.
    console.warn(
      `[agent-job] verifier threw, scoring from validation only: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Phase ε.3 — post-finalize vision pass. Closes the δ.2 follow-on:
  // the composite metric's vision_quality sub-signal (0.25 weight when
  // available) was previously hardcoded null because finalize_ifc
  // destroys the agent's sandbox session, so render_preview (which
  // needs a session) couldn't be used post-finalize. ε.3 uses the
  // existing /api/v3/generator/render-previews Railway endpoint which
  // renders directly from R2 URL — no session needed.
  //
  // The metric's existing graceful-degradation (computeVisionQuality
  // detects the inspector's degraded-failure shape and drops the
  // signal) handles every failure mode without crashing the build.
  // The render call adds ~5-15s + the inspector call adds ~30-90s +
  // ~$0.20 per iteration — significant cost, justified because vision
  // catches what structural+sanity signals miss (collapsed furniture,
  // wrong proportions, ugly geometry that LOOKS broken).
  //
  // Phase ε.5 (forensic-audit FIX 5) — elapsed-budget guard. The
  // iteration has a 750_000ms hard cap (ITERATION_TIMEOUT_MS). If the
  // generator already ate 600s+, attempting vision (~120s worst case
  // post-ε.5 tightening) could push past the cap and trigger a
  // false EXECUTION_TIMEOUT that wastes the build. Skip vision when
  // elapsed is past the safe threshold; the composite metric drops
  // the vision sub-signal cleanly via its existing graceful
  // degradation. The agent's IFC is still produced + finalized;
  // we just score it on structural+sanity (no vision input).
  const VISION_SKIP_ELAPSED_MS = 600_000; // 600s — leaves 150s buffer
  const elapsedBeforeVisionMs = Date.now() - args.iterationStartMs;
  let visionReport: VisionReport | null = null;
  if (elapsedBeforeVisionMs > VISION_SKIP_ELAPSED_MS) {
    console.warn(
      `[agent-job] skipping vision pass — iteration already at ${
        elapsedBeforeVisionMs
      }ms (cap ${VISION_SKIP_ELAPSED_MS}ms); composite metric will degrade`,
    );
  } else {
    try {
      const previews = await renderFinalizedIfcPreviews(result.ifcUrl);
      if (previews.ok && previews.topPngB64 && previews.isoPngB64) {
        const inspection = await inspectIFC(
          args.briefSpec,
          previews.topPngB64,
          previews.isoPngB64,
        );
        visionReport = inspection.report;
      } else {
        console.warn(
          `[agent-job] post-finalize render-previews failed; vision sub-signal will degrade: ${previews.error ?? "unknown"}`,
        );
      }
    } catch (err) {
      // Either render or inspect threw — vision drops out of the metric
      // gracefully. Never crashes the build.
      console.warn(
        `[agent-job] post-finalize vision pass swallowed error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Phase δ.2 — composite score (gate) + legacy score (telemetry).
  // The δ.3 loop gates on `qualityScore`; `legacyQualityScore` is
  // logged side-by-side for real-run validation that the new metric
  // tracks reality better. ε.3 — vision is now wired (was null
  // pre-ε.3); when vision succeeds the sub-signal contributes 0.25
  // weight; when it fails the metric's graceful degradation drops it
  // and renormalizes the remaining signals.
  const qualityBreakdown = computeQualityScore({
    briefSpec: args.briefSpec,
    finalValidation: result.finalValidation,
    verifierReport,
    visionReport,
  });
  const legacyQualityScore = computeLegacyQualityScore(verifierReport);

  return {
    result,
    qualityScore: qualityBreakdown.score,
    legacyQualityScore,
    qualityBreakdown,
    verifierReport,
  };
}

/**
 * Lift the best iteration's artifacts into the user-facing COMPLETED
 * row. Also emits a chain-summary telemetry log so the full iteration
 * timeline is visible in one query.
 *
 * Never throws (the COMPLETED transition is atomic + idempotent; the
 * telemetry emit is fire-and-forget). On transition race-loss (e.g.
 * the cancel sweep won) the chain summary still gets logged.
 */
async function finalizeWithBest(args: {
  runId: string;
  history: IterationHistoryEntry[];
  bestIdx: number;
  completedReason: string;
}): Promise<void> {
  const { runId, history, bestIdx, completedReason } = args;
  const best = history[bestIdx];

  const cumulativeCost = history.reduce((s, e) => s + (e.costUsd ?? 0), 0);
  const cumulativeMs = history.reduce((s, e) => s + (e.durationMs ?? 0), 0);
  const cumulativeTurns = history.reduce((s, e) => s + (e.turns ?? 0), 0);

  // Validate that we have a usable ifcUrl from the best iteration. If
  // not (rare — all iterations failed before finalize), transition to
  // FAILED instead.
  if (!best || !best.ifcUrl) {
    try {
      await transitionStatus(prisma, runId, "RUNNING", {
        to: "FAILED",
        payload: {
          errorCode: "UNKNOWN",
          errorMessage: "All iterations produced no IFC URL",
        },
      });
    } catch {
      /* swallow — race with cancel or already terminal */
    }
    await emitChainSummary({
      runId,
      history,
      bestIdx,
      completedReason: "all_failed",
    });
    return;
  }

  try {
    await transitionStatus(prisma, runId, "RUNNING", {
      to: "COMPLETED",
      payload: {
        ifcUrl: best.ifcUrl,
        entityCount: best.entityCount,
        finalValidation: best.finalValidation ?? undefined,
        generatorCostUsd: cumulativeCost,
        generatorMs: cumulativeMs,
        turns: cumulativeTurns,
        ledger: best.ledger,
        turnRecords: best.turnRecords,
      },
    });
    await appendLog(prisma, {
      executionId: runId,
      level: "INFO",
      source: "LIFECYCLE",
      message:
        `Run COMPLETED via chain. bestIteration=${best.iteration}/${history.length}, ` +
        `quality=${best.qualityScore}, reason=${completedReason}, ` +
        `cumulativeCost=$${cumulativeCost.toFixed(3)}.`,
      metadata: {
        bestIteration: best.iteration,
        totalIterations: history.length,
        bestQualityScore: best.qualityScore,
        completedReason,
        cumulativeCostUsd: cumulativeCost,
      },
    });
  } catch (err) {
    // Race with cancel, or already terminal. Don't throw — the run is
    // in whatever state someone else put it.
    console.warn(
      `[agent-job] finalize transition race for ${runId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  await emitChainSummary({ runId, history, bestIdx, completedReason });
}

/**
 * Emit a single DIAGNOSTIC log row summarising the full chain. δ.0's
 * per-iteration BuildTelemetry rows give you each step; this row gives
 * you the chain at a glance: which iteration won, how many ran, total
 * cost, why we stopped. One query:
 *
 *   SELECT created_at, metadata FROM execution_logs
 *   WHERE execution_id = $1 AND source = 'DIAGNOSTIC'
 *         AND message LIKE 'BuildTelemetryChain%';
 */
async function emitChainSummary(args: {
  runId: string;
  history: IterationHistoryEntry[];
  bestIdx: number;
  completedReason: string;
}): Promise<void> {
  const { runId, history, bestIdx, completedReason } = args;
  const cumulativeCost = history.reduce((s, e) => s + (e.costUsd ?? 0), 0);
  const cumulativeMs = history.reduce((s, e) => s + (e.durationMs ?? 0), 0);
  const cumulativeTurns = history.reduce((s, e) => s + (e.turns ?? 0), 0);
  const best = history[bestIdx];

  // The chain summary reuses the DIAGNOSTIC source + a recognisable
  // message prefix so the existing telemetry-query convention picks it
  // up alongside the per-iteration snapshots. The snapshot collector
  // is per-iteration, so we synthesize a minimal pseudo-snapshot here
  // — only chain-level fields are populated.
  try {
    await emitBuildTelemetry(prisma, {
      schemaVersion: "v1",
      runId,
      iteration: 0, // sentinel — 0 means "chain summary, not a single iteration"
      briefType: null,
      startedAt: history[0]?.finishedAt ?? new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: cumulativeMs,
      finalized: true,
      turns: cumulativeTurns,
      generatorCostUsd: cumulativeCost,
      entityCount: best?.entityCount ?? 0,
      renderPreviewCalls: 0,
      finalQualityScore: best?.qualityScore ?? null,
      legacyQualityScore: null,
      qualityBreakdown: null,
      counts: {
        schemaCoercions: 0,
        schemaRejections: 0,
        proxyFallbacks: 0,
        droppedElements: 0,
        materialMisses: 0,
        railwayErrors: 0,
        toolErrors: 0,
      },
      elementTypeCounts: { requested: {}, built: {} },
      schemaCoercions: [],
      schemaRejections: [],
      proxyFallbacks: [],
      droppedElements: [],
      materialMisses: [],
      railwayErrors: [],
    });

    // Also emit a separate plain DIAGNOSTIC row with the iteration
    // history packed into metadata — that's the canonical chain view
    // for the dashboard / diagnostic CLI.
    await appendLog(prisma, {
      executionId: runId,
      level: "INFO",
      source: "DIAGNOSTIC",
      message:
        `BuildTelemetryChain iterations=${history.length} ` +
        `bestIteration=${best?.iteration ?? "-"} ` +
        `bestQuality=${best?.qualityScore ?? "-"} ` +
        `cumulativeCost=$${cumulativeCost.toFixed(3)} ` +
        `reason=${completedReason}`,
      metadata: {
        chainSummary: true,
        totalIterations: history.length,
        bestIteration: best?.iteration ?? null,
        bestQualityScore: best?.qualityScore ?? null,
        cumulativeCostUsd: cumulativeCost,
        cumulativeDurationMs: cumulativeMs,
        cumulativeTurns,
        completedReason,
        perIterationScores: history.map((e) => ({
          iteration: e.iteration,
          qualityScore: e.qualityScore,
          turns: e.turns,
          costUsd: e.costUsd,
          verifierSource: e.verifierSource,
        })),
      },
    });
  } catch (err) {
    console.warn(
      `[agent-job] emitChainSummary swallowed error for ${runId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
