/**
 * VIP Pipeline Logger — structured stage-by-stage logging.
 *
 * Dev (NODE_ENV=development): colored ANSI box-drawing output.
 * Prod (NODE_ENV=production): single-line JSON per event.
 *
 * NEVER throws. Console logs are priority 1, DB persistence is priority 2.
 */

const STAGE_NAMES: Record<number, string> = {
  1: "Prompt Intelligence",
  2: "Parallel Image Gen",
  3: "Vision Jury",
  4: "Room Extraction",
  5: "Synthesis",
  6: "Quality Gate",
  7: "Delivery",
};

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

  constructor(requestId: string, userId: string, prompt: string) {
    this.requestId = requestId;
    this.shortId = requestId.slice(0, 8);
    this.userId = userId;
    this.prompt = prompt;
    this.startMs = Date.now();
    this.isProd = process.env.NODE_ENV === "production";
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
    } catch { /* never throw */ }
  }

  logStageCost(stage: number, costUsd: number): void {
    try {
      this.stageCosts[String(stage)] = costUsd;
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

  // ── Private ────────────────────────────────────────────────────

  private sumCosts(): number {
    return Object.values(this.stageCosts).reduce((s, c) => s + c, 0);
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
