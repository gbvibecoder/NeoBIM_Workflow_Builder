/**
 * Phase 2.9 — dimension-correction helper tests.
 *
 * Contract:
 *   - Resize preserves center + aspect ratio (with safety clamp).
 *   - Skip rooms without a target area.
 *   - Skip rooms already within ±15% of target.
 *   - Clip corrections that exceed plot bounds.
 *   - Overlap detector catches >0.5 sqft overlaps.
 *
 * Every test traces one specific invariant so a regression fires a
 * single focused failure message.
 */

import { describe, it, expect } from "vitest";
import {
  applyDimensionCorrection,
  detectOverlaps,
  clipAllToPlot,
  type CorrectionInput,
} from "../stage-5-enhance";
import type { ArchitectBrief } from "../types";
import type { Rect } from "../../strip-pack/types";
import type { TransformedRoom } from "../stage-5-synthesis";

// ─── Helpers ────────────────────────────────────────────────────

function brief(rooms: Array<{ name: string; type: string; approxAreaSqft?: number }>): ArchitectBrief {
  return {
    projectType: "residential",
    plotWidthFt: 40,
    plotDepthFt: 40,
    facing: "north",
    styleCues: [],
    constraints: [],
    adjacencies: [],
    roomList: rooms,
  };
}

function tr(name: string, x: number, y: number, w: number, d: number, type = "other"): TransformedRoom {
  return {
    name,
    type,
    placed: { x, y, width: w, depth: d } as Rect,
    confidence: 0.9,
    labelAsShown: name,
  };
}

function areaOf(r: TransformedRoom): number {
  return r.placed.width * r.placed.depth;
}

function input(
  rooms: TransformedRoom[],
  briefRooms: Array<{ name: string; type: string; approxAreaSqft?: number }>,
  plotWidthFt = 40,
  plotDepthFt = 40,
): CorrectionInput {
  return {
    rooms,
    brief: { ...brief(briefRooms), plotWidthFt, plotDepthFt },
    plotWidthFt,
    plotDepthFt,
  };
}

// ─── Core contract — resize preserving center + aspect ─────────

describe("Phase 2.9 enhance — applyDimensionCorrection resize math", () => {
  it("resizes a square 10x10 (100 sqft) to target 168 sqft → ~13×13 preserving center", () => {
    const rooms = [tr("Master Bedroom", 10, 10, 10, 10)];
    const res = applyDimensionCorrection(
      input(rooms, [{ name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 }]),
    );
    const corrected = res.rooms[0].placed;
    // Aspect preserved → sides should each be sqrt(168) ≈ 12.96, snapped to 0.1.
    expect(corrected.width).toBeCloseTo(13, 0);
    expect(corrected.depth).toBeCloseTo(13, 0);
    // Area should hit target within ~1 sqft.
    expect(areaOf(res.rooms[0])).toBeGreaterThan(160);
    expect(areaOf(res.rooms[0])).toBeLessThan(175);
    // Center preserved: original (15, 15), corrected center should match.
    const newCx = corrected.x + corrected.width / 2;
    const newCy = corrected.y + corrected.depth / 2;
    expect(newCx).toBeCloseTo(15, 0);
    expect(newCy).toBeCloseTo(15, 0);
    expect(res.applied[0].action).toBe("resized");
  });

  it("resizes a non-square 8×12 (ratio 0.667, 96 sqft) to target 168 sqft preserving ratio", () => {
    // 96 sqft vs 168 target → ratio 1.75 → outside the ±15% skip band.
    const rooms = [tr("Master Bedroom", 5, 5, 8, 12)];
    const res = applyDimensionCorrection(
      input(rooms, [{ name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 }]),
    );
    const p = res.rooms[0].placed;
    expect(p.width / p.depth).toBeCloseTo(8 / 12, 1);
    expect(areaOf(res.rooms[0])).toBeGreaterThan(160);
    expect(areaOf(res.rooms[0])).toBeLessThan(175);
    expect(res.applied[0].action).toBe("resized");
  });

  it("shrinks oversized rooms (140 sqft → 80 sqft Kitchen)", () => {
    const rooms = [tr("Kitchen", 0, 0, 12, 12)];
    const res = applyDimensionCorrection(
      input(rooms, [{ name: "Kitchen", type: "kitchen", approxAreaSqft: 80 }]),
    );
    expect(areaOf(res.rooms[0])).toBeGreaterThan(75);
    expect(areaOf(res.rooms[0])).toBeLessThan(85);
    expect(res.applied[0].action).toBe("resized");
  });
});

// ─── Skip paths ────────────────────────────────────────────────

describe("Phase 2.9 enhance — skip cases", () => {
  it("skip-no-target: brief has no entry for the room → leave unchanged", () => {
    const rooms = [tr("Mystery Room", 5, 5, 8, 10)];
    const res = applyDimensionCorrection(
      input(rooms, [{ name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 }]),
    );
    expect(res.rooms[0]).toEqual(rooms[0]);
    expect(res.applied[0].action).toBe("skipped-no-target");
  });

  it("skip-no-target: brief entry lacks approxAreaSqft → leave unchanged", () => {
    const rooms = [tr("Balcony", 5, 5, 8, 10)];
    const res = applyDimensionCorrection(
      input(rooms, [{ name: "Balcony", type: "balcony" }]),
    );
    expect(res.rooms[0]).toEqual(rooms[0]);
    expect(res.applied[0].action).toBe("skipped-no-target");
  });

  it("skip-close-enough: room already within ±15% of target → unchanged", () => {
    // 155 sqft vs target 168 → ratio 0.92, within ±15% → skip
    const rooms = [tr("Master Bedroom", 0, 0, 12.5, 12.4)];
    const res = applyDimensionCorrection(
      input(rooms, [{ name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 }]),
    );
    expect(res.rooms[0]).toEqual(rooms[0]);
    expect(res.applied[0].action).toBe("skipped-close-enough");
  });

  it("skip-zero-size: degenerate 0×0 rooms aren't processed", () => {
    const rooms = [tr("Degenerate", 5, 5, 0, 0)];
    const res = applyDimensionCorrection(
      input(rooms, [{ name: "Degenerate", type: "other", approxAreaSqft: 100 }]),
    );
    expect(res.rooms[0]).toEqual(rooms[0]);
    expect(res.applied[0].action).toBe("skipped-zero-size");
  });
});

// ─── Plot-bounds clipping ──────────────────────────────────────

describe("Phase 2.9 enhance — clip correction that exceeds plot", () => {
  it("clips a resized room that overshoots the plot edge", () => {
    // Room is at (35, 35) with target 168 sqft → ~13x13 around center → would
    // extend past x=40 + y=40. Clips to fit.
    const rooms = [tr("Master Bedroom", 35, 35, 3, 3)];
    const plotW = 40, plotD = 40;
    const res = applyDimensionCorrection(
      input(rooms, [{ name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 }], plotW, plotD),
    );
    const p = res.rooms[0].placed;
    expect(p.x + p.width).toBeLessThanOrEqual(plotW + 0.1);
    expect(p.y + p.depth).toBeLessThanOrEqual(plotD + 0.1);
    expect(res.applied[0].action).toBe("clipped-to-plot");
    expect(res.outOfBounds).toHaveLength(1);
    expect(res.outOfBounds[0].room).toBe("Master Bedroom");
  });
});

// ─── Minimum dimension floor ───────────────────────────────────

describe("Phase 2.9 enhance — minimum dimension floor", () => {
  it("refuses to produce rooms thinner than 4 ft even when target is small (Pooja 20 sqft)", () => {
    const rooms = [tr("Pooja Room", 10, 10, 6, 6)];
    const res = applyDimensionCorrection(
      input(rooms, [{ name: "Pooja Room", type: "pooja", approxAreaSqft: 20 }]),
    );
    const p = res.rooms[0].placed;
    // sqrt(20) ≈ 4.47 → both sides clamped to min 4 ft floor anyway.
    expect(p.width).toBeGreaterThanOrEqual(4);
    expect(p.depth).toBeGreaterThanOrEqual(4);
  });
});

// ─── Overlap detection ─────────────────────────────────────────

describe("Phase 2.9 enhance — detectOverlaps", () => {
  it("catches pairs that overlap > 0.5 sqft", () => {
    const rooms = [
      tr("Master Bedroom", 0, 0, 13, 13),
      tr("Bedroom 2", 10, 10, 10, 10), // overlaps (10,10) to (13,13) = 9 sqft
    ];
    const overlaps = detectOverlaps(rooms);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].a).toBe("Master Bedroom");
    expect(overlaps[0].b).toBe("Bedroom 2");
    expect(overlaps[0].overlapSqft).toBeCloseTo(9);
  });

  it("ignores edge-touching rooms (no overlap)", () => {
    const rooms = [
      tr("A", 0, 0, 10, 10),
      tr("B", 10, 0, 10, 10), // share edge at x=10, no overlap
    ];
    expect(detectOverlaps(rooms)).toEqual([]);
  });

  it("ignores sub-threshold overlaps (<0.5 sqft)", () => {
    const rooms = [
      tr("A", 0, 0, 10, 10),
      tr("B", 9.99, 0, 10, 10), // 0.1 sqft overlap — well below 0.5 threshold
    ];
    const overlaps = detectOverlaps(rooms, 0.5);
    expect(overlaps).toEqual([]);
  });
});

// ─── Plot-bounds clip-all pass ─────────────────────────────────

describe("Phase 2.9 enhance — clipAllToPlot", () => {
  it("clips rooms that protrude past the plot + records clips", () => {
    const rooms = [
      tr("Pooja Room", 38, 38, 4, 4), // extends 2ft past on both axes
      tr("Master Bedroom", 5, 5, 12, 12), // well inside
    ];
    const { rooms: clipped, clips } = clipAllToPlot(rooms, 40, 40);
    // Pooja clipped.
    expect(clipped[0].placed.x + clipped[0].placed.width).toBeLessThanOrEqual(40.1);
    expect(clipped[0].placed.y + clipped[0].placed.depth).toBeLessThanOrEqual(40.1);
    expect(clips).toHaveLength(1);
    expect(clips[0].room).toBe("Pooja Room");
    // Master Bedroom untouched.
    expect(clipped[1]).toEqual(rooms[1]);
  });
});

// ─── End-to-end: the prod failure scenario ────────────────────

describe("Phase 2.9 enhance — prod-failure scenario end-to-end", () => {
  it("takes four 104 sqft rooms and stretches each toward its brief target with no overlap when laid out with gaps", () => {
    // Rooms spread out enough, and NOT pinned to plot corners, so
    // center-preserving resize can grow without hitting the edge.
    // Layout on a 50×50 plot: four rooms at (4, 4), (25, 4), (4, 25),
    // (25, 25), each 10.2×10.2. Plenty of slack.
    const rooms = [
      tr("Master Bedroom", 4, 4, 10.2, 10.2),
      tr("Bedroom 2", 25, 4, 10.2, 10.2),
      tr("Bedroom 3", 4, 25, 10.2, 10.2),
      tr("Kitchen", 25, 25, 10.2, 10.2),
    ];
    const res = applyDimensionCorrection(
      input(
        rooms,
        [
          { name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 },
          { name: "Bedroom 2", type: "bedroom", approxAreaSqft: 120 },
          { name: "Bedroom 3", type: "bedroom", approxAreaSqft: 120 },
          { name: "Kitchen", type: "kitchen", approxAreaSqft: 80 },
        ],
        50,
        50,
      ),
    );
    // All 4 resized, none skipped.
    expect(res.applied.every((a) => a.action === "resized" || a.action === "clipped-to-plot")).toBe(true);
    // Areas now close to each target.
    expect(areaOf(res.rooms[0])).toBeGreaterThan(160); // Master ~168
    expect(areaOf(res.rooms[1])).toBeGreaterThan(115); // Bedroom 2 ~120
    expect(areaOf(res.rooms[2])).toBeGreaterThan(115); // Bedroom 3 ~120
    expect(areaOf(res.rooms[3])).toBeLessThan(85); // Kitchen shrunk to ~80
    // With this spread, no pairwise overlap.
    expect(detectOverlaps(res.rooms)).toEqual([]);
  });
});
