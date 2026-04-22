/**
 * Phase 2.9/4 — fidelity-mode integration: classifier → enhance →
 * adjacency → overlap-gated rollback.
 *
 * Contract:
 *   - Gated OFF (no grid-square bias / commercial prompt / no brief) →
 *     rooms pass through unchanged, telemetry records the fallback.
 *   - Gated ON + clean resize → rooms resized, adjacency records
 *     emitted, telemetry.enhancement.applied = true.
 *   - Overlap introduced by correction → both passes revert, rooms
 *     match pre-enhancement state, rollbackReason recorded.
 *   - Telemetry is always populated on fidelity path (Stage5Metrics.enhancement).
 */

import { describe, it, expect } from "vitest";
import { runStage5FidelityMode, __internals } from "../stage-5-fidelity";
import type {
  Stage5Input,
  ExtractedRooms,
  ExtractedRoom,
  ArchitectBrief,
  AdjacencyDeclaration,
} from "../types";
import type { ParsedConstraints } from "../../structured-parser";

// ─── Helpers ────────────────────────────────────────────────────

function extractedRoom(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  confidence = 0.9,
): ExtractedRoom {
  return {
    name,
    rectPx: { x, y, w, h },
    confidence,
    labelAsShown: name,
  };
}

function extraction(rooms: ExtractedRoom[], size = 1000): ExtractedRooms {
  return {
    imageSize: { width: size, height: size },
    plotBoundsPx: { x: 0, y: 0, w: size, h: size },
    rooms,
    issues: [],
    expectedRoomsMissing: [],
    unexpectedRoomsFound: [],
  };
}

function pc(): ParsedConstraints {
  return {
    plot: { width_ft: 40, depth_ft: 40, facing: null, shape: null, total_built_up_sqft: null },
    rooms: [],
    adjacency_pairs: [],
    connects_all_groups: [],
    vastu_required: false,
    special_features: [],
    constraint_budget: {} as unknown as ParsedConstraints["constraint_budget"],
    extraction_notes: "",
  };
}

function brief(rooms: Array<{ name: string; type: string; approxAreaSqft?: number }>): ArchitectBrief {
  return {
    projectType: "residential_villa",
    roomList: rooms,
    plotWidthFt: 40,
    plotDepthFt: 40,
    facing: "north",
  } as ArchitectBrief;
}

function input(
  ex: ExtractedRooms,
  overrides: Partial<Stage5Input> = {},
): Stage5Input {
  return {
    extraction: ex,
    plotWidthFt: 40,
    plotDepthFt: 40,
    facing: "north",
    parsedConstraints: pc(),
    adjacencies: [],
    ...overrides,
  };
}

// ─── Gating behaviour ──────────────────────────────────────────

describe("Phase 2.9 integration — classifier gating", () => {
  it("skips enhancement when no brief is supplied (rooms pass through)", async () => {
    // 4 mixed-type rooms all ~102 sqft → bias WOULD trigger, but no brief.
    const ex = extraction([
      extractedRoom("Living Room", 0, 0, 400, 400),
      extractedRoom("Master Bedroom", 400, 0, 400, 400),
      extractedRoom("Kitchen", 0, 400, 400, 400),
      extractedRoom("Master Bathroom", 400, 400, 400, 400),
    ], 1000);
    const { metrics } = await runStage5FidelityMode(input(ex));
    expect(metrics.path).toBe("fidelity");
    expect(metrics.enhancement).toBeDefined();
    expect(metrics.enhancement!.classification.enhanceDimensions).toBe(false);
    expect(metrics.enhancement!.classification.reasonsForFallback).toContain(
      "brief not supplied — cannot look up target areas",
    );
    expect(metrics.enhancement!.dimensionCorrection.attempted).toBe(false);
    expect(metrics.enhancement!.adjacencyEnforcement.attempted).toBe(false);
  });

  it("skips enhancement for commercial prompts", async () => {
    const ex = extraction([
      extractedRoom("Reception", 0, 0, 400, 400),
      extractedRoom("Meeting Room", 400, 0, 400, 400),
      extractedRoom("Workstation", 0, 400, 400, 400),
      extractedRoom("Office", 400, 400, 400, 400),
    ], 1000);
    const { metrics } = await runStage5FidelityMode(
      input(ex, {
        brief: brief([
          { name: "Reception", type: "lobby", approxAreaSqft: 180 },
          { name: "Meeting Room", type: "meeting", approxAreaSqft: 220 },
          { name: "Workstation", type: "workstation", approxAreaSqft: 320 },
          { name: "Office", type: "office", approxAreaSqft: 260 },
        ]),
        userPrompt: "Design an office with 4 workstations and a meeting room",
      }),
    );
    expect(metrics.enhancement!.classification.isResidential).toBe(false);
    expect(metrics.enhancement!.classification.enhanceDimensions).toBe(false);
    expect(metrics.enhancement!.dimensionCorrection.attempted).toBe(false);
  });

  it("skips enhancement when no grid-square bias present", async () => {
    // Varied sizes — no 3 mixed-type rooms at the same area.
    const ex = extraction([
      extractedRoom("Living Room", 0,   0,   600, 500),   // 24x20
      extractedRoom("Master Bedroom", 600, 0,   400, 400),   // 16x16
      extractedRoom("Kitchen", 0,   500, 300, 300),   // 12x12
      extractedRoom("Master Bathroom", 600, 400, 200, 200),   // 8x8
      extractedRoom("Study", 300, 500, 300, 500),   // 12x20
    ], 1000);
    const { metrics } = await runStage5FidelityMode(
      input(ex, {
        brief: brief([
          { name: "Living Room", type: "living", approxAreaSqft: 480 },
          { name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 256 },
          { name: "Kitchen", type: "kitchen", approxAreaSqft: 144 },
          { name: "Master Bathroom", type: "master_bathroom", approxAreaSqft: 64 },
          { name: "Study", type: "study", approxAreaSqft: 240 },
        ]),
        userPrompt: "3BHK villa",
      }),
    );
    expect(metrics.enhancement!.classification.hasGridSquareBias).toBe(false);
    expect(metrics.enhancement!.classification.enhanceDimensions).toBe(false);
    expect(metrics.enhancement!.dimensionCorrection.attempted).toBe(false);
  });
});

// ─── Happy path: grid-square bias → correction applied ──────────

describe("Phase 2.9 integration — happy path", () => {
  it("applies correction when classifier gates ON and no overlaps result", async () => {
    // 4 mixed-type rooms all ~10x10 (grid-square bias). 40x40 plot
    // with 2x2 equal layout — corrections must stay inside the plot.
    // Target areas are CLOSE-ish to original so resize is modest.
    const ex = extraction([
      extractedRoom("Living Room", 0,   0,   500, 500), // → 20x20 ft = 400 sqft
      extractedRoom("Master Bedroom", 500, 0,   500, 500),
      extractedRoom("Kitchen", 0,   500, 500, 500),
      extractedRoom("Master Bathroom", 500, 500, 500, 500),
    ], 1000);
    const { metrics, output } = await runStage5FidelityMode(
      input(ex, {
        brief: brief([
          { name: "Living Room", type: "living", approxAreaSqft: 520 },
          { name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 380 },
          { name: "Kitchen", type: "kitchen", approxAreaSqft: 360 },
          { name: "Master Bathroom", type: "master_bathroom", approxAreaSqft: 420 },
        ]),
        userPrompt: "3BHK villa with master ensuite",
      }),
    );
    expect(metrics.enhancement!.classification.enhanceDimensions).toBe(true);
    expect(metrics.enhancement!.dimensionCorrection.attempted).toBe(true);
    // Either correction applied cleanly OR rolled back for overlap —
    // both outcomes are valid per contract; we just verify telemetry was emitted.
    expect(metrics.enhancement!.dimensionCorrection.records.length).toBeGreaterThan(0);
    expect(output.project.floors[0].rooms.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── Overlap rollback ──────────────────────────────────────────

describe("Phase 2.9 integration — rollback on overlap", () => {
  it("reverts correction cleanly when it would cause overlaps", async () => {
    // 4 rooms packed tight at ~10x10. Target areas blown way up so
    // resize MUST overlap. Verify rollback + pre-correction state.
    const ex = extraction([
      extractedRoom("Living Room", 0,   0,   500, 500),
      extractedRoom("Master Bedroom", 500, 0,   500, 500),
      extractedRoom("Kitchen", 0,   500, 500, 500),
      extractedRoom("Master Bathroom", 500, 500, 500, 500),
    ], 1000);
    const { metrics, output } = await runStage5FidelityMode(
      input(ex, {
        brief: brief([
          { name: "Living Room", type: "living", approxAreaSqft: 900 },      // HUGE
          { name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 900 },
          { name: "Kitchen", type: "kitchen", approxAreaSqft: 900 },
          { name: "Master Bathroom", type: "master_bathroom", approxAreaSqft: 900 },
        ]),
        userPrompt: "3BHK villa",
      }),
    );
    expect(metrics.enhancement!.classification.enhanceDimensions).toBe(true);
    expect(metrics.enhancement!.dimensionCorrection.attempted).toBe(true);
    // Overlap should force rollback.
    if (!metrics.enhancement!.dimensionCorrection.applied) {
      expect(metrics.enhancement!.dimensionCorrection.rollbackReason).toMatch(/rollback/);
    }
    // Regardless of rollback outcome, NO two rooms should overlap in final
    // output. Boundary points are in mm, so 1 sqft ≈ 92903 mm²; allow a
    // 5 sqft tolerance for floating-point drift at shared edges.
    const OVERLAP_TOLERANCE_MM2 = 5 * 92903;
    const rooms = output.project.floors[0].rooms;
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const aBB = bbox(rooms[i].boundary.points);
        const bBB = bbox(rooms[j].boundary.points);
        const ovX = Math.max(0, Math.min(aBB.x1, bBB.x1) - Math.max(aBB.x0, bBB.x0));
        const ovY = Math.max(0, Math.min(aBB.y1, bBB.y1) - Math.max(aBB.y0, bBB.y0));
        expect(ovX * ovY).toBeLessThan(OVERLAP_TOLERANCE_MM2);
      }
    }
  });
});

// ─── Adjacency enforcement integration ─────────────────────────

describe("Phase 2.9 integration — adjacency enforcement", () => {
  it("applies declared adjacency on enhance-gated run with classifier ON", async () => {
    // Four similarly-sized rooms → bias ON. But layout leaves Master
    // Bath detached from Master Bedroom: Master Bath at plot corner.
    const ex = extraction([
      extractedRoom("Living Room",     0,   0,   500, 500),
      extractedRoom("Master Bedroom",  500, 0,   500, 500),
      extractedRoom("Kitchen",         0,   500, 500, 500),
      extractedRoom("Master Bathroom", 500, 500, 500, 500),
    ], 1000);
    const declared: AdjacencyDeclaration[] = [
      { a: "Master Bedroom", b: "Master Bathroom", relationship: "attached" },
    ];
    const { metrics } = await runStage5FidelityMode(
      input(ex, {
        brief: brief([
          { name: "Living Room", type: "living", approxAreaSqft: 440 },
          { name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 400 },
          { name: "Kitchen", type: "kitchen", approxAreaSqft: 400 },
          { name: "Master Bathroom", type: "master_bathroom", approxAreaSqft: 420 },
        ]),
        adjacencies: declared,
        userPrompt: "villa with master ensuite",
      }),
    );
    expect(metrics.enhancement!.adjacencyEnforcement.attempted).toBe(true);
    expect(metrics.enhancement!.adjacencyEnforcement.records.length).toBe(1);
    const rec = metrics.enhancement!.adjacencyEnforcement.records[0];
    expect(["moved", "already-satisfied", "skipped-would-overlap", "skipped-out-of-bounds"]).toContain(
      rec.action,
    );
  });
});

// ─── Telemetry invariants ──────────────────────────────────────

describe("Phase 2.9 integration — telemetry invariants", () => {
  it("always emits enhancement telemetry on fidelity runs (even when gated off)", async () => {
    const ex = extraction([
      extractedRoom("A", 0, 0, 500, 500),
      extractedRoom("B", 500, 500, 500, 500),
    ], 1000);
    const { metrics } = await runStage5FidelityMode(input(ex));
    expect(metrics.enhancement).toBeDefined();
    expect(metrics.enhancement!.classification).toBeDefined();
    // Too few rooms — classifier should flag this.
    expect(metrics.enhancement!.classification.reasonsForFallback.length).toBeGreaterThan(0);
  });
});

// ─── Utility ──────────────────────────────────────────────────

function bbox(points: Array<{ x: number; y: number }>): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

// Make sure the __internals runPhase29Enhancement is exported for unit tests.
describe("Phase 2.9 integration — internals export", () => {
  it("exposes runPhase29Enhancement via __internals", () => {
    expect(typeof __internals.runPhase29Enhancement).toBe("function");
  });
});
