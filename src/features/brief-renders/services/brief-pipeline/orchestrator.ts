/**
 * Brief-to-Renders pipeline orchestrator.
 *
 * State machine (Phase 3 surface — Phase 4 wires the post-approval half):
 *
 *   QUEUED ─→ RUNNING ─→ AWAITING_APPROVAL ─[user approves]→ RUNNING (Phase 4)
 *                  │            │
 *                  └────────────┴──→ FAILED  (any error)
 *                  │            │
 *                  └────────────┴──→ CANCELLED  (user DELETE)
 *
 * Idempotency contract — every entry path must be safe to call N times:
 *   • QStash retries the worker → orchestrator is invoked again. If
 *     `specResult` is cached, Stage 1 is skipped (no double-charge).
 *   • If `status` is already `AWAITING_APPROVAL`, `COMPLETED`, `FAILED`,
 *     or `CANCELLED`, the orchestrator returns the current state without
 *     re-running stages.
 *
 * Race-condition contract — every status transition uses a conditional
 * `where` clause that filters by the EXPECTED current status:
 *   • QUEUED → RUNNING uses `status: { in: ["QUEUED", "RUNNING"] }` so a
 *     cancelled job (status=CANCELLED) can't be revived.
 *   • RUNNING → AWAITING_APPROVAL uses `status: "RUNNING"` so a
 *     concurrent cancel during Stage 2 wins gracefully.
 * Zero-row updates (count: 0) are not errors — the orchestrator exits
 * gracefully and returns a "FAILED with code RACE_LOST" or matches the
 * current status if a refetch shows it's terminal.
 */

import type {
  BriefRenderJob as PrismaBriefRenderJob,
  BriefRenderJobStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { BriefRendersError } from "./errors";
import { BriefRenderLogger } from "./logger";
import { runStage1SpecExtract } from "./stage-1-spec-extract";
import { runStage2PromptGen } from "./stage-2-prompt-gen";
import { createStageLogPersister } from "./stage-log-store";
import type { BriefSpec, BriefStageLogEntry, ShotResult } from "./types";

// ─── Public surface ─────────────────────────────────────────────────

export interface OrchestratorArgs {
  jobId: string;
  prisma: PrismaClient;
}

export type OrchestratorResult =
  | {
      status: "AWAITING_APPROVAL";
      spec: BriefSpec;
      shots: ShotResult[];
      costUsd: number;
    }
  | {
      status: "COMPLETED" | "FAILED" | "CANCELLED";
      errorCode: string;
      errorMessage: string;
    };

// ─── Typed errors ───────────────────────────────────────────────────

export class JobNotFoundError extends Error {
  readonly code = "JOB_NOT_FOUND";
  readonly userMessage = "Brief render job not found.";
  constructor(readonly jobId: string) {
    super(`BriefRenderJob ${jobId} not found.`);
    this.name = "JobNotFoundError";
  }
}

// ─── Progress milestones ────────────────────────────────────────────

const PROGRESS_RUNNING_START = 5;
const PROGRESS_AFTER_STAGE_1 = 20;
const PROGRESS_AT_AWAITING_APPROVAL = 30;

// ─── Helpers ────────────────────────────────────────────────────────

function isTerminal(status: BriefRenderJobStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

function asCachedResult(job: PrismaBriefRenderJob): OrchestratorResult {
  if (job.status === "AWAITING_APPROVAL" && job.specResult && job.shots) {
    return {
      status: "AWAITING_APPROVAL",
      spec: job.specResult as unknown as BriefSpec,
      shots: job.shots as unknown as ShotResult[],
      costUsd: job.costUsd,
    };
  }
  // COMPLETED / FAILED / CANCELLED — return the terminal state without
  // attempting to re-run any stage.
  return {
    status: job.status === "COMPLETED" ? "COMPLETED" : job.status === "CANCELLED" ? "CANCELLED" : "FAILED",
    errorCode: job.status === "CANCELLED" ? "CANCELLED" : "ALREADY_TERMINAL",
    errorMessage:
      job.errorMessage ?? (job.status === "CANCELLED" ? "Job was cancelled" : "Job already finished"),
  };
}

async function markFailed(
  prisma: PrismaClient,
  jobId: string,
  errorCode: string,
  errorMessage: string,
): Promise<OrchestratorResult> {
  // Don't overwrite an already-terminal status. updateMany lets us filter
  // safely without throwing on row mismatch.
  await prisma.briefRenderJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["QUEUED", "RUNNING", "AWAITING_APPROVAL"] },
    },
    data: {
      status: "FAILED",
      errorMessage: errorMessage.slice(0, 1000),
      completedAt: new Date(),
    },
  });
  return { status: "FAILED", errorCode, errorMessage };
}

// ─── Main entry point ───────────────────────────────────────────────

export async function runBriefRenderOrchestrator(
  args: OrchestratorArgs,
): Promise<OrchestratorResult> {
  const { jobId, prisma } = args;

  // 1. Load.
  const job = await prisma.briefRenderJob.findUnique({ where: { id: jobId } });
  if (!job) throw new JobNotFoundError(jobId);

  // 2. Cancellation check — fail-closed before any work.
  if (job.status === "CANCELLED") {
    return {
      status: "CANCELLED",
      errorCode: "CANCELLED",
      errorMessage: "Job was cancelled",
    };
  }

  // 3. Idempotency — if we're already past the gate, return cached state.
  if (job.status === "AWAITING_APPROVAL" && job.specResult && job.shots) {
    return asCachedResult(job);
  }
  if (isTerminal(job.status)) {
    return asCachedResult(job);
  }

  // 4. Atomic transition QUEUED|RUNNING → RUNNING. updateMany gates on
  // status; zero rows means another worker beat us OR the job was
  // cancelled between findUnique and update. Either way, exit gracefully.
  const claim = await prisma.briefRenderJob.updateMany({
    where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      status: "RUNNING",
      startedAt: job.startedAt ?? new Date(),
      currentStage: "Spec Extract",
      progress: PROGRESS_RUNNING_START,
    },
  });
  if (claim.count === 0) {
    // Race — refetch and report current truth.
    const refetched = await prisma.briefRenderJob.findUnique({
      where: { id: jobId },
    });
    if (!refetched) throw new JobNotFoundError(jobId);
    return asCachedResult(refetched);
  }

  // 5. Wire logger with persister + seed existing log so retries pick up
  // where the previous attempt left off.
  const persister = createStageLogPersister(jobId, prisma);
  const logger = new BriefRenderLogger(persister);
  if (Array.isArray(job.stageLog)) {
    logger.seedStageLog(job.stageLog as unknown as BriefStageLogEntry[]);
  }

  let stage1Spec: BriefSpec;
  let stage1CostUsd = 0;

  try {
    // 6. Stage 1 — skip if specResult is already persisted (QStash retry).
    if (job.specResult) {
      stage1Spec = job.specResult as unknown as BriefSpec;
    } else {
      const stage1 = await runStage1SpecExtract({
        briefUrl: job.briefUrl,
        jobId,
        logger,
      });
      stage1Spec = stage1.spec;
      stage1CostUsd = stage1.costUsd;

      // Persist Stage 1 result + atomically increment cost. We use a plain
      // update here (not conditional) because we hold the RUNNING claim,
      // so no other worker should be writing concurrently.
      await prisma.briefRenderJob.update({
        where: { id: jobId },
        data: {
          specResult: stage1.spec as unknown as Prisma.InputJsonValue,
          costUsd: { increment: stage1.costUsd },
          currentStage: "Prompt Gen",
          progress: PROGRESS_AFTER_STAGE_1,
        },
      });

      // Cancellation re-check between stages — a user can cancel during
      // a long Stage 1 (Anthropic call up to 120 s).
      const recheck = await prisma.briefRenderJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (recheck && recheck.status === "CANCELLED") {
        return {
          status: "CANCELLED",
          errorCode: "CANCELLED",
          errorMessage: "Job was cancelled during Spec Extract",
        };
      }
    }

    // 7. Stage 2 — pure function, no LLM, no cost.
    const stage2 = runStage2PromptGen({
      spec: stage1Spec,
      jobId,
      logger,
    });

    // 7a. Drain pending stageLog writes BEFORE the atomic transition.
    //
    // Why: `logger.startStage(2)` and `logger.endStage(2)` both fire
    // serialised (but still async) writes to the DB's stageLog
    // column. If we don't await them here, the API handler can
    // return before write B (end) lands, leaving the persisted
    // stageLog stuck at S2=running forever. The worker that
    // subsequently picks up Stage 3 then seeds itself from this
    // stale snapshot and never recovers.
    //
    // This was the bug behind the "Generating images RUNNING 35%
    // forever, 0 shots" symptom — observed via the diagnostic
    // script in scripts/diagnose-brief-render-job.ts.
    await logger.flushPending();

    // 8. Atomic transition RUNNING → AWAITING_APPROVAL. The conditional
    // status guard means a concurrent cancel during Stage 2 wins.
    const handoff = await prisma.briefRenderJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: {
        status: "AWAITING_APPROVAL",
        shots: stage2.shots as unknown as Prisma.InputJsonValue,
        currentStage: "Awaiting approval",
        progress: PROGRESS_AT_AWAITING_APPROVAL,
        pausedAt: new Date(),
        userApproval: "pending",
      },
    });
    if (handoff.count === 0) {
      // Cancelled while we were in Stage 2 — return CANCELLED.
      const refetched = await prisma.briefRenderJob.findUnique({
        where: { id: jobId },
      });
      if (refetched && refetched.status === "CANCELLED") {
        return {
          status: "CANCELLED",
          errorCode: "CANCELLED",
          errorMessage: "Job was cancelled during Prompt Gen",
        };
      }
      // Some other unexpected state — surface as FAILED.
      return await markFailed(
        prisma,
        jobId,
        "RACE_LOST",
        "Job state changed unexpectedly during Prompt Gen.",
      );
    }

    // Cumulative cost (Stage 1 only — Stage 2 is free) for the result envelope.
    const costUsd = (job.costUsd ?? 0) + stage1CostUsd;

    return {
      status: "AWAITING_APPROVAL",
      spec: stage1Spec,
      shots: stage2.shots,
      costUsd,
    };
  } catch (err) {
    const errorCode =
      err instanceof BriefRendersError
        ? err.code
        : (err as { code?: string })?.code ?? "INTERNAL_ERROR";
    // Specific-error rule (per `feedback_specific_errors.md`): never
    // replace `err.message` with a generic placeholder. Caller-facing
    // text must carry the same detail an operator would see in a
    // server log — name + message — so the failure can be diagnosed
    // from the banner alone, without a second tool.
    const errorMessage =
      err instanceof Error
        ? err.name && err.name !== "Error"
          ? `${err.name}: ${err.message}`
          : err.message
        : typeof err === "string"
          ? err
          : `Non-Error thrown: ${JSON.stringify(err).slice(0, 200)}`;
    // Drain stageLog writes before marking failed so the failed entry
    // (logged inside the throwing stage) survives. Same lost-update
    // race as the success path — see comment at step 7a above.
    await logger.flushPending();
    return await markFailed(prisma, jobId, errorCode, errorMessage);
  }
}
