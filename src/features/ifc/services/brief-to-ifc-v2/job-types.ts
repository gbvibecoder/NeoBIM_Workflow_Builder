/**
 * Shared contracts for the Brief-to-IFC v2 queued pipeline (Phase 2).
 *
 * The queued pipeline runs wf-13 as a QStash-backed background job —
 * `BriefToIfcJob` in Prisma — advancing through three Opus 4.7 stages:
 *   1. enrich    — brief  → tender-grade Markdown spec
 *   2. architect — spec   → IfcOpenShell Python builder script
 *   3. generate  — script → IFC (Railway sandbox)
 *
 * This module is the single source of truth for the status union, the
 * stage-log entry shape, the client-facing job view, the typed stage
 * error, and the progress constants — imported by the worker, the stage
 * modules, the API routes, and the client hook alike.
 */

/** Mirrors the Prisma `BriefToIfcJobStatus` enum exactly. */
export type BriefToIfcJobStatus =
  | "QUEUED"
  | "RUNNING_ENRICH"
  | "RUNNING_ARCHITECT"
  | "RUNNING_GENERATE"
  | "COMPLETED"
  | "FAILED"
  | "AWAITING_RETRY";

/** Stable `currentStage` keys — survive across worker invocations so a
 *  crash-recovery / transient-retry knows which stage to (re-)run. */
export const BRIEF_TO_IFC_STAGE = {
  ENRICH: "enrich",
  ARCHITECT: "architect",
  GENERATE: "generate",
} as const;
export type BriefToIfcStageKey =
  (typeof BRIEF_TO_IFC_STAGE)[keyof typeof BRIEF_TO_IFC_STAGE];

/** Progress milestones (0-100). Aligned with the canvas node-status bands
 *  in `run-brief-to-ifc-queued.ts`: 0-33 → TR-024 running, 34-66 → TR-022
 *  running, 67-99 → EX-006 running, 100 → done. */
export const BRIEF_TO_IFC_PROGRESS = {
  QUEUED: 0,
  ENRICH: 10,
  ARCHITECT: 45,
  GENERATE: 80,
  COMPLETED: 100,
} as const;

/** Max transient-failure retries across the whole job before it goes FAILED. */
export const BRIEF_TO_IFC_MAX_ATTEMPTS = 3;
/** Backoff (seconds) for transient-failure re-enqueues, indexed by attempt-1. */
export const BRIEF_TO_IFC_RETRY_BACKOFF_SECONDS = [10, 30, 60] as const;

/** Per-stage lifecycle status inside a stage-log entry. */
export type BriefToIfcStageStatus = "running" | "success" | "failed";

/** One row in the stage log — `BriefToIfcJob.stageLog` is `BriefToIfcStageLogEntry[]`. */
export interface BriefToIfcStageLogEntry {
  /** 1 = enrich, 2 = architect, 3 = generate. */
  stage: number;
  name: string;
  status: BriefToIfcStageStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  tokenUsage: { input: number; output: number; costUsd: number } | null;
  summary: string | null;
  error: string | null;
}

/** `BriefToIfcJob.error` shape. */
export interface BriefToIfcJobError {
  code: string;
  message: string;
  stage: string;
}

/** Audit of the generated IFC — the subset of the Railway sandbox response
 *  the pipeline persists to `BriefToIfcJob.ifcAudit`. */
export interface BriefToIfcAudit {
  total_entities: number;
  by_class: Record<string, number>;
}

/** Client-facing job view — the exact shape `GET /api/brief-to-ifc-job/[id]` returns. */
export interface BriefToIfcJobView {
  id: string;
  status: BriefToIfcJobStatus;
  progress: number;
  currentStage: string | null;
  stageLog: BriefToIfcStageLogEntry[];
  enrichedSpec: string | null;
  ifcR2Url: string | null;
  ifcEntityCount: number | null;
  ifcAudit: BriefToIfcAudit | null;
  error: BriefToIfcJobError | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Terminal statuses — the worker no-ops, the client hook stops polling. */
export function isBriefToIfcTerminal(status: BriefToIfcJobStatus): boolean {
  return status === "COMPLETED" || status === "FAILED";
}

/**
 * Typed stage error. Stage modules throw this; the worker reads `.kind` to
 * decide retry-vs-fail:
 *   "transient" — network / 5xx / abort → re-enqueue with backoff (≤ MAX_ATTEMPTS)
 *   "permanent" — 4xx / schema violation / bad input → FAILED immediately
 */
export type BriefToIfcFailureKind = "transient" | "permanent";

export class BriefToIfcStageError extends Error {
  readonly code: string;
  readonly kind: BriefToIfcFailureKind;
  readonly stageName: string;
  constructor(args: {
    code: string;
    message: string;
    kind: BriefToIfcFailureKind;
    stageName: string;
  }) {
    super(args.message);
    this.name = "BriefToIfcStageError";
    this.code = args.code;
    this.kind = args.kind;
    this.stageName = args.stageName;
  }
}

export function isBriefToIfcStageError(
  err: unknown,
): err is BriefToIfcStageError {
  return err instanceof BriefToIfcStageError;
}

/**
 * Coerce any thrown value into a `BriefToIfcStageError`. A value that is
 * already one is returned untouched. Everything else — a raw network
 * blip, an unexpected throw — is classified `"transient"`: it is bounded
 * by `BRIEF_TO_IFC_MAX_ATTEMPTS`, so a genuinely permanent fault still
 * terminates the job, just after the retry budget is spent rather than
 * immediately. Abort / timeout errors are labelled distinctly for logs.
 */
export function toBriefToIfcStageError(
  err: unknown,
  stageName: string,
): BriefToIfcStageError {
  if (isBriefToIfcStageError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  const isAbort =
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError");
  return new BriefToIfcStageError({
    code: isAbort ? "STAGE_TIMEOUT" : "STAGE_UNEXPECTED_ERROR",
    message,
    kind: "transient",
    stageName,
  });
}
