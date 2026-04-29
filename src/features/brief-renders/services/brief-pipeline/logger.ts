/**
 * BriefRenderLogger — structured stage-by-stage logging for the
 * Brief-to-Renders pipeline.
 *
 * Stripped-down counterpart of `VIPLogger` (mirrored from
 * `src/features/floor-plan/lib/vip-pipeline/logger.ts`). Phase 2 needs
 * only the canonical stage-log shape + cost accumulation; no ANSI
 * pretty-printing, no DB-record-shaping. The Phase 3 worker will pass
 * a `persister` callback that writes the full snapshot to
 * `BriefRenderJob.stageLog` JSONB on every event.
 *
 * Contract: this class **never throws**. Logging must not be able to
 * sink the pipeline. All public methods swallow internal errors.
 */
import type { BriefStageLogEntry } from "./types";

export type BriefStageStatus = "running" | "success" | "failed";

/** Persister signature — same shape VIP uses. Async or sync, fire-and-forget. */
export type StageLogPersister = (
  entries: BriefStageLogEntry[],
) => Promise<void> | void;

/**
 * Optional metadata for `endStage` and `recordCost`. Kept loose because
 * each stage carries different per-stage telemetry (token counts for S1,
 * shot results for S3, page count for S5). The logger sanitizes before
 * persisting so callers don't have to worry about JSONB size limits.
 */
export type StageMeta = Record<string, unknown>;

const STAGE_NAMES: Record<number, string> = {
  1: "Spec Extract",
  2: "Prompt Gen",
  3: "Image Gen",
  4: "PDF Compile",
};

/** Cap any single string field at this length before persisting. */
const MAX_STRING_FIELD_LEN = 2000;
/** Cap the entire serialized output blob at this size. */
const MAX_OUTPUT_BLOB_BYTES = 48_000;

export class BriefRenderLogger {
  private readonly persister?: StageLogPersister;
  private entries: BriefStageLogEntry[] = [];
  private stageCosts: Record<number, number> = {};
  private stageStartTimes: Record<number, number> = {};
  // Serialization queue for persister writes. Each flush() chains a new
  // step onto this promise so writes hit the DB in issue order. Callers
  // who need durability before continuing await `flushPending()`.
  private flushPromise: Promise<unknown> = Promise.resolve();

  constructor(persister?: StageLogPersister) {
    this.persister = persister;
  }

  /** Begin a new stage. If already running, replaces the in-flight entry. */
  startStage(stage: number, name?: string): void {
    try {
      const resolvedName = name ?? STAGE_NAMES[stage] ?? `Stage ${stage}`;
      const startedAt = new Date().toISOString();
      this.stageStartTimes[stage] = Date.now();

      const idx = this.findStageIndex(stage);
      const entry: BriefStageLogEntry = {
        stage,
        name: resolvedName,
        status: "running",
        startedAt,
        completedAt: null,
        durationMs: null,
        costUsd: this.stageCosts[stage] ?? null,
        summary: null,
        output: null,
        error: null,
      };

      if (idx >= 0 && this.entries[idx].status === "running") {
        this.entries[idx] = entry;
      } else {
        this.entries.push(entry);
      }
      this.flush();
    } catch {
      /* never throw */
    }
  }

  /**
   * Mark a stage terminal. `output` is sanitized (long strings clipped,
   * non-serializable values dropped); `error` is captured verbatim but
   * truncated. Computes `durationMs` from `startStage`.
   */
  endStage(
    stage: number,
    status: "success" | "failed",
    output?: StageMeta,
    error?: string,
  ): void {
    try {
      const completedAt = new Date().toISOString();
      const startedAtMs = this.stageStartTimes[stage];
      const durationMs =
        typeof startedAtMs === "number" ? Date.now() - startedAtMs : null;

      const idx = this.findStageIndex(stage);
      const sanitized = sanitizeOutput(output);
      const summary = buildSummary(output);
      const safeError = error ? clipString(error, MAX_STRING_FIELD_LEN) : null;

      if (idx >= 0) {
        this.entries[idx] = {
          ...this.entries[idx],
          status,
          completedAt,
          durationMs,
          costUsd: this.stageCosts[stage] ?? this.entries[idx].costUsd,
          summary,
          output: sanitized,
          error: safeError,
        };
      } else {
        // No `startStage` call — synthesize one so the timeline isn't
        // missing the entry. Useful when error paths hit endStage from
        // a catch block without a matching start.
        this.entries.push({
          stage,
          name: STAGE_NAMES[stage] ?? `Stage ${stage}`,
          status,
          startedAt: completedAt,
          completedAt,
          durationMs,
          costUsd: this.stageCosts[stage] ?? null,
          summary,
          output: sanitized,
          error: safeError,
        });
      }
      this.flush();
    } catch {
      /* never throw */
    }
  }

  /**
   * Record cost for a stage. Folds into the entry's `costUsd` if the
   * entry exists; otherwise the value is held until `startStage` /
   * `endStage` writes the entry.
   */
  recordCost(stage: number, costUsd: number): void {
    try {
      if (!Number.isFinite(costUsd)) return;
      this.stageCosts[stage] = costUsd;
      const idx = this.findStageIndex(stage);
      if (idx >= 0) {
        this.entries[idx] = { ...this.entries[idx], costUsd };
        this.flush();
      }
    } catch {
      /* never throw */
    }
  }

  /** Snapshot of the current stage log. Safe to pass to JSON.stringify. */
  getStageLog(): BriefStageLogEntry[] {
    return this.entries.slice();
  }

  /** Sum of recorded stage costs. */
  getTotalCost(): number {
    return Object.values(this.stageCosts).reduce((s, c) => s + c, 0);
  }

  /**
   * Replace the in-memory log. Used by the Phase 3 worker on resume —
   * if a job was previously persisted with stages 1+2 done, seeding
   * the logger lets stage 3 events append to the existing timeline
   * instead of overwriting it.
   */
  seedStageLog(entries: BriefStageLogEntry[]): void {
    if (!Array.isArray(entries)) return;
    this.entries = entries.slice();
    // Replay costs so getTotalCost() stays accurate post-seed.
    this.stageCosts = {};
    for (const entry of entries) {
      if (typeof entry.costUsd === "number" && Number.isFinite(entry.costUsd)) {
        this.stageCosts[entry.stage] = entry.costUsd;
      }
    }
  }

  // ── private ──────────────────────────────────────────────────────

  private findStageIndex(stage: number): number {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].stage === stage) return i;
    }
    return -1;
  }

  private flush(): void {
    if (!this.persister) return;
    const snapshot = this.entries.slice();
    const persister = this.persister;
    // Serialize writes: each new flush chains onto the previous
    // promise. This guarantees writes hit the DB in the order they
    // were issued, fixing the lost-update race where a slow
    // `startStage(N)` write could land AFTER its matching faster
    // `endStage(N)` write, reverting the stage to "running" state.
    //
    // We swallow errors on each step (silent persistence drift is
    // tolerable; throwing would crash the orchestrator). Callers who
    // need durability before transitioning state should await
    // `flushPending()` below.
    this.flushPromise = this.flushPromise.then(
      () =>
        Promise.resolve(persister(snapshot)).catch(() => {
          /* never propagate */
        }),
      () =>
        Promise.resolve(persister(snapshot)).catch(() => {
          /* never propagate */
        }),
    );
  }

  /**
   * Await any pending stageLog writes. Call this before:
   *   • The orchestrator's atomic AWAITING_APPROVAL / FAILED
   *     transition (otherwise an in-flight flush could land AFTER
   *     the transition and look like a stale rollback).
   *   • The API handler returns (otherwise the Node event loop may
   *     suspend before fire-and-forget flushes complete).
   *
   * Always resolves — never rejects — so callers don't need to
   * wrap in try/catch.
   */
  async flushPending(): Promise<void> {
    try {
      await this.flushPromise;
    } catch {
      /* swallow — flush already swallowed; this is defence in depth */
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────────

function clipString(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function sanitizeOutput(meta: StageMeta | undefined): StageMeta | null {
  if (!meta) return null;
  try {
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta)) {
      if (typeof v === "function") continue;
      if (typeof v === "string") {
        copy[k] = clipString(v, MAX_STRING_FIELD_LEN);
      } else {
        copy[k] = v;
      }
    }
    const serialized = JSON.stringify(copy);
    if (serialized.length > MAX_OUTPUT_BLOB_BYTES) {
      return {
        truncated: true,
        bytes: serialized.length,
        preview: serialized.slice(0, 400) + "…",
      };
    }
    return copy;
  } catch {
    return null;
  }
}

function buildSummary(meta: StageMeta | undefined): string | null {
  if (!meta) return null;
  // Pick the most informative 2-3 keys for the collapsed UI row.
  // Stage 1 commonly emits: apartmentCount, shotCount, baselinePopulated,
  // tokensIn, tokensOut, costUsd. Stage 3 commonly emits: succeeded,
  // failed, total. Keys here cover both cases.
  const priority = [
    "apartmentCount",
    "shotCount",
    "succeeded",
    "failed",
    "total",
    "pageCount",
    "tokensIn",
    "tokensOut",
  ];
  const parts: string[] = [];
  for (const key of priority) {
    if (key in meta) {
      const v = meta[key];
      if (v === null || v === undefined) continue;
      parts.push(`${key}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
      if (parts.length >= 3) break;
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
