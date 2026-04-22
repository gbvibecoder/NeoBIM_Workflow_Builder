/**
 * VIP Pipeline Logger — structured stage-by-stage logging.
 *
 * Dev (NODE_ENV=development): colored ANSI box-drawing output.
 * Prod (NODE_ENV=production): single-line JSON per event.
 *
 * NEVER throws. Console logs are priority 1, DB persistence is priority 2.
 */

import type { StageLogEntry, StageLogStatus } from "./types";

const STAGE_NAMES: Record<number, string> = {
  0: "Parse Constraints",
  1: "Prompt Intelligence",
  2: "Parallel Image Gen",
  3: "Vision Jury",
  4: "Room Extraction",
  5: "Synthesis",
  6: "Quality Gate",
  7: "Delivery",
};

/**
 * Phase 2.6: pull a numeric cost out of the meta bag. Some call-sites
 * pass cost as a preformatted string like "$0.015" (for console output)
 * and some pass it as a raw number via `costUsd`. Accept either.
 */
function extractCost(meta: Record<string, unknown> | undefined): number | undefined {
  if (!meta) return undefined;
  const cu = meta.costUsd;
  if (typeof cu === "number" && Number.isFinite(cu)) return cu;
  const c = meta.cost;
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (typeof c === "string") {
    const m = c.match(/\$?([0-9]+(?:\.[0-9]+)?)/);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
} as const;

// ─── DB Record Shape ─────────────────────────────────────────────

export interface VIPGenerationRecord {
  requestId: string;
  userId: string;
  prompt: string;
  status: "RUNNING" | "SUCCESS" | "FALL_THROUGH" | "FAILED";
  pipelineUsed: string | null;
  stageTimings: Record<string, number>;
  stageCosts: Record<string, number>;
  stageErrors: Record<string, string>;
  finalScore: number | null;
  totalDurationMs: number;
  totalCostUsd: number | null;
  fallThroughReason: string | null;
}

// ─── Logger Class ────────────────────────────────────────────────

export class VIPLogger {
  private readonly requestId: string;
  private readonly shortId: string;
  private readonly userId: string;
  private readonly prompt: string;
  private readonly startMs: number;
  private readonly isProd: boolean;

  private stageTimings: Record<string, number> = {};
  private stageCosts: Record<string, number> = {};
  private stageErrors: Record<string, string> = {};
  private status: VIPGenerationRecord["status"] = "RUNNING";
  private pipelineUsed: string | null = null;
  private finalScore: number | null = null;
  private totalCostUsd: number | null = null;
  private fallThroughReason: string | null = null;

  /**
   * Phase 2.6: structured stage log for the Pipeline Logs Panel.
   * Maintained in-memory and mirrored to vip_jobs.stageLog via
   * onStageLog after every lifecycle event.
   */
  private stageLog: StageLogEntry[] = [];
  private readonly onStageLog?: (entries: StageLogEntry[]) => Promise<void> | void;

  constructor(
    requestId: string,
    userId: string,
    prompt: string,
    onStageLog?: (entries: StageLogEntry[]) => Promise<void> | void,
  ) {
    this.requestId = requestId;
    this.shortId = requestId.slice(0, 8);
    this.userId = userId;
    this.prompt = prompt;
    this.startMs = Date.now();
    this.isProd = process.env.NODE_ENV === "production";
    this.onStageLog = onStageLog;
  }

  /**
   * Phase 2.6: allow callers that share a VipJob across multiple VIPLogger
   * instances (Phase B resume, image regenerate) to seed the log with
   * entries already persisted to the DB, so new events append to the
   * existing timeline instead of overwriting it.
   */
  seedStageLog(entries: StageLogEntry[]): void {
    if (!Array.isArray(entries)) return;
    this.stageLog = entries.slice();
  }

  /** Snapshot of the current stage log — intended for worker-level persistence. */
  getStageLog(): StageLogEntry[] {
    return this.stageLog.slice();
  }

  logStart(): void {
    try {
      const p = this.prompt.length > 60 ? this.prompt.slice(0, 60) + "…" : this.prompt;
      if (this.isProd) {
        this.json("info", "pipeline_start", { prompt: p, userId: this.userId });
      } else {
        console.log(`${C.cyan}┌─ [VIP:${this.shortId}]${C.reset} ${C.bold}"${p}"${C.reset}`);
        console.log(`${C.cyan}│${C.reset}  ${C.gray}user: ${this.userId}${C.reset}`);
      }
    } catch { /* never throw */ }
  }

  logStageStart(stage: number, name?: string): void {
    try {
      const n = name ?? STAGE_NAMES[stage] ?? `Stage ${stage}`;
      if (this.isProd) {
        this.json("info", "stage_start", { stage, name: n });
      } else {
        console.log(`${C.cyan}├─${C.reset} Stage ${stage} (${n})${C.gray}     started${C.reset}`);
      }
      this.upsertStageEntry({
        stage,
        name: n,
        status: "running",
        startedAt: new Date().toISOString(),
      });
    } catch { /* never throw */ }
  }

  logStageSuccess(stage: number, durationMs: number, meta?: Record<string, unknown>): void {
    try {
      this.stageTimings[String(stage)] = durationMs;
      const s = (durationMs / 1000).toFixed(1);
      if (this.isProd) {
        this.json("info", "stage_success", { stage, durMs: durationMs, ...(meta ?? {}) });
      } else {
        const m = meta ? `   ${C.gray}${fmtMeta(meta)}${C.reset}` : "";
        console.log(`${C.cyan}├─${C.reset} Stage ${stage} ${C.green}✓${C.reset} ${s}s${m}`);
      }
      const cost = extractCost(meta);
      if (typeof cost === "number") this.stageCosts[String(stage)] = cost;
      this.finalizeStageEntry(stage, {
        status: "success",
        durationMs,
        costUsd: cost,
        summary: buildSummary(meta),
        output: sanitizeMeta(meta),
      });
    } catch { /* never throw */ }
  }

  logStageFailure(stage: number, durationMs: number, error: string, meta?: Record<string, unknown>): void {
    try {
      this.stageTimings[String(stage)] = durationMs;
      this.stageErrors[String(stage)] = error;
      const s = (durationMs / 1000).toFixed(1);
      if (this.isProd) {
        this.json("error", "stage_failure", { stage, durMs: durationMs, error, ...(meta ?? {}) });
      } else {
        console.log(`${C.cyan}├─${C.reset} Stage ${stage} ${C.red}✗${C.reset} ${s}s   ${C.red}${error}${C.reset}`);
      }
      this.finalizeStageEntry(stage, {
        status: "failed",
        durationMs,
        error,
        output: sanitizeMeta(meta),
      });
    } catch { /* never throw */ }
  }

  logStageCost(stage: number, costUsd: number): void {
    try {
      this.stageCosts[String(stage)] = costUsd;
      // Phase 2.6: if a stage entry exists for this stage, fold the cost
      // into it so the UI reflects the retroactive number. Used when
      // Phase B reseeds Stage 1/2 costs at resume time.
      const idx = this.findStageIndex(stage);
      if (idx >= 0) {
        this.stageLog[idx] = { ...this.stageLog[idx], costUsd };
        this.flushStageLog();
      }
    } catch { /* never throw */ }
  }

  logFallThrough(reason: string): void {
    try {
      this.status = "FALL_THROUGH";
      this.fallThroughReason = reason;
      const ms = Date.now() - this.startMs;
      const cost = this.sumCosts();
      this.totalCostUsd = cost;
      if (this.isProd) {
        this.json("warn", "fall_through", { reason, durMs: ms, costUsd: cost });
      } else {
        const c = cost > 0 ? ` · $${cost.toFixed(2)}` : "";
        console.log(
          `${C.cyan}└─${C.reset} ${C.yellow}FALL_THROUGH${C.reset} to PIPELINE_REF · ${(ms / 1000).toFixed(1)}s${c}`,
        );
      }
    } catch { /* never throw */ }
  }

  logSuccess(score: number, costUsd?: number): void {
    try {
      this.status = "SUCCESS";
      this.finalScore = score;
      const ms = Date.now() - this.startMs;
      const cost = costUsd ?? this.sumCosts();
      this.totalCostUsd = cost;
      if (this.isProd) {
        this.json("info", "pipeline_success", { durMs: ms, score, costUsd: cost });
      } else {
        const c = cost > 0 ? ` · $${cost.toFixed(2)}` : "";
        console.log(
          `${C.cyan}└─${C.reset} ${C.green}SUCCESS${C.reset} score=${score}/100 · ${(ms / 1000).toFixed(1)}s${c}`,
        );
      }
    } catch { /* never throw */ }
  }

  logFailure(reason: string): void {
    try {
      this.status = "FAILED";
      const ms = Date.now() - this.startMs;
      const cost = this.sumCosts();
      this.totalCostUsd = cost;
      if (this.isProd) {
        this.json("error", "pipeline_failure", { reason, durMs: ms, costUsd: cost });
      } else {
        const c = cost > 0 ? ` · $${cost.toFixed(2)}` : "";
        console.log(
          `${C.cyan}└─${C.reset} ${C.red}FAILED${C.reset} ${reason} · ${(ms / 1000).toFixed(1)}s${c}`,
        );
      }
    } catch { /* never throw */ }
  }

  toDbRecord(): VIPGenerationRecord {
    return {
      requestId: this.requestId,
      userId: this.userId,
      prompt: this.prompt,
      status: this.status,
      pipelineUsed: this.pipelineUsed,
      stageTimings: { ...this.stageTimings },
      stageCosts: { ...this.stageCosts },
      stageErrors: { ...this.stageErrors },
      finalScore: this.finalScore,
      totalDurationMs: Date.now() - this.startMs,
      totalCostUsd: this.totalCostUsd,
      fallThroughReason: this.fallThroughReason,
    };
  }

  /** Sum all stage costs accumulated so far. Public for Stage 7 to read live total. */
  computeTotalCost(): number {
    return Object.values(this.stageCosts).reduce((s, c) => s + c, 0);
  }

  // ── Private ────────────────────────────────────────────────────

  private sumCosts(): number {
    return this.computeTotalCost();
  }

  /**
   * Phase 2.6: find the most-recent log entry for a given stage. Returns
   * -1 if none found. We iterate back-to-front because a stage can retry
   * (orchestrator.ts runs Stage 2 twice on quality-gate retry) and the
   * newest entry is the one we want to finalize.
   */
  private findStageIndex(stage: number): number {
    for (let i = this.stageLog.length - 1; i >= 0; i--) {
      if (this.stageLog[i].stage === stage) return i;
    }
    return -1;
  }

  /** Push a new running entry, or replace the most-recent running one for this stage. */
  private upsertStageEntry(entry: StageLogEntry): void {
    const idx = this.findStageIndex(entry.stage);
    if (idx >= 0 && this.stageLog[idx].status === "running") {
      // Two logStageStart calls in a row for the same stage — replace.
      this.stageLog[idx] = entry;
    } else {
      this.stageLog.push(entry);
    }
    this.flushStageLog();
  }

  /** Merge completion fields into the most-recent running entry for a stage. */
  private finalizeStageEntry(
    stage: number,
    patch: Partial<StageLogEntry> & { status: StageLogStatus },
  ): void {
    const idx = this.findStageIndex(stage);
    const completedAt = new Date().toISOString();
    if (idx < 0) {
      // No running entry — synthesize one (e.g. logStageFailure called without logStageStart).
      this.stageLog.push({
        stage,
        name: STAGE_NAMES[stage] ?? `Stage ${stage}`,
        status: patch.status,
        startedAt: completedAt,
        completedAt,
        durationMs: patch.durationMs,
        costUsd: patch.costUsd,
        summary: patch.summary,
        output: patch.output,
        error: patch.error,
      });
    } else {
      this.stageLog[idx] = {
        ...this.stageLog[idx],
        ...patch,
        completedAt,
      };
    }
    this.flushStageLog();
  }

  /** Fire-and-forget notify the caller; errors are swallowed. */
  private flushStageLog(): void {
    if (!this.onStageLog) return;
    try {
      const snapshot = this.stageLog.slice();
      const p = this.onStageLog(snapshot);
      if (p && typeof (p as Promise<unknown>).catch === "function") {
        (p as Promise<unknown>).catch(() => {});
      }
    } catch { /* never throw */ }
  }

  private json(lvl: string, event: string, data: Record<string, unknown>): void {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      lvl,
      req: this.shortId,
      event,
      ...data,
    });
    if (lvl === "error") console.error(entry);
    else if (lvl === "warn") console.warn(entry);
    else console.log(entry);
  }
}

function fmtMeta(meta: Record<string, unknown>): string {
  return Object.entries(meta)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

/**
 * Phase 2.6: produce a short human-readable summary from stage meta
 * for the collapsed row in the Pipeline Logs Panel. Picks the most
 * informative 2-3 keys. Returns undefined when meta is empty.
 */
function buildSummary(meta: Record<string, unknown> | undefined): string | undefined {
  if (!meta) return undefined;
  const priority = [
    "rooms",
    "images",
    "score",
    "qualityScore",
    "recommendation",
    "walls",
    "doors",
    "windows",
    "succeeded",
    "failed",
    "issues",
  ];
  const parts: string[] = [];
  for (const key of priority) {
    if (key in meta) {
      const v = meta[key];
      if (v === null || v === undefined) continue;
      if (typeof v === "object") parts.push(`${key}: ${JSON.stringify(v)}`);
      else parts.push(`${key}: ${String(v)}`);
    }
    if (parts.length >= 3) break;
  }

  // Phase 2.9: append a compact enhancement badge for Stage 5 rows
  // (e.g. "enhance: ON ✓", "enhance: OFF · no bias", "enhance: reverted").
  const enhancementBadge = formatEnhancementBadge(meta);
  if (enhancementBadge) parts.push(enhancementBadge);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Phase 2.9: short badge describing the classifier / enhancement
 * outcome. Pulled out of `buildSummary` so the Logs Panel can render
 * it both inline and in a dedicated expanded block.
 */
function formatEnhancementBadge(
  meta: Record<string, unknown> | undefined,
): string | undefined {
  const e = meta?.enhancement as Record<string, unknown> | undefined;
  if (!e || typeof e !== "object") return undefined;
  if (e.classified === true) {
    if (e.dimCorrectionRollback || e.adjEnforcementRollback) {
      return "enhance: reverted (overlap)";
    }
    const bits: string[] = [];
    if (e.dimCorrectionApplied === true) bits.push("dims");
    if (e.adjEnforcementApplied === true) bits.push("adj");
    return bits.length > 0 ? `enhance: ON · ${bits.join("+")}` : "enhance: ON";
  }
  if (e.classified === false) {
    const reasons = Array.isArray(e.reasons) ? (e.reasons as unknown[]) : [];
    const first = reasons.length > 0 ? String(reasons[0]).slice(0, 40) : "gated";
    return `enhance: OFF · ${first}`;
  }
  return undefined;
}

/**
 * Phase 2.6: sanitize meta for storage. Strips ANSI helpers / functions,
 * clips long strings, and caps total JSON size at ~48KB to stay safely
 * under Postgres JSONB per-row practical limits. Returns undefined when
 * meta is empty or not a plain object.
 */
function sanitizeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  try {
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta)) {
      if (typeof v === "function") continue;
      if (typeof v === "string" && v.length > 2000) {
        copy[k] = v.slice(0, 2000) + "…";
      } else {
        copy[k] = v;
      }
    }
    const serialized = JSON.stringify(copy);
    if (serialized.length > 48_000) {
      return { truncated: true, bytes: serialized.length, preview: serialized.slice(0, 400) + "…" };
    }
    return copy;
  } catch {
    return undefined;
  }
}
