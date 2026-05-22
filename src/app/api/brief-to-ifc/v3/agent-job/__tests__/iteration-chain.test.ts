/**
 * Phase δ.3 — integration test for the iteration-chaining worker.
 *
 * Exercises the agent-job route end-to-end with every external
 * dependency mocked: prisma updateMany/update/findUnique, QStash
 * enqueue, generator, verifier, retry-hint, lifecycle transitions.
 *
 * The unit-tests in `iteration-decisions.test.ts` cover the pure
 * decision/best-so-far/runaway logic. This file covers the FULL flow
 * — counter check-and-set, conditional re-enqueue, lift-best-to-
 * COMPLETED, enqueue-failure fallback, runaway-guard at the entry
 * point, chain telemetry emission.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks via vi.hoisted (vi.mock factories run before module-level
//      consts, so any object the factory closes over must live inside
//      a vi.hoisted() block). ────────────────────────────────────────

// vi.fn() defaults to no-arg / no-return types, which makes
// `.mock.calls[i][n]` access a tuple-overflow type error. Explicit
// `<unknown[], unknown>` keeps the mocks dynamically typed so the
// test bodies can introspect arbitrary positional args without
// pulling in the full signatures of every mocked module.
const mocks = vi.hoisted(() => ({
  prisma: {
    briefToIfcV3Run: {
      findUnique: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
      updateMany: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
      update: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
    },
  },
  appendLog: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    persisted: true,
    streamed: true,
    logId: "log-x",
  })),
  verifyQstashSignature: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => true),
  scheduleAgentBuildWorker: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => "msg-next-iter"),
  runGenerator: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  verifyBuild: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  generateRetryHint: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  transitionStatus: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => "COMPLETED"),
  snapshotAndEmit: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null),
  emitBuildTelemetry: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => {}),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

vi.mock("@/lib/qstash", () => ({
  verifyQstashSignature: mocks.verifyQstashSignature,
  scheduleAgentBuildWorker: mocks.scheduleAgentBuildWorker,
}));

vi.mock("@/features/brief-to-ifc/v3/generator/driver", () => ({
  runGenerator: mocks.runGenerator,
}));

vi.mock("@/features/brief-to-ifc/v3/hard-verifier", () => ({
  verifyBuild: mocks.verifyBuild,
}));

vi.mock("@/features/brief-to-ifc/v3/retry-hint", () => ({
  generateRetryHint: mocks.generateRetryHint,
}));

vi.mock("@/features/brief-to-ifc/v3/lifecycle/transitions", () => ({
  transitionStatus: mocks.transitionStatus,
}));

vi.mock("@/features/brief-to-ifc/v3/lifecycle/heartbeat", () => ({
  startHeartbeat: () => ({
    stop: vi.fn(),
    tickNow: vi.fn(async () => {}),
  }),
}));

vi.mock("@/features/brief-to-ifc/v3/runtime/append-log", () => ({
  appendLog: mocks.appendLog,
}));

vi.mock("@/features/brief-to-ifc/v3/telemetry", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/features/brief-to-ifc/v3/telemetry")
  >();
  return {
    ...actual,
    snapshotAndEmit: mocks.snapshotAndEmit,
    emitBuildTelemetry: mocks.emitBuildTelemetry,
  };
});

// Static import — vitest hoists the vi.mock calls above this line.
import { POST } from "../route";

// ─── Test fixtures ───────────────────────────────────────────────────

function makeBriefSpec() {
  return {
    project: {
      name: "Test",
      type: "office",
      location: "X",
      description: "Y",
    },
    site: {
      bounds_m: [10, 10],
      height_limit_m: 10,
      coordinate_origin: "sw_corner",
    },
    // Phase δ.2 — give the brief one space so structural_completeness
    // has a denominator. The PASS-fixture validation reports it
    // present; the RETRY-fixture validation reports it missing.
    spaces: [
      {
        id: "space-1",
        name: "S1",
        long_name: "Space 1",
        polygon_world_m: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        height_m: 3,
        occupancy_type: "Office",
      },
    ],
    elements: [
      { id: "wall-1", type: "wall", origin_world_m: [0, 0, 0], material_id: "m1" },
    ],
    materials: [
      {
        id: "m1",
        name: "M",
        rgb: [0.5, 0.5, 0.5],
        roughness: 0.5,
        method: "MATT",
        category: "x",
      },
    ],
  };
}

/** Phase δ.2 — finalValidation that produces a HIGH composite score
 *  (structural ≈ 1.0, sanity = 1.0). Used for PASS-path tests. */
function makeGoodValidation() {
  return {
    session_id: "s1",
    schema_name: "IFC4",
    entity_count: 1500,
    refs_resolve: true,
    spaces_present: ["space-1"],
    spaces_missing: [],
    errors: [],
    web_ifc_load_test: "PASS",
    ascii_only: true,
    ascii_first_bad_offset: null,
    world_bbox: {
      verdict: "OK",
      expected_extent: [10, 10, 3],
      actual_bbox: { xmin: 0, ymin: 0, zmin: 0, xmax: 10, ymax: 10, zmax: 3 },
      actual_extent: [10, 10, 3],
      extent_ratio: [1, 1, 1],
      suggested_unit_fix: null,
    },
    space_polygons: null,
    element_coverage: {
      verdict: "OK",
      total_expected: 20,
      total_actual_in_expected_classes: 20,
      by_class_expected: { IfcWall: 20 },
      by_class_actual: { IfcWall: 20 },
      missing_ids: [],
      missing_id_count: 0,
    },
    origin_collapse: {
      verdict: "OK",
      total_elements: 20,
      at_origin_count: 0,
      fraction_at_origin: 0,
      collapsed: false,
    },
  };
}

/** Phase δ.2 — finalValidation that produces a LOW composite score
 *  (structural ≈ 0.2, sanity = 0.5). Used for RETRY-path tests. */
function makeBadValidation() {
  return {
    session_id: "s1",
    schema_name: "IFC4",
    entity_count: 100,
    refs_resolve: true,
    spaces_present: [],
    spaces_missing: ["space-1"],
    errors: [],
    web_ifc_load_test: "PASS",
    ascii_only: true,
    ascii_first_bad_offset: null,
    world_bbox: {
      verdict: "SCALED_TOO_SMALL",
      expected_extent: [10, 10, 3],
      actual_bbox: null,
      actual_extent: null,
      extent_ratio: null,
      suggested_unit_fix: null,
    },
    space_polygons: null,
    element_coverage: {
      verdict: "MISSING_ELEMENTS",
      total_expected: 20,
      total_actual_in_expected_classes: 4,
      by_class_expected: { IfcWall: 20 },
      by_class_actual: { IfcWall: 4 },
      missing_ids: [],
      missing_id_count: 16,
    },
    origin_collapse: {
      verdict: "OK",
      total_elements: 4,
      at_origin_count: 0,
      fraction_at_origin: 0,
      collapsed: false,
    },
  };
}

function makeGeneratorResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    ifcUrl: "https://r2.example/iter-1.ifc",
    entityCount: 1500,
    costUsd: 0.42,
    durationMs: 60_000,
    turns: 50,
    ledger: [],
    turnRecords: [],
    finalValidation: makeGoodValidation(),
    error: null,
    ...overrides,
  };
}

function makeVerifierReport(parts: number, verified: boolean) {
  return {
    verified,
    parts_coverage: parts,
    trim_coverage: 0,
    mismatches: [],
    summary: "ok",
    verified_at: new Date().toISOString(),
    source: "railway",
  };
}

function makeRequest(payload: object): NextRequest {
  return new NextRequest("https://example.com/api/brief-to-ifc/v3/agent-job", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "upstash-signature": "test-sig" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.briefToIfcV3Run.findUnique.mockReset();
  mocks.prisma.briefToIfcV3Run.updateMany.mockReset();
  mocks.prisma.briefToIfcV3Run.update.mockReset();
  mocks.prisma.briefToIfcV3Run.update.mockResolvedValue({});
  mocks.appendLog.mockReset();
  mocks.appendLog.mockResolvedValue({ persisted: true, streamed: true, logId: "log-x" });
  mocks.transitionStatus.mockReset();
  mocks.transitionStatus.mockResolvedValue("COMPLETED");
  mocks.scheduleAgentBuildWorker.mockReset();
  mocks.scheduleAgentBuildWorker.mockResolvedValue("msg-next-iter");
  mocks.runGenerator.mockReset();
  mocks.verifyBuild.mockReset();
  mocks.generateRetryHint.mockReset();
  mocks.emitBuildTelemetry.mockReset();
});

function collectAppendLogArgs(): Array<Record<string, unknown>> {
  // appendLog(prisma, args) — args is the second positional arg.
  return mocks.appendLog.mock.calls.map((c) => c[1] as Record<string, unknown>);
}

// ─── Happy path — iteration 1 PASS ───────────────────────────────────

describe("agent-job worker — iteration 1 PASS (no regression to single-iteration happy path)", () => {
  it("transitions to COMPLETED, never enqueues, returns the iteration's IFC", async () => {
    mocks.prisma.briefToIfcV3Run.findUnique.mockResolvedValue({
      id: "run-1",
      status: "PENDING",
      briefSpec: makeBriefSpec(),
      costCapUsd: 5,
      currentIteration: 0,
      iterationHistory: [],
      bestIteration: null,
    });
    mocks.prisma.briefToIfcV3Run.updateMany.mockResolvedValue({ count: 1 });
    mocks.runGenerator.mockResolvedValue(makeGeneratorResult());
    // parts=1.0, verified=true → score = 1*80 + 20 = 100 → PASS
    mocks.verifyBuild.mockResolvedValue(makeVerifierReport(1.0, true));

    const res = await POST(makeRequest({ runId: "run-1", iteration: 1 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.completedReason).toBe("quality_passed");
    expect(body.bestIteration).toBe(1);

    // No re-enqueue.
    expect(mocks.scheduleAgentBuildWorker).not.toHaveBeenCalled();

    // Transitioned to COMPLETED with this iteration's data.
    expect(mocks.transitionStatus).toHaveBeenCalledTimes(1);
    const transitionArgs = mocks.transitionStatus.mock.calls[0];
    expect(transitionArgs[3]).toMatchObject({
      to: "COMPLETED",
      payload: expect.objectContaining({
        ifcUrl: "https://r2.example/iter-1.ifc",
        entityCount: 1500,
      }),
    });

    // No retry hint requested.
    expect(mocks.generateRetryHint).not.toHaveBeenCalled();
  });
});

// ─── Iteration 1 RETRY → enqueues iter 2 ─────────────────────────────

describe("agent-job worker — iteration 1 RETRY", () => {
  it("appends history, computes best, enqueues iter 2 with dedup-id + compressed prior state", async () => {
    mocks.prisma.briefToIfcV3Run.findUnique.mockResolvedValue({
      id: "run-1",
      status: "PENDING",
      briefSpec: makeBriefSpec(),
      costCapUsd: 5,
      currentIteration: 0,
      iterationHistory: [],
      bestIteration: null,
    });
    mocks.prisma.briefToIfcV3Run.updateMany.mockResolvedValue({ count: 1 });
    // Generator produces a BAD build: validation reports most elements
    // missing + bbox scaled wrong → δ.2 composite scores < threshold.
    mocks.runGenerator.mockResolvedValue(
      makeGeneratorResult({ finalValidation: makeBadValidation() }),
    );
    mocks.verifyBuild.mockResolvedValue(makeVerifierReport(0.5, false));
    mocks.generateRetryHint.mockResolvedValue({
      hint: "Decompose the cutting table into a top plus 4 legs.",
      cost_usd: 0.01,
      shouldIterate: true,
    });

    const res = await POST(makeRequest({ runId: "run-1", iteration: 1 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.nextIteration).toBe(2);
    // δ.2 composite: structural ≈ 0.1, sanity = 0.75 → renormalized
    // score should be clearly below QUALITY_THRESHOLD=80.
    expect(body.qualityScore).toBeLessThan(80);

    // No COMPLETED transition yet.
    expect(mocks.transitionStatus).not.toHaveBeenCalled();

    // History was persisted.
    expect(mocks.prisma.briefToIfcV3Run.update).toHaveBeenCalled();
    const updateCall = mocks.prisma.briefToIfcV3Run.update.mock.calls[0][0] as {
      where: { id: string };
      data: {
        bestIteration: number;
        iterationHistory: Array<{
          iteration: number;
          qualityScore: number;
          forwardFeedback?: string;
        }>;
      };
    };
    expect(updateCall.where).toEqual({ id: "run-1" });
    expect(updateCall.data.bestIteration).toBe(1);
    const history = updateCall.data.iterationHistory;
    expect(history).toHaveLength(1);
    expect(history[0].iteration).toBe(1);
    expect(history[0].qualityScore).toBeLessThan(80);
    expect(history[0].forwardFeedback).toContain("ITERATION 1 RESULT");
    expect(history[0].forwardFeedback).toContain("Decompose the cutting table");

    // Re-enqueue with dedup-id and the compressed feedback in payload.
    expect(mocks.scheduleAgentBuildWorker).toHaveBeenCalledTimes(1);
    const enqueueArgs = mocks.scheduleAgentBuildWorker.mock.calls[0] as [
      { runId: string; iteration: number; previousFeedback?: string },
      { dedupId?: string },
    ];
    expect(enqueueArgs[0]).toMatchObject({
      runId: "run-1",
      iteration: 2,
    });
    expect(enqueueArgs[0].previousFeedback).toContain("ITERATION 1 RESULT");
    expect(enqueueArgs[1]).toMatchObject({ dedupId: "run-1-iter-2" });
  });
});

// ─── Iteration 3 (MAX) — COMPLETED with best-so-far ──────────────────

describe("agent-job worker — MAX_ITERATIONS reached", () => {
  it("transitions to COMPLETED using best iteration's artifacts (not the latest)", async () => {
    // Prior history: [70, 85]. This iteration scores < threshold →
    // regression. Best stays at iteration 2.
    const priorHistory = [
      {
        iteration: 1,
        qualityScore: 70,
        ifcUrl: "https://r2.example/iter-1.ifc",
        entityCount: 1000,
        costUsd: 0.3,
        durationMs: 50_000,
        turns: 40,
        verifierSource: "railway",
        finishedAt: "2026-05-21T12:00:01.000Z",
        finalValidation: { entity_count: 1000 },
      },
      {
        iteration: 2,
        qualityScore: 85,
        ifcUrl: "https://r2.example/iter-2.ifc",
        entityCount: 1300,
        costUsd: 0.45,
        durationMs: 60_000,
        turns: 50,
        verifierSource: "railway",
        finishedAt: "2026-05-21T12:01:00.000Z",
        finalValidation: { entity_count: 1300 },
        ledger: [{ turn: 1 }],
        turnRecords: [{ turn: 1, toolName: "x" }],
      },
    ];

    mocks.prisma.briefToIfcV3Run.findUnique.mockResolvedValue({
      id: "run-1",
      status: "RUNNING",
      briefSpec: makeBriefSpec(),
      costCapUsd: 5,
      currentIteration: 2,
      iterationHistory: priorHistory,
      bestIteration: 2,
    });
    mocks.prisma.briefToIfcV3Run.updateMany.mockResolvedValue({ count: 1 });
    // Iteration 3's generator returns a BAD build (lower than prior
    // iteration 2's 85). Under δ.2 composite this scores well below
    // threshold; combined with iteration=3 (max), should COMPLETE
    // with iteration 2 as best.
    mocks.runGenerator.mockResolvedValue(
      makeGeneratorResult({
        ifcUrl: "https://r2.example/iter-3.ifc",
        entityCount: 900,
        finalValidation: makeBadValidation(),
      }),
    );
    mocks.verifyBuild.mockResolvedValue(makeVerifierReport(0.85, false));

    const res = await POST(makeRequest({ runId: "run-1", iteration: 3 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.completedReason).toBe("max_iterations");
    expect(body.bestIteration).toBe(2);

    // No more enqueues.
    expect(mocks.scheduleAgentBuildWorker).not.toHaveBeenCalled();

    // COMPLETED transition used iteration 2's artifacts.
    expect(mocks.transitionStatus).toHaveBeenCalledTimes(1);
    const transitionPayload = mocks.transitionStatus.mock.calls[0][3];
    expect(transitionPayload).toMatchObject({
      to: "COMPLETED",
      payload: expect.objectContaining({
        ifcUrl: "https://r2.example/iter-2.ifc",
        entityCount: 1300,
      }),
    });
  });
});

// ─── Idempotency — atomic counter mismatch ───────────────────────────

describe("agent-job worker — idempotency (Rule 8)", () => {
  it("returns 'duplicate' without running the generator when counter mismatch", async () => {
    mocks.prisma.briefToIfcV3Run.findUnique.mockResolvedValue({
      id: "run-1",
      status: "RUNNING",
      briefSpec: makeBriefSpec(),
      costCapUsd: 5,
      currentIteration: 2,
      iterationHistory: [],
      bestIteration: null,
    });
    // Atomic check-and-set fails — counter is not at iteration-1=1.
    mocks.prisma.briefToIfcV3Run.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(makeRequest({ runId: "run-1", iteration: 2 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("duplicate");
    expect(body.iteration).toBe(2);

    // Never touched the generator / verifier / enqueue.
    expect(mocks.runGenerator).not.toHaveBeenCalled();
    expect(mocks.verifyBuild).not.toHaveBeenCalled();
    expect(mocks.scheduleAgentBuildWorker).not.toHaveBeenCalled();
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });
});

// ─── Runaway guard at the entry point ────────────────────────────────

describe("agent-job worker — runaway guard at entry", () => {
  it("refuses iteration > MAX_ITERATIONS with 400 before claiming the counter", async () => {
    const res = await POST(makeRequest({ runId: "run-1", iteration: 4 }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("MAX_ITERATIONS");

    // Never claimed the counter, never enqueued.
    expect(mocks.prisma.briefToIfcV3Run.updateMany).not.toHaveBeenCalled();
    expect(mocks.runGenerator).not.toHaveBeenCalled();
    expect(mocks.scheduleAgentBuildWorker).not.toHaveBeenCalled();
  });
});

// ─── Enqueue failure → fall back to finalizeWithBest ─────────────────

describe("agent-job worker — QStash enqueue failure fallback", () => {
  it("falls back to COMPLETED with best-so-far when re-enqueue throws", async () => {
    mocks.prisma.briefToIfcV3Run.findUnique.mockResolvedValue({
      id: "run-1",
      status: "PENDING",
      briefSpec: makeBriefSpec(),
      costCapUsd: 5,
      currentIteration: 0,
      iterationHistory: [],
      bestIteration: null,
    });
    mocks.prisma.briefToIfcV3Run.updateMany.mockResolvedValue({ count: 1 });
    // Below-threshold build so the worker tries to enqueue iter 2.
    mocks.runGenerator.mockResolvedValue(
      makeGeneratorResult({ finalValidation: makeBadValidation() }),
    );
    mocks.verifyBuild.mockResolvedValue(makeVerifierReport(0.5, false));
    mocks.generateRetryHint.mockResolvedValue({
      hint: "Try again.",
      cost_usd: 0,
      shouldIterate: true,
    });
    // QStash explodes.
    mocks.scheduleAgentBuildWorker.mockRejectedValue(new Error("QStash 503"));

    const res = await POST(makeRequest({ runId: "run-1", iteration: 1 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.completedReason).toBe("enqueue_failed");

    // We DID try to enqueue once.
    expect(mocks.scheduleAgentBuildWorker).toHaveBeenCalledTimes(1);

    // Then transitioned to COMPLETED with the iter-1 result (the
    // only iteration we have, so it's also the best).
    expect(mocks.transitionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.transitionStatus.mock.calls[0][3]).toMatchObject({
      to: "COMPLETED",
      payload: expect.objectContaining({
        ifcUrl: "https://r2.example/iter-1.ifc",
      }),
    });
  });
});

// ─── Chain telemetry emission ────────────────────────────────────────

describe("agent-job worker — chain telemetry on COMPLETED", () => {
  it("emits a BuildTelemetryChain DIAGNOSTIC log row at the final iteration", async () => {
    mocks.prisma.briefToIfcV3Run.findUnique.mockResolvedValue({
      id: "run-1",
      status: "PENDING",
      briefSpec: makeBriefSpec(),
      costCapUsd: 5,
      currentIteration: 0,
      iterationHistory: [],
      bestIteration: null,
    });
    mocks.prisma.briefToIfcV3Run.updateMany.mockResolvedValue({ count: 1 });
    mocks.runGenerator.mockResolvedValue(makeGeneratorResult());
    mocks.verifyBuild.mockResolvedValue(makeVerifierReport(1.0, true));

    await POST(makeRequest({ runId: "run-1", iteration: 1 }));

    const calls = collectAppendLogArgs();
    const chainSummary = calls.find(
      (a) =>
        a.source === "DIAGNOSTIC" &&
        typeof a.message === "string" &&
        a.message.startsWith("BuildTelemetryChain"),
    );
    expect(chainSummary).toBeDefined();
    if (chainSummary) {
      const metadata = chainSummary.metadata as Record<string, unknown>;
      expect(metadata.chainSummary).toBe(true);
      expect(metadata.totalIterations).toBe(1);
      expect(metadata.bestIteration).toBe(1);
      expect(metadata.completedReason).toBe("quality_passed");
    }
  });
});
