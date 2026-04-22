/**
 * Phase 2.6 — VIPLogger stage-log emission tests.
 *
 * The VIP pipeline writes stage-by-stage entries to VipJob.stageLog via
 * the onStageLog callback attached to VIPLogger. These tests lock in:
 *   - logStageStart pushes a "running" entry.
 *   - logStageSuccess finalizes that entry in place.
 *   - logStageFailure finalizes with status="failed" + error.
 *   - costUsd in meta is extracted and surfaced on the entry.
 *   - seedStageLog seeds prior entries so Phase B / regenerate extend
 *     an existing timeline.
 *   - Each lifecycle event fires the callback with the full snapshot.
 */

import { describe, it, expect, vi } from "vitest";
import { VIPLogger } from "../logger";
import type { StageLogEntry } from "../types";

function makeLogger(onStageLog?: (entries: StageLogEntry[]) => void) {
  return new VIPLogger("req-abc123", "user-xyz", "3BHK in Pune", onStageLog);
}

describe("VIPLogger.stageLog — lifecycle", () => {
  it("pushes a running entry on logStageStart", () => {
    const log = makeLogger();
    log.logStageStart(1);
    const entries = log.getStageLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      stage: 1,
      name: "Prompt Intelligence",
      status: "running",
    });
    expect(entries[0].startedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(entries[0].completedAt).toBeUndefined();
  });

  it("finalizes the entry on logStageSuccess, in place", () => {
    const log = makeLogger();
    log.logStageStart(1);
    log.logStageSuccess(1, 8_300, { rooms: 8, costUsd: 0.015 });
    const entries = log.getStageLog();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("success");
    expect(entries[0].durationMs).toBe(8_300);
    expect(entries[0].costUsd).toBeCloseTo(0.015);
    expect(entries[0].completedAt).toBeDefined();
    expect(entries[0].summary).toMatch(/rooms: 8/);
  });

  it("finalizes the entry on logStageFailure with status=failed and error", () => {
    const log = makeLogger();
    log.logStageStart(2);
    log.logStageFailure(2, 1_200, "content filter blocked");
    const entries = log.getStageLog();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("failed");
    expect(entries[0].error).toBe("content filter blocked");
    expect(entries[0].durationMs).toBe(1_200);
  });

  it("keeps multi-stage entries in order", () => {
    const log = makeLogger();
    log.logStageStart(1);
    log.logStageSuccess(1, 1000, { rooms: 3 });
    log.logStageStart(2);
    log.logStageSuccess(2, 2000, { images: 1 });
    const entries = log.getStageLog();
    expect(entries.map((e) => e.stage)).toEqual([1, 2]);
    expect(entries[1].status).toBe("success");
  });

  it("extracts costUsd from legacy string meta form (cost: '$0.034')", () => {
    const log = makeLogger();
    log.logStageStart(2);
    log.logStageSuccess(2, 1500, { images: 1, cost: "$0.034" });
    const entries = log.getStageLog();
    expect(entries[0].costUsd).toBeCloseTo(0.034);
  });
});

describe("VIPLogger.stageLog — onStageLog callback", () => {
  it("fires after each lifecycle event with the full snapshot", () => {
    const calls: StageLogEntry[][] = [];
    const log = makeLogger((entries) => {
      calls.push(entries.map((e) => ({ ...e })));
    });
    log.logStageStart(1);
    expect(calls).toHaveLength(1);
    expect(calls[0][0].status).toBe("running");

    log.logStageSuccess(1, 900);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[calls.length - 1][0].status).toBe("success");
  });

  it("swallows errors thrown by onStageLog (never throws)", () => {
    const log = makeLogger(() => {
      throw new Error("boom");
    });
    expect(() => log.logStageStart(1)).not.toThrow();
    expect(() => log.logStageSuccess(1, 100)).not.toThrow();
  });
});

describe("VIPLogger.stageLog — seedStageLog for resume flows", () => {
  it("seeds prior entries so subsequent events extend the timeline", () => {
    const prior: StageLogEntry[] = [
      {
        stage: 1,
        name: "Prompt Intelligence",
        status: "success",
        startedAt: "2026-04-21T00:00:00.000Z",
        completedAt: "2026-04-21T00:00:08.000Z",
        durationMs: 8_000,
      },
    ];
    const log = makeLogger();
    log.seedStageLog(prior);
    log.logStageStart(3);
    log.logStageSuccess(3, 5_000, { score: 82 });
    const entries = log.getStageLog();
    expect(entries.map((e) => e.stage)).toEqual([1, 3]);
    expect(entries[0].status).toBe("success"); // seeded entry untouched
    expect(entries[1].status).toBe("success");
  });

  it("ignores non-array seeds safely", () => {
    const log = makeLogger();
    // @ts-expect-error — exercise runtime guard
    log.seedStageLog(null);
    expect(log.getStageLog()).toEqual([]);
  });
});

describe("VIPLogger.stageLog — logStageCost backfills costUsd", () => {
  it("updates the existing entry when a cost arrives after success", () => {
    const log = makeLogger();
    log.logStageStart(1);
    log.logStageSuccess(1, 1000, { rooms: 2 });
    expect(log.getStageLog()[0].costUsd).toBeUndefined();
    log.logStageCost(1, 0.015);
    expect(log.getStageLog()[0].costUsd).toBeCloseTo(0.015);
  });

  it("still records cost internally even when no entry exists yet", () => {
    const log = makeLogger();
    log.logStageCost(1, 0.015);
    expect(log.computeTotalCost()).toBeCloseTo(0.015);
    expect(log.getStageLog()).toEqual([]);
  });
});

describe("VIPLogger.stageLog — missing logStageStart safety", () => {
  it("logStageFailure without a prior start synthesizes a failed entry", () => {
    const log = makeLogger();
    log.logStageFailure(4, 0, "OPENAI_API_KEY missing");
    const entries = log.getStageLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ stage: 4, status: "failed" });
  });
});

describe("VIPLogger.stageLog — output truncation guardrail", () => {
  it("caps individual oversized string values so the row stays small", () => {
    // Single huge string: per-string cap (2KB) fires first.
    const log = makeLogger();
    const huge = "x".repeat(60_000);
    log.logStageStart(3);
    log.logStageSuccess(3, 500, { huge, score: 80 });
    const out = (log.getStageLog()[0].output ?? {}) as Record<string, unknown>;
    expect(typeof out.huge).toBe("string");
    expect((out.huge as string).length).toBeLessThan(2100);
    expect(JSON.stringify(out).length).toBeLessThan(5_000);
  });

  it("replaces the whole meta when total JSON size exceeds ~48KB", () => {
    // Many small-but-under-cap strings add up to >48KB → outer cap fires.
    const log = makeLogger();
    const meta: Record<string, unknown> = {};
    for (let i = 0; i < 80; i++) {
      meta[`chunk_${i}`] = "y".repeat(1_500);
    }
    log.logStageStart(3);
    log.logStageSuccess(3, 500, meta);
    const out = (log.getStageLog()[0].output ?? {}) as Record<string, unknown>;
    expect(JSON.stringify(out).length).toBeLessThan(50_000);
    expect(out).toHaveProperty("truncated", true);
  });
});

describe("VIPLogger.stageLog — integration with vi.fn", () => {
  it("captures a realistic Phase A flow", async () => {
    const fn = vi.fn();
    const log = new VIPLogger("req1", "u1", "prompt", fn);
    log.logStageStart(1);
    log.logStageSuccess(1, 8_000, { rooms: 6, costUsd: 0.015 });
    log.logStageStart(2);
    log.logStageSuccess(2, 32_000, { images: 1, costUsd: 0.034 });
    // Each start/success is one call = 4 total.
    expect(fn).toHaveBeenCalledTimes(4);
    const last = fn.mock.calls[fn.mock.calls.length - 1][0] as StageLogEntry[];
    expect(last).toHaveLength(2);
    expect(last[0].costUsd).toBeCloseTo(0.015);
    expect(last[1].costUsd).toBeCloseTo(0.034);
  });
});
