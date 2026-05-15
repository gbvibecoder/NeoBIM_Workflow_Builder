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

/**
 * Phase 3 — self-heal budgets for Stage 3 (sandbox + Opus repair).
 *
 * `BRIEF_TO_IFC_STAGE_3_MAX_ATTEMPTS = 3` ⇒ at most 1 original run + 2
 * Opus-repair iterations. Worst-case timeline under the 800 s worker
 * budget (Vercel Fluid Compute):
 *
 *   sandbox₁ 120 s + repair₁ 200 s + sandbox₂ 120 s + repair₂ 200 s + sandbox₃ 120 s
 *   = 760 s  ⟶ ~40 s margin under the 800 s wall.
 *
 * The repair Opus timeout is intentionally TIGHTER than Stage 1/2's 540 s
 * because a repair is a focused fix of a ~12 KB script, not authoring
 * from scratch — Opus typically lands a repair in 30-90 s; 200 s is a
 * generous ceiling that still fits three attempts in one worker
 * invocation.
 */
export const BRIEF_TO_IFC_STAGE_3_MAX_ATTEMPTS = 3;
/** Per-call wall-clock cap for the repair Opus message stream. */
export const BRIEF_TO_IFC_REPAIR_TIMEOUT_MS = 200_000;
/** `max_tokens` for the repair Opus call. A repaired script is the same
 *  size as the original — 48 k is plenty and matches the Phase 1 architect's
 *  ceiling for comparable output. */
export const BRIEF_TO_IFC_REPAIR_MAX_TOKENS = 48_000;
/** Stage-wide wall-clock budget; if exceeded the loop bails before the
 *  next attempt rather than risk the Vercel 800 s hard kill. */
export const BRIEF_TO_IFC_STAGE_3_WALL_BUDGET_MS = 700_000;

/** One row in `BriefToIfcJob.retryHistory`. `retryHistory[0]` is always
 *  the original architect script's run; entries 1+ are Opus-repair
 *  outputs. `scriptCode` is the full Python the sandbox ran (so any
 *  failed version is downloadable from the canvas error artifact). */
export interface BriefToIfcRetryAttempt {
  /** 1-indexed attempt number. */
  attempt: number;
  /** "succeeded" — sandbox produced a valid IFC; "failed" — anything else. */
  status: "succeeded" | "failed";
  /** Full Python source the sandbox ran on this attempt. */
  scriptCode: string;
  /** `scriptCode.length` — handy for the UI without re-counting. */
  scriptLength: number;
  /** Wall-clock ms the sandbox actually spent on this run. */
  durationMs: number;
  /** Inner failure label ("IFCOPENSHELL_RUNTIME_ERROR" | …) or `null` on success. */
  errorType: string | null;
  /** Full Python traceback tail (stderr_tail) or `null` on success. */
  errorTraceback: string | null;
  /** Sandbox exit code (-1 on wall-clock timeout). `null` on success. */
  sandboxExitCode: number | null;
}

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
  /** Phase 3 — the full JSON-encoded ArchitectScriptData (python_code +
   *  expected_entity_count + summary + elements_emitted). The client
   *  parses out `python_code` to render / download the script. */
  architectScript: string | null;
  ifcR2Url: string | null;
  ifcEntityCount: number | null;
  ifcAudit: BriefToIfcAudit | null;
  error: BriefToIfcJobError | null;
  /** Phase 3 — last failing sandbox traceback (verbatim stderr tail). */
  errorTraceback: string | null;
  /** Phase 3 — inner sandbox failure label, e.g. `IFCOPENSHELL_RUNTIME_ERROR`. */
  errorType: string | null;
  /** Phase 3 — how many Stage-3 attempts have run (0 if pre-Stage-3). */
  attemptCount: number;
  /** Phase 3 — one entry per Stage-3 sandbox attempt. */
  retryHistory: BriefToIfcRetryAttempt[];
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
