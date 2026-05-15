/**
 * Stage logger for the Brief-to-IFC v2 queued pipeline.
 *
 * Mirrors `brief-renders`' `BriefRenderLogger`: a never-throws stage-log
 * accumulator with a serialized-flush queue. Each `flush()` chains onto
 * the previous promise so writes hit the DB in issue order — preventing
 * the lost-update race where a slow `startStage` write lands after its
 * faster `endStage` write and reverts a stage to "running".
 *
 * Call `flushPending()` before any atomic status transition and before
 * the worker returns, so stage-log writes are durable.
 */

import type {
  BriefToIfcStageLogEntry,
  BriefToIfcStageStatus,
} from "./job-types";

/** Persister — writes the full stage-log array. Injected for testability;
 *  the real one in `job-stage-log-store.ts` does a `prisma` update. */
export type BriefToIfcStageLogPersister = (
  entries: BriefToIfcStageLogEntry[],
) => Promise<void> | void;

/** Token-usage payload recorded on a successful stage. */
export interface StageTokenUsage {
  input: number;
  output: number;
  costUsd: number;
}

const STAGE_NAMES: Record<number, string> = {
  1: "Brief Enricher",
  2: "IFC Architect",
  3: "AI IFC Generator",
};

export class BriefToIfcJobLogger {
  private readonly persister?: BriefToIfcStageLogPersister;
  private entries: BriefToIfcStageLogEntry[] = [];
  private startTimes: Record<number, number> = {};
  private flushPromise: Promise<unknown> = Promise.resolve();

  constructor(persister?: BriefToIfcStageLogPersister) {
    this.persister = persister;
  }

  /** Resume support — re-hydrate the log from a previous worker invocation. */
  seedStageLog(entries: BriefToIfcStageLogEntry[]): void {
    try {
      if (!Array.isArray(entries)) return;
      this.entries = entries
        .filter(
          (e): e is BriefToIfcStageLogEntry =>
            !!e && typeof e === "object" && typeof e.stage === "number",
        )
        .map((e) => ({ ...e }));
    } catch {
      /* never throw */
    }
  }

  startStage(stage: number, name?: string): void {
    try {
      this.startTimes[stage] = Date.now();
      const fresh: BriefToIfcStageLogEntry = {
        stage,
        name: name ?? STAGE_NAMES[stage] ?? `Stage ${stage}`,
        status: "running",
        startedAt: new Date().toISOString(),
        completedAt: null,
        durationMs: null,
        tokenUsage: null,
        summary: null,
        error: null,
      };
      const existing = this.entries.find((e) => e.stage === stage);
      if (existing) {
        Object.assign(existing, fresh);
      } else {
        this.entries.push(fresh);
      }
      this.flush();
    } catch {
      /* never throw */
    }
  }

  endStage(
    stage: number,
    status: BriefToIfcStageStatus,
    opts?: {
      tokenUsage?: StageTokenUsage | null;
      summary?: string | null;
      error?: string | null;
    },
  ): void {
    try {
      const entry = this.entries.find((e) => e.stage === stage);
      if (!entry) return;
      const started = this.startTimes[stage];
      entry.status = status;
      entry.completedAt = new Date().toISOString();
      entry.durationMs = started ? Date.now() - started : null;
      if (opts?.tokenUsage !== undefined) entry.tokenUsage = opts.tokenUsage;
      if (opts?.summary !== undefined) entry.summary = opts.summary;
      if (opts?.error !== undefined) entry.error = opts.error;
      this.flush();
    } catch {
      /* never throw */
    }
  }

  getStageLog(): BriefToIfcStageLogEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  /** Serialized flush — each write chains onto the previous promise so
   *  writes land in issue order. Persister errors are swallowed here. */
  private flush(): void {
    if (!this.persister) return;
    const snapshot = this.entries.map((e) => ({ ...e }));
    const persister = this.persister;
    this.flushPromise = this.flushPromise.then(
      () => Promise.resolve(persister(snapshot)).catch(() => {}),
      () => Promise.resolve(persister(snapshot)).catch(() => {}),
    );
  }

  /** Durability barrier — always resolves. Call before any atomic status
   *  transition and before the worker returns. */
  async flushPending(): Promise<void> {
    try {
      await this.flushPromise;
    } catch {
      /* swallow — defence in depth */
    }
  }
}
