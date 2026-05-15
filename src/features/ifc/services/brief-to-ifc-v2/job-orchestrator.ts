/**
 * Orchestrator for the Brief-to-IFC v2 queued pipeline (Phase 2).
 *
 * One worker invocation = one call to `runBriefToIfcOrchestrator`. It runs
 * exactly ONE stage, then either advances the job + re-enqueues the next
 * worker, schedules a backed-off retry, or terminates the job. The QStash
 * worker route is a thin shell around this function.
 *
 * Concurrency model — mirrors `brief-renders`' atomic-claim discipline:
 *   • A worker claims a stage with an atomic `updateMany` guarded on both
 *     the eligible status set AND the `lockedAt` lock (null or stale).
 *     `count === 0` ⇒ the claim was lost (double-delivery / another
 *     worker / already terminal) ⇒ no-op, return.
 *   • The lock is released (`lockedAt: null`) on every exit path —
 *     success advance, retry schedule, or failure.
 *   • Every status transition is itself an atomic `updateMany` guarded on
 *     the status we believe we hold, so a late/duplicate worker can never
 *     stomp a job another worker already moved on.
 *   • `markFailed` never overwrites a terminal status.
 *
 * Stages run STRICTLY sequentially (enrich → architect → generate); there
 * is no fan-out, so no JSONB-element patching is needed.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

import { logger as appLogger } from "@/lib/logger";
import { pusherTrigger } from "@/lib/pusher-server";
import { scheduleBriefToIfcWorker } from "@/lib/qstash";

import {
  BRIEF_TO_IFC_STAGE,
  BRIEF_TO_IFC_PROGRESS,
  BRIEF_TO_IFC_MAX_ATTEMPTS,
  BRIEF_TO_IFC_RETRY_BACKOFF_SECONDS,
  isBriefToIfcTerminal,
  toBriefToIfcStageError,
  type BriefToIfcJobStatus,
  type BriefToIfcStageKey,
  type BriefToIfcStageLogEntry,
  type BriefToIfcJobError,
} from "./job-types";
import { BriefToIfcJobLogger } from "./job-logger";
import { createBriefToIfcStageLogPersister } from "./job-stage-log-store";
import { runEnrichStage } from "./stage-1-enrich";
import { runArchitectStage } from "./stage-2-architect";
import { runGenerateStage } from "./stage-3-generate";

/** A lock older than this is considered stale and reclaimable. Must exceed
 *  the worker's wall-clock budget (maxDuration 800s) plus margin so a
 *  still-running worker is never stomped. The cleanup cron uses the same
 *  threshold to sweep genuinely-stuck jobs to FAILED. */
export const BRIEF_TO_IFC_STALE_LOCK_MS = 15 * 60 * 1000;

/** Pusher channel for a job's live progress events. */
export function briefToIfcChannel(jobId: string): string {
  return `brief-to-ifc-${jobId}`;
}

interface StageConfigEntry {
  /** Status while this stage runs / is queued to run. */
  runningStatus: BriefToIfcJobStatus;
  /** Statuses a worker may claim this stage FROM. */
  claimFrom: BriefToIfcJobStatus[];
  /** Progress to set on claim. */
  progress: number;
  /** 1 | 2 | 3 — matches the stage-log entry `stage`. */
  stageNumber: number;
  /** Status after this stage succeeds — `COMPLETED` for the last stage. */
  nextStatus: BriefToIfcJobStatus;
  /** Stage key after this one — `null` for the last stage. */
  nextStage: BriefToIfcStageKey | null;
  /** Progress to set when this stage succeeds and the job advances. */
  nextProgress: number;
}

const STAGE_CONFIG: Record<BriefToIfcStageKey, StageConfigEntry> = {
  [BRIEF_TO_IFC_STAGE.ENRICH]: {
    runningStatus: "RUNNING_ENRICH",
    claimFrom: ["QUEUED", "RUNNING_ENRICH", "AWAITING_RETRY"],
    progress: BRIEF_TO_IFC_PROGRESS.ENRICH,
    stageNumber: 1,
    nextStatus: "RUNNING_ARCHITECT",
    nextStage: BRIEF_TO_IFC_STAGE.ARCHITECT,
    nextProgress: BRIEF_TO_IFC_PROGRESS.ARCHITECT,
  },
  [BRIEF_TO_IFC_STAGE.ARCHITECT]: {
    runningStatus: "RUNNING_ARCHITECT",
    claimFrom: ["RUNNING_ARCHITECT", "AWAITING_RETRY"],
    progress: BRIEF_TO_IFC_PROGRESS.ARCHITECT,
    stageNumber: 2,
    nextStatus: "RUNNING_GENERATE",
    nextStage: BRIEF_TO_IFC_STAGE.GENERATE,
    nextProgress: BRIEF_TO_IFC_PROGRESS.GENERATE,
  },
  [BRIEF_TO_IFC_STAGE.GENERATE]: {
    runningStatus: "RUNNING_GENERATE",
    claimFrom: ["RUNNING_GENERATE", "AWAITING_RETRY"],
    progress: BRIEF_TO_IFC_PROGRESS.GENERATE,
    stageNumber: 3,
    nextStatus: "COMPLETED",
    nextStage: null,
    nextProgress: BRIEF_TO_IFC_PROGRESS.COMPLETED,
  },
};

export type BriefToIfcOrchestratorOutcome =
  | "advanced"
  | "completed"
  | "failed"
  | "retry-scheduled"
  | "noop";

export interface BriefToIfcOrchestratorResult {
  jobId: string;
  status: BriefToIfcJobStatus;
  ranStage: BriefToIfcStageKey | null;
  outcome: BriefToIfcOrchestratorOutcome;
  detail: string;
}

export interface BriefToIfcOrchestratorArgs {
  jobId: string;
  prisma: PrismaClient;
}

/** Which stage a worker should run, given the job's status + currentStage. */
function resolveTargetStage(
  status: BriefToIfcJobStatus,
  currentStage: string | null,
): BriefToIfcStageKey | null {
  switch (status) {
    case "QUEUED":
    case "RUNNING_ENRICH":
      return BRIEF_TO_IFC_STAGE.ENRICH;
    case "RUNNING_ARCHITECT":
      return BRIEF_TO_IFC_STAGE.ARCHITECT;
    case "RUNNING_GENERATE":
      return BRIEF_TO_IFC_STAGE.GENERATE;
    case "AWAITING_RETRY":
      if (currentStage === BRIEF_TO_IFC_STAGE.ENRICH)
        return BRIEF_TO_IFC_STAGE.ENRICH;
      if (currentStage === BRIEF_TO_IFC_STAGE.ARCHITECT)
        return BRIEF_TO_IFC_STAGE.ARCHITECT;
      if (currentStage === BRIEF_TO_IFC_STAGE.GENERATE)
        return BRIEF_TO_IFC_STAGE.GENERATE;
      return null;
    default:
      return null;
  }
}

/**
 * Mark a job FAILED. Guarded so it never overwrites a terminal status —
 * a late worker losing a race must not flip a COMPLETED job to FAILED.
 */
async function markFailed(
  prisma: PrismaClient,
  jobId: string,
  error: BriefToIfcJobError,
  attempts?: number,
): Promise<void> {
  await prisma.briefToIfcJob.updateMany({
    where: { id: jobId, status: { notIn: ["COMPLETED", "FAILED"] } },
    data: {
      status: "FAILED",
      error: error as unknown as Prisma.InputJsonValue,
      currentStage: error.stage,
      completedAt: new Date(),
      lockedAt: null,
      ...(typeof attempts === "number" ? { attempts } : {}),
    },
  });
}

/** Re-read the job's status — used after a lost claim to report accurately. */
async function readStatus(
  prisma: PrismaClient,
  jobId: string,
  fallback: BriefToIfcJobStatus,
): Promise<BriefToIfcJobStatus> {
  const fresh = await prisma.briefToIfcJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return fresh?.status ?? fallback;
}

/** Stage succeeded — drain the stage log, advance status, re-enqueue. */
async function advanceAfterSuccess(
  prisma: PrismaClient,
  jobId: string,
  targetStage: BriefToIfcStageKey,
): Promise<BriefToIfcOrchestratorResult> {
  const cfg = STAGE_CONFIG[targetStage];

  // Terminal stage — the pipeline is complete.
  if (cfg.nextStatus === "COMPLETED") {
    const done = await prisma.briefToIfcJob.updateMany({
      where: { id: jobId, status: cfg.runningStatus },
      data: {
        status: "COMPLETED",
        progress: BRIEF_TO_IFC_PROGRESS.COMPLETED,
        currentStage: null,
        completedAt: new Date(),
        lockedAt: null,
        error: Prisma.DbNull,
      },
    });
    if (done.count === 0) {
      return {
        jobId,
        status: await readStatus(prisma, jobId, cfg.runningStatus),
        ranStage: targetStage,
        outcome: "noop",
        detail: "complete-claim-lost",
      };
    }
    void pusherTrigger(briefToIfcChannel(jobId), "job:completed", {
      jobId,
      status: "COMPLETED",
      progress: BRIEF_TO_IFC_PROGRESS.COMPLETED,
    });
    appLogger.info(`[brief-to-ifc] job ${jobId} COMPLETED`);
    return {
      jobId,
      status: "COMPLETED",
      ranStage: targetStage,
      outcome: "completed",
      detail: "pipeline-complete",
    };
  }

  // Intermediate stage — advance to the next stage's running status.
  const advance = await prisma.briefToIfcJob.updateMany({
    where: { id: jobId, status: cfg.runningStatus },
    data: {
      status: cfg.nextStatus,
      currentStage: cfg.nextStage,
      progress: cfg.nextProgress,
      lockedAt: null,
    },
  });
  if (advance.count === 0) {
    return {
      jobId,
      status: await readStatus(prisma, jobId, cfg.runningStatus),
      ranStage: targetStage,
      outcome: "noop",
      detail: "advance-claim-lost",
    };
  }

  // Dispatch the next worker. If QStash dispatch fails, the job stays in
  // the advanced RUNNING_* status with its stage output saved — the
  // cleanup cron sweeps it. Reverting would discard the completed stage.
  try {
    await scheduleBriefToIfcWorker(jobId);
  } catch (dispatchErr) {
    appLogger.error(
      `[brief-to-ifc] job ${jobId} advanced to ${cfg.nextStatus} but ` +
        `re-enqueue failed: ${
          dispatchErr instanceof Error
            ? dispatchErr.message
            : String(dispatchErr)
        }`,
    );
    return {
      jobId,
      status: cfg.nextStatus,
      ranStage: targetStage,
      outcome: "advanced",
      detail: "advanced-but-dispatch-failed",
    };
  }

  void pusherTrigger(briefToIfcChannel(jobId), "stage:completed", {
    jobId,
    completedStage: targetStage,
    status: cfg.nextStatus,
    progress: cfg.nextProgress,
  });
  appLogger.info(
    `[brief-to-ifc] job ${jobId} stage "${targetStage}" done → ${cfg.nextStatus}`,
  );
  return {
    jobId,
    status: cfg.nextStatus,
    ranStage: targetStage,
    outcome: "advanced",
    detail: `next-${cfg.nextStatus}`,
  };
}

/** Stage threw — classify, then either retry (backed off) or fail. */
async function handleStageFailure(
  prisma: PrismaClient,
  jobId: string,
  targetStage: BriefToIfcStageKey,
  priorAttempts: number,
  err: unknown,
): Promise<BriefToIfcOrchestratorResult> {
  const cfg = STAGE_CONFIG[targetStage];
  const stageErr = toBriefToIfcStageError(err, targetStage);
  const jobError: BriefToIfcJobError = {
    code: stageErr.code,
    message: stageErr.message,
    stage: targetStage,
  };

  // Permanent — fail immediately.
  if (stageErr.kind === "permanent") {
    await markFailed(prisma, jobId, jobError);
    void pusherTrigger(briefToIfcChannel(jobId), "job:failed", {
      jobId,
      status: "FAILED",
      error: jobError,
    });
    appLogger.warn(
      `[brief-to-ifc] job ${jobId} FAILED (permanent) at "${targetStage}": ${stageErr.code}`,
    );
    return {
      jobId,
      status: "FAILED",
      ranStage: targetStage,
      outcome: "failed",
      detail: stageErr.code,
    };
  }

  // Transient — retry unless the global attempt budget is spent.
  const nextAttempts = priorAttempts + 1;
  if (nextAttempts >= BRIEF_TO_IFC_MAX_ATTEMPTS) {
    await markFailed(
      prisma,
      jobId,
      {
        ...jobError,
        message: `${stageErr.message} (exhausted ${BRIEF_TO_IFC_MAX_ATTEMPTS} attempts)`,
      },
      nextAttempts,
    );
    void pusherTrigger(briefToIfcChannel(jobId), "job:failed", {
      jobId,
      status: "FAILED",
      error: jobError,
    });
    appLogger.warn(
      `[brief-to-ifc] job ${jobId} FAILED (retries exhausted) at "${targetStage}": ${stageErr.code}`,
    );
    return {
      jobId,
      status: "FAILED",
      ranStage: targetStage,
      outcome: "failed",
      detail: "max-attempts",
    };
  }

  // Move to AWAITING_RETRY (we hold the lock — status is `runningStatus`).
  const backoffSeconds =
    BRIEF_TO_IFC_RETRY_BACKOFF_SECONDS[
      Math.min(nextAttempts - 1, BRIEF_TO_IFC_RETRY_BACKOFF_SECONDS.length - 1)
    ];
  const retryClaim = await prisma.briefToIfcJob.updateMany({
    where: { id: jobId, status: cfg.runningStatus },
    data: {
      status: "AWAITING_RETRY",
      currentStage: targetStage,
      attempts: nextAttempts,
      error: jobError as unknown as Prisma.InputJsonValue,
      lockedAt: null,
    },
  });
  if (retryClaim.count === 0) {
    return {
      jobId,
      status: await readStatus(prisma, jobId, cfg.runningStatus),
      ranStage: targetStage,
      outcome: "noop",
      detail: "retry-claim-lost",
    };
  }

  // Dispatch-or-revert: a retry we can't enqueue is a dead job — fail it
  // loudly rather than leave it stuck in AWAITING_RETRY forever.
  try {
    await scheduleBriefToIfcWorker(jobId, { delay: backoffSeconds });
  } catch (dispatchErr) {
    appLogger.error(
      `[brief-to-ifc] job ${jobId} retry re-enqueue failed: ${
        dispatchErr instanceof Error
          ? dispatchErr.message
          : String(dispatchErr)
      }`,
    );
    await markFailed(
      prisma,
      jobId,
      {
        code: "RETRY_DISPATCH_FAILED",
        message: `Transient failure "${stageErr.code}" could not be retried — re-enqueue failed.`,
        stage: targetStage,
      },
      nextAttempts,
    );
    return {
      jobId,
      status: "FAILED",
      ranStage: targetStage,
      outcome: "failed",
      detail: "retry-dispatch-failed",
    };
  }

  void pusherTrigger(briefToIfcChannel(jobId), "job:retry", {
    jobId,
    status: "AWAITING_RETRY",
    stage: targetStage,
    attempt: nextAttempts,
    backoffSeconds,
    error: jobError,
  });
  appLogger.info(
    `[brief-to-ifc] job ${jobId} transient failure at "${targetStage}" — ` +
      `retry ${nextAttempts}/${BRIEF_TO_IFC_MAX_ATTEMPTS} in ${backoffSeconds}s`,
  );
  return {
    jobId,
    status: "AWAITING_RETRY",
    ranStage: targetStage,
    outcome: "retry-scheduled",
    detail: `attempt-${nextAttempts}`,
  };
}

/**
 * Advance a Brief-to-IFC job by exactly one stage. Idempotent and
 * safe under QStash at-least-once delivery — concurrent / duplicate
 * invocations lose the atomic claim and no-op.
 */
export async function runBriefToIfcOrchestrator(
  args: BriefToIfcOrchestratorArgs,
): Promise<BriefToIfcOrchestratorResult> {
  const { jobId, prisma } = args;

  // 1. Load the job.
  const job = await prisma.briefToIfcJob.findUnique({ where: { id: jobId } });
  if (!job) {
    appLogger.warn(`[brief-to-ifc] orchestrator: job ${jobId} not found`);
    return {
      jobId,
      status: "FAILED",
      ranStage: null,
      outcome: "noop",
      detail: "job-not-found",
    };
  }

  // 2. Already terminal — nothing to do.
  if (isBriefToIfcTerminal(job.status)) {
    return {
      jobId,
      status: job.status,
      ranStage: null,
      outcome: "noop",
      detail: "already-terminal",
    };
  }

  // 3. Resolve which stage to run.
  const targetStage = resolveTargetStage(job.status, job.currentStage);
  if (!targetStage) {
    await markFailed(prisma, jobId, {
      code: "INCONSISTENT_STATE",
      message:
        `Job is ${job.status} with currentStage="${job.currentStage ?? "null"}" ` +
        "— cannot resolve which stage to run.",
      stage: job.currentStage ?? "unknown",
    });
    appLogger.error(
      `[brief-to-ifc] job ${jobId} inconsistent state — status=${job.status} currentStage=${job.currentStage}`,
    );
    return {
      jobId,
      status: "FAILED",
      ranStage: null,
      outcome: "failed",
      detail: "inconsistent-state",
    };
  }

  // 4. Atomically claim the stage — guarded on status set AND a free/stale
  //    lock. A lost claim (count 0) means a duplicate delivery or another
  //    worker; no-op cleanly.
  const cfg = STAGE_CONFIG[targetStage];
  const staleLockBefore = new Date(Date.now() - BRIEF_TO_IFC_STALE_LOCK_MS);
  const claim = await prisma.briefToIfcJob.updateMany({
    where: {
      id: jobId,
      status: { in: cfg.claimFrom },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleLockBefore } }],
    },
    data: {
      status: cfg.runningStatus,
      currentStage: targetStage,
      progress: cfg.progress,
      startedAt: job.startedAt ?? new Date(),
      lockedAt: new Date(),
    },
  });
  if (claim.count === 0) {
    appLogger.info(
      `[brief-to-ifc] job ${jobId} claim lost for stage "${targetStage}" — no-op`,
    );
    return {
      jobId,
      status: await readStatus(prisma, jobId, job.status),
      ranStage: null,
      outcome: "noop",
      detail: "claim-lost",
    };
  }

  void pusherTrigger(briefToIfcChannel(jobId), "stage:started", {
    jobId,
    stage: targetStage,
    status: cfg.runningStatus,
    progress: cfg.progress,
  });
  appLogger.info(
    `[brief-to-ifc] job ${jobId} claimed stage "${targetStage}" (attempt ${job.attempts + 1})`,
  );

  // 5. Wire a logger seeded from the persisted stage log.
  const logger = new BriefToIfcJobLogger(
    createBriefToIfcStageLogPersister(jobId, prisma),
  );
  if (Array.isArray(job.stageLog)) {
    logger.seedStageLog(job.stageLog as unknown as BriefToIfcStageLogEntry[]);
  }

  // 6. Run exactly one stage.
  try {
    if (targetStage === BRIEF_TO_IFC_STAGE.ENRICH) {
      await runEnrichStage({ jobId, prisma, logger });
    } else if (targetStage === BRIEF_TO_IFC_STAGE.ARCHITECT) {
      await runArchitectStage({ jobId, prisma, logger });
    } else {
      await runGenerateStage({ jobId, prisma, logger });
    }
  } catch (err) {
    // Drain stage-log writes BEFORE the atomic transition so the failed
    // entry is durable.
    await logger.flushPending();
    return handleStageFailure(prisma, jobId, targetStage, job.attempts, err);
  }

  // 7. Stage succeeded — drain stage-log writes, then advance.
  await logger.flushPending();
  return advanceAfterSuccess(prisma, jobId, targetStage);
}
