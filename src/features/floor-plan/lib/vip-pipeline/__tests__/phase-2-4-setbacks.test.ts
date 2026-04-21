/**
 * Phase 2.4 P0-A — setback table + Stage 5 integration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveSetback,
  SETBACK_TABLE,
  computeEnvelope,
} from "../constants/setbacks";
import { runStage5Synthesis } from "../stage-5-synthesis";
import type { Stage5Input } from "../types";
import type { ParsedConstraints } from "../../structured-parser";

// ─── resolveSetback ──────────────────────────────────────────────

describe("resolveSetback", () => {
  it("returns DEFAULT when municipality is undefined", () => {
    expect(resolveSetback(undefined, 40, 40)).toEqual(SETBACK_TABLE.DEFAULT);
  });

  it("returns MUMBAI rule for MUMBAI (uppercase)", () => {
    expect(resolveSetback("MUMBAI", 40, 40)).toEqual(SETBACK_TABLE.MUMBAI);
  });

  it("normalizes lowercase city names", () => {
    expect(resolveSetback("Mumbai", 40, 40)).toEqual(SETBACK_TABLE.MUMBAI);
  });

  it("maps Bangalore alias → Bengaluru rule", () => {
    expect(resolveSetback("Bangalore", 30, 40)).toEqual(
      SETBACK_TABLE.BENGALURU_SMALL,
    );
  });

  it("picks BENGALURU_SMALL when plot ≤ 1200 sqft", () => {
    expect(resolveSetback("BENGALURU", 30, 40)).toEqual(
      SETBACK_TABLE.BENGALURU_SMALL,
    );
  });

  it("picks BENGALURU_LARGE when plot > 1200 sqft", () => {
    expect(resolveSetback("BENGALURU", 40, 40)).toEqual(
      SETBACK_TABLE.BENGALURU_LARGE,
    );
  });

  it("falls back to DEFAULT for unknown city", () => {
    expect(resolveSetback("TIMBUKTU", 40, 40)).toEqual(SETBACK_TABLE.DEFAULT);
  });
});

// ─── computeEnvelope (feature flag gating) ────────────────────────

describe("computeEnvelope — feature flag", () => {
  const originalEnv = process.env.PHASE_2_4_SETBACKS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PHASE_2_4_SETBACKS;
    else process.env.PHASE_2_4_SETBACKS = originalEnv;
  });

  it("returns a no-op envelope when flag is off (default)", () => {
    delete process.env.PHASE_2_4_SETBACKS;
    const env = computeEnvelope(40, 40, "MUMBAI");
    expect(env.applied).toBe(false);
    expect(env.originX).toBe(0);
    expect(env.originY).toBe(0);
    expect(env.usableWidthFt).toBe(40);
    expect(env.usableDepthFt).toBe(40);
  });

  it("applies DEFAULT setbacks when flag=true and municipality unset", () => {
    process.env.PHASE_2_4_SETBACKS = "true";
    const env = computeEnvelope(40, 40, undefined);
    expect(env.applied).toBe(true);
    expect(env.originX).toBe(2);
    expect(env.originY).toBe(3);
    expect(env.usableWidthFt).toBe(36);
    expect(env.usableDepthFt).toBe(34);
  });

  it("applies MUMBAI setbacks when flag=true + municipality MUMBAI", () => {
    process.env.PHASE_2_4_SETBACKS = "true";
    const env = computeEnvelope(40, 40, "MUMBAI");
    expect(env.applied).toBe(true);
    expect(env.rule).toEqual(SETBACK_TABLE.MUMBAI);
    expect(env.usableWidthFt).toBeCloseTo(40 - 4.9 * 2, 1);
    expect(env.usableDepthFt).toBeCloseTo(40 - 9.8 * 2, 1);
  });

  it("falls back safely when plot too small for setback", () => {
    process.env.PHASE_2_4_SETBACKS = "true";
    const env = computeEnvelope(10, 10, "MUMBAI");
    expect(env.applied).toBe(false);
    expect(env.fallbackReason).toMatch(/too small/i);
  });
});

// ─── Stage 5 integration ─────────────────────────────────────────

function makeStage5Input(municipality?: string): Stage5Input {
  return {
    extraction: {
      imageSize: { width: 1024, height: 1024 },
      plotBoundsPx: { x: 100, y: 100, w: 800, h: 800 },
      rooms: [
        {
          name: "Living",
          rectPx: { x: 100, y: 100, w: 400, h: 400 },
          confidence: 0.9,
          labelAsShown: "LIVING",
        },
        {
          name: "Bedroom",
          rectPx: { x: 500, y: 500, w: 400, h: 400 },
          confidence: 0.9,
          labelAsShown: "BEDROOM",
        },
      ],
      issues: [],
      expectedRoomsMissing: [],
      unexpectedRoomsFound: [],
    },
    plotWidthFt: 40,
    plotDepthFt: 40,
    facing: "north",
    municipality,
    parsedConstraints: {
      plot: { width_ft: 40, depth_ft: 40, facing: "north" },
      rooms: [
        { name: "Living", function: "living_room" },
        { name: "Bedroom", function: "bedroom" },
      ],
      adjacency_pairs: [],
      vastu_required: false,
      special_features: [],
    } as unknown as ParsedConstraints,
  };
}

describe("Stage 5 synthesis — setback integration", () => {
  const originalEnv = process.env.PHASE_2_4_SETBACKS;

  beforeEach(() => {
    delete process.env.PHASE_2_4_SETBACKS;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PHASE_2_4_SETBACKS;
    else process.env.PHASE_2_4_SETBACKS = originalEnv;
  });

  it("flag OFF — rooms can sit at plot edge (x≈0)", async () => {
    const { output } = await runStage5Synthesis(makeStage5Input());
    const rooms = output.project.floors[0].rooms;
    expect(rooms.length).toBeGreaterThan(0);
    // At least one room should have its bounding box touching x=0 or y=0.
    const touchingEdge = rooms.some((r) => {
      const xs = r.boundary.points.map((p) => p.x);
      const ys = r.boundary.points.map((p) => p.y);
      return Math.min(...xs) <= 1 || Math.min(...ys) <= 1; // ≤1mm
    });
    expect(touchingEdge).toBe(true);
  });

  it("flag ON + no municipality — rooms offset by DEFAULT setback", async () => {
    process.env.PHASE_2_4_SETBACKS = "true";
    const { output } = await runStage5Synthesis(makeStage5Input());
    const rooms = output.project.floors[0].rooms;
    expect(rooms.length).toBeGreaterThan(0);
    // With DEFAULT side=2ft=609.6mm and rear=3ft=914.4mm, every room
    // x-coord should be >= side setback mm, y-coord >= rear setback mm.
    for (const r of rooms) {
      const xs = r.boundary.points.map((p) => p.x);
      const ys = r.boundary.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      // Allow 10mm tolerance for rounding.
      expect(minX).toBeGreaterThanOrEqual(609.6 - 10);
      expect(minY).toBeGreaterThanOrEqual(914.4 - 10);
    }
  });

  it("flag ON + MUMBAI — rooms offset by Mumbai setback", async () => {
    process.env.PHASE_2_4_SETBACKS = "true";
    const { output } = await runStage5Synthesis(makeStage5Input("MUMBAI"));
    const rooms = output.project.floors[0].rooms;
    expect(rooms.length).toBeGreaterThan(0);
    // Mumbai side=4.9ft=1493.5mm.
    for (const r of rooms) {
      const xs = r.boundary.points.map((p) => p.x);
      const minX = Math.min(...xs);
      expect(minX).toBeGreaterThanOrEqual(1493.5 - 20);
    }
  });

  it("flag ON — metadata.setback_applied is populated", async () => {
    process.env.PHASE_2_4_SETBACKS = "true";
    const { output } = await runStage5Synthesis(makeStage5Input("MUMBAI"));
    const meta = output.project.metadata as unknown as Record<string, unknown>;
    expect(meta.setback_applied).toEqual(SETBACK_TABLE.MUMBAI);
    expect(meta.plot_usable_area).toBeDefined();
  });

  it("flag ON + plot too small — graceful fallback, no crash", async () => {
    process.env.PHASE_2_4_SETBACKS = "true";
    const input = makeStage5Input("MUMBAI");
    input.plotWidthFt = 10;
    input.plotDepthFt = 10;
    const { output } = await runStage5Synthesis(input);
    // Warning pushed into issues, but synthesis still completes.
    expect(
      output.issues.some((m) => /too small/i.test(m)),
    ).toBe(true);
    expect(output.project.floors[0].rooms.length).toBeGreaterThan(0);
  });
});
