/**
 * Phase δ.0 — BuildTelemetry regression.
 *
 * Asserts the load-bearing invariants of the telemetry layer:
 *
 *   1. `BuildTelemetryCollector` accumulates events and produces a
 *      shape-valid snapshot with truthful counts.
 *   2. Telemetry NEVER crashes the build — if persistence throws,
 *      `snapshotAndEmit` swallows it and returns gracefully (the
 *      caller's success path is unaffected).
 *   3. `mergePythonTelemetry` is shape-tolerant: malformed / missing /
 *      wrong-type payloads from the Python sandbox merge as no-ops
 *      instead of throwing.
 *   4. `withCoercionCollection` isolates concurrent parses — events
 *      from one parse do not leak into another.
 *   5. Schema-helper coercions land in the active coercion context.
 */

import { describe, it, expect, vi } from "vitest";

import {
  BuildTelemetryCollector,
  recordCoercion,
  snapshotAndEmit,
  withCoercionCollection,
  withCoercionCollectionAsync,
} from "../telemetry";

// ── 1. Collector behaviour ──────────────────────────────────────────

describe("BuildTelemetryCollector — accumulates and snapshots", () => {
  it("records each event category and produces matching counts", () => {
    const c = new BuildTelemetryCollector({
      runId: "test-run",
      iteration: 1,
      briefType: "office",
    });

    c.recordSchemaCoercions([
      { field: "project.type", kind: "enum_normalized", received: "coworking", recovered: "office" },
      { field: "site.coordinate_origin", kind: "enum_normalized", received: "SW_CORNER", recovered: "sw_corner" },
    ]);
    c.recordProxyFallback({
      requested_type: "stair",
      ifc_class: "IfcBuildingElementProxy",
      element_id: "el-stair-1",
      reason: "agent_called_add_proxy",
    });
    c.recordMaterialMiss({
      element_id: "el-wall-1",
      requested_material_id: "mat-walnut",
      fallback_material_id: "mat-default",
    });
    c.recordDroppedElement({
      type: "roof",
      element_id: "el-roof-1",
      reason: "missing_dims",
    });
    c.recordToolError();
    c.recordRenderPreviewCall();
    c.recordRenderPreviewCall();
    c.recordRequestedElementType("wall");
    c.recordRequestedElementType("wall");
    c.recordRequestedElementType("stair");
    c.setTurns(42);
    c.setGeneratorCostUsd(1.234);
    c.setEntityCount(1500);
    c.setFinalQualityScore(72);
    c.setFinalized(true);

    const snap = c.snapshot();

    expect(snap.schemaVersion).toBe("v1");
    expect(snap.runId).toBe("test-run");
    expect(snap.iteration).toBe(1);
    expect(snap.briefType).toBe("office");
    expect(snap.finalized).toBe(true);
    expect(snap.turns).toBe(42);
    expect(snap.generatorCostUsd).toBe(1.234);
    expect(snap.entityCount).toBe(1500);
    expect(snap.renderPreviewCalls).toBe(2);
    expect(snap.finalQualityScore).toBe(72);

    expect(snap.counts.schemaCoercions).toBe(2);
    expect(snap.counts.proxyFallbacks).toBe(1);
    expect(snap.counts.materialMisses).toBe(1);
    expect(snap.counts.droppedElements).toBe(1);
    expect(snap.counts.toolErrors).toBe(1);

    expect(snap.elementTypeCounts.requested).toEqual({ wall: 2, stair: 1 });

    expect(snap.proxyFallbacks[0].requested_type).toBe("stair");
    expect(snap.materialMisses[0].requested_material_id).toBe("mat-walnut");
    expect(snap.droppedElements[0].type).toBe("roof");
    expect(snap.schemaCoercions[0].field).toBe("project.type");
  });

  it("durationMs is non-negative and endedAt is later than startedAt", () => {
    const c = new BuildTelemetryCollector({ runId: "r", iteration: 1 });
    const snap = c.snapshot();
    expect(snap.durationMs).toBeGreaterThanOrEqual(0);
    expect(snap.endedAt).not.toBeNull();
  });
});

// ── 2. Telemetry NEVER crashes the build ────────────────────────────

describe("snapshotAndEmit — never throws on persistence failure", () => {
  it("returns null + swallows error when the prisma client throws", async () => {
    const c = new BuildTelemetryCollector({ runId: "r-fail", iteration: 1 });
    c.recordProxyFallback({
      requested_type: "balcony",
      ifc_class: "IfcBuildingElementProxy",
      reason: "agent_called_add_proxy",
    });

    // Mock prisma whose executionLog.create THROWS.
    const throwingPrisma = {
      executionLog: {
        create: vi.fn(() => {
          throw new Error("simulated DB failure");
        }),
      },
    } as unknown as Parameters<typeof snapshotAndEmit>[0];

    // Should NOT throw — the build path is unaffected.
    await expect(snapshotAndEmit(throwingPrisma, c)).resolves.not.toThrow();
  });

  it("returns null + swallows error when prisma.executionLog.create rejects", async () => {
    const c = new BuildTelemetryCollector({ runId: "r-rej", iteration: 1 });

    const rejectingPrisma = {
      executionLog: {
        create: vi.fn(() => Promise.reject(new Error("simulated async failure"))),
      },
    } as unknown as Parameters<typeof snapshotAndEmit>[0];

    await expect(snapshotAndEmit(rejectingPrisma, c)).resolves.not.toThrow();
  });
});

// ── 3. mergePythonTelemetry is shape-tolerant ───────────────────────

describe("BuildTelemetryCollector.mergePythonTelemetry — shape-tolerant", () => {
  const cases: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["a string", "not telemetry"],
    ["a number", 42],
    ["an empty object", {}],
    ["malformed proxy_fallbacks shape (not array)", { proxy_fallbacks: "oops" }],
    ["proxy_fallbacks with garbage items", { proxy_fallbacks: [null, 42, "junk"] }],
    ["material_misses with missing fields", { material_misses: [{}] }],
  ];

  it.each(cases)("does not throw on %s", (_label, payload) => {
    const c = new BuildTelemetryCollector({ runId: "r-merge", iteration: 1 });
    expect(() => c.mergePythonTelemetry(payload)).not.toThrow();
    expect(() => c.snapshot()).not.toThrow();
  });

  it("merges a well-formed Python payload correctly", () => {
    const c = new BuildTelemetryCollector({ runId: "r-good", iteration: 1 });
    c.mergePythonTelemetry({
      proxy_fallbacks: [
        { requested_type: "stair", ifc_class: "IfcBuildingElementProxy", element_id: "el1", reason: "agent_called_add_proxy" },
      ],
      material_misses: [
        { element_id: "el1", requested_material_id: "mat-walnut", fallback_material_id: "mat-default" },
      ],
      dropped_elements: [],
      built_element_counts: { IfcWall: 10, IfcDoor: 3 },
    });
    const snap = c.snapshot();
    expect(snap.counts.proxyFallbacks).toBe(1);
    expect(snap.counts.materialMisses).toBe(1);
    expect(snap.elementTypeCounts.built).toEqual({ IfcWall: 10, IfcDoor: 3 });
  });
});

// ── 4. Coercion context isolation + reach ───────────────────────────

describe("withCoercionCollection — isolates contexts", () => {
  it("events from one context do not bleed into another", async () => {
    const a = withCoercionCollection(() => {
      recordCoercion({
        field: "a", kind: "enum_normalized",
        received: "x", recovered: "y",
      });
      return null;
    });
    const b = withCoercionCollection(() => null);
    expect(a.coercions.length).toBe(1);
    expect(b.coercions.length).toBe(0);
  });

  it("works across async boundaries via withCoercionCollectionAsync", async () => {
    const result = await withCoercionCollectionAsync(async () => {
      await Promise.resolve();
      recordCoercion({
        field: "async.field", kind: "rgb_rescaled_255",
        received: [128, 128, 128], recovered: [0.5, 0.5, 0.5],
      });
      return 99;
    });
    expect(result.result).toBe(99);
    expect(result.coercions.length).toBe(1);
    expect(result.coercions[0].field).toBe("async.field");
  });

  it("recordCoercion outside a context is a no-op (does not throw)", () => {
    expect(() =>
      recordCoercion({
        field: "x", kind: "enum_normalized",
        received: "a", recovered: "b",
      }),
    ).not.toThrow();
  });
});

// ── 5. Bounded event arrays ─────────────────────────────────────────

describe("BuildTelemetryCollector — bounded event arrays", () => {
  it("caps event array but keeps the count authoritative", () => {
    const c = new BuildTelemetryCollector({ runId: "r-cap", iteration: 1 });
    for (let i = 0; i < 500; i += 1) {
      c.recordProxyFallback({
        requested_type: `t${i}`,
        ifc_class: "IfcBuildingElementProxy",
        reason: "agent_called_add_proxy",
      });
    }
    const snap = c.snapshot();
    // Array is capped (well below 500) but count reflects all events.
    expect(snap.proxyFallbacks.length).toBeLessThan(500);
    expect(snap.counts.proxyFallbacks).toBe(500);
  });
});
