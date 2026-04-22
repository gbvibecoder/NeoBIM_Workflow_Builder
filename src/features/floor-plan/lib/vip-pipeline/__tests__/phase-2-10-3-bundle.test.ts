/**
 * Phase 2.10.3 — unique-label prompt + Stage 4 dedup + Stage 6 drift weight.
 *
 * Bundled in a single test file mirroring the single-commit bundling.
 * Three describe groups, one per fix.
 */

import { describe, expect, it } from "vitest";
import { appendLabelRequirements } from "../stage-1-prompt";
import {
  applyStage4PostValidation,
  dedupRoomNames,
} from "../stage-4-validators";
import { applyDriftPenalty } from "../stage-6-quality";
import type {
  ArchitectBrief,
  ExtractedRoom,
  ExtractedRooms,
  ExtractedRoomsDriftMetrics,
  QualityDimension,
  RectPx,
} from "../types";

// ─── Fixtures ──────────────────────────────────────────────────

function sampleBrief(): ArchitectBrief {
  return {
    projectType: "residential",
    plotWidthFt: 40,
    plotDepthFt: 40,
    facing: "north",
    styleCues: ["residential"],
    constraints: [],
    adjacencies: [],
    roomList: [
      { name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 },
      { name: "Bedroom 2", type: "bedroom", approxAreaSqft: 120 },
      { name: "Bedroom 3", type: "bedroom", approxAreaSqft: 110 },
      { name: "Living Room", type: "living", approxAreaSqft: 280 },
      { name: "Kitchen", type: "kitchen", approxAreaSqft: 80 },
      { name: "Master Bathroom", type: "master_bathroom", approxAreaSqft: 35 },
    ],
  };
}

const PLOT: RectPx = { x: 0, y: 0, w: 1024, h: 1024 };

function mkRoom(name: string, areaSqft: number, confidence = 0.9): ExtractedRoom {
  const sidePx = Math.round(Math.sqrt(areaSqft) * (1024 / 40));
  return {
    name,
    rectPx: { x: 0, y: 0, w: sidePx, h: sidePx },
    confidence,
    labelAsShown: name,
  };
}

function mkExtraction(rooms: ExtractedRoom[]): ExtractedRooms {
  return {
    imageSize: { width: 1024, height: 1024 },
    plotBoundsPx: PLOT,
    rooms,
    issues: [],
    expectedRoomsMissing: [],
    unexpectedRoomsFound: [],
  };
}

function mkDimensions(
  overrides: Partial<Record<QualityDimension, number>> = {},
): Record<QualityDimension, number> {
  const base: Record<QualityDimension, number> = {
    roomCountMatch: 8,
    noDuplicateNames: 9,
    dimensionPlausibility: 8,
    vastuCompliance: 8,
    orientationCorrect: 8,
    connectivity: 8,
    exteriorWindows: 7,
    adjacencyCompliance: 8,
    bedroomPrivacy: 8,
    entranceDoor: 8,
  };
  return { ...base, ...overrides };
}

function mkDrift(
  severity: "none" | "moderate" | "severe",
  ratio: number,
): ExtractedRoomsDriftMetrics {
  return {
    imageBboxPx: { x: 0, y: 0, w: 1024, h: 1024 },
    roomsUnionBboxPx: { x: 100, y: 100, w: 400, h: 400 },
    driftRatio: ratio,
    driftFlagged: severity !== "none",
    severity,
  };
}

// ─── Fix 1: Stage 1 appendLabelRequirements ────────────────────

describe("Phase 2.10.3 — appendLabelRequirements", () => {
  it("appends the CRITICAL LABEL REQUIREMENTS block", () => {
    const out = appendLabelRequirements("Floor plan", ["Master", "Kitchen"]);
    expect(out).toMatch(/CRITICAL LABEL REQUIREMENTS:/);
    expect(out).toMatch(/Every room label MUST appear EXACTLY ONCE/);
    expect(out).toMatch(/NOT two "BEDROOM 2"/);
    expect(out).toMatch(/monospace sans-serif, 16-18px/);
  });

  it("injects the comma-separated room-name list into 'Labels must match EXACTLY:'", () => {
    const out = appendLabelRequirements("Any prompt", [
      "Master Bedroom",
      "Kitchen",
      "Pooja Room",
    ]);
    expect(out).toMatch(/Labels must match EXACTLY: Master Bedroom, Kitchen, Pooja Room/);
  });

  it("keeps the caller's original prompt text intact at the top", () => {
    const orig = "Generate a 40x40 Indian residential floor plan with vastu zones.";
    const out = appendLabelRequirements(orig, ["Living Room"]);
    expect(out.startsWith(orig)).toBe(true);
  });

  it("is idempotent — calling twice doesn't double-append", () => {
    const once = appendLabelRequirements("A prompt", ["Room A"]);
    const twice = appendLabelRequirements(once, ["Room A"]);
    expect(twice).toBe(once);
  });

  it("ignores empty/whitespace names in the label list", () => {
    const out = appendLabelRequirements("P", ["Bedroom", "  ", "", "Kitchen"]);
    expect(out).toMatch(/Labels must match EXACTLY: Bedroom, Kitchen/);
  });
});

// ─── Fix 2: Stage 4 dedupRoomNames ─────────────────────────────

describe("Phase 2.10.3 — dedupRoomNames", () => {
  it("passes non-duplicate lists through unchanged", () => {
    const brief = sampleBrief();
    const rooms = [
      mkRoom("Master Bedroom", 160),
      mkRoom("Bedroom 2", 120),
      mkRoom("Living Room", 280),
    ];
    const issues: string[] = [];
    const { rooms: out, renames } = dedupRoomNames(rooms, brief, issues);
    expect(out.map((r) => r.name)).toEqual(["Master Bedroom", "Bedroom 2", "Living Room"]);
    expect(renames).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("renames a duplicate to the first available brief name not yet extracted", () => {
    const brief = sampleBrief();
    const rooms = [
      mkRoom("Bedroom 2", 120),
      mkRoom("Bedroom 2", 115), // duplicate — expected rename target is first missing brief name
      mkRoom("Living Room", 280),
    ];
    const issues: string[] = [];
    const { rooms: out, renames } = dedupRoomNames(rooms, brief, issues);
    // Briefs in order: Master Bedroom, Bedroom 2, Bedroom 3, Living Room, Kitchen, Master Bathroom
    // "Bedroom 2" already used after first pass → next missing = "Master Bedroom"
    expect(renames).toHaveLength(1);
    expect(renames[0].from).toBe("Bedroom 2");
    expect(renames[0].to).toBe("Master Bedroom");
    expect(out.map((r) => r.name)).toEqual(["Bedroom 2", "Master Bedroom", "Living Room"]);
    expect(issues[0]).toMatch(/^dedup: renamed "Bedroom 2" → "Master Bedroom"/);
  });

  it("is case-insensitive when detecting duplicates", () => {
    const brief = sampleBrief();
    const rooms = [
      mkRoom("bedroom 2", 120),
      mkRoom("BEDROOM 2", 115),
    ];
    const issues: string[] = [];
    const { rooms: out, renames } = dedupRoomNames(rooms, brief, issues);
    expect(renames).toHaveLength(1);
    expect(out[0].name).toBe("bedroom 2");
    expect(out[1].name).not.toBe("BEDROOM 2");
  });

  it("falls back to 'Room N' when no brief name is available", () => {
    const briefAllUsed: ArchitectBrief = {
      ...sampleBrief(),
      // Only one brief name — after the first extraction uses it, duplicates
      // have no available brief fallback.
      roomList: [{ name: "Bedroom", type: "bedroom", approxAreaSqft: 100 }],
    };
    const rooms = [
      mkRoom("Bedroom", 100),
      mkRoom("Bedroom", 100),
      mkRoom("Bedroom", 100),
    ];
    const issues: string[] = [];
    const { rooms: out, renames } = dedupRoomNames(rooms, briefAllUsed, issues);
    expect(renames).toHaveLength(2);
    expect(renames[0].to).toMatch(/^Room \d+$/);
    expect(renames[1].to).toMatch(/^Room \d+$/);
    expect(renames[0].to).not.toBe(renames[1].to);
    expect(out.map((r) => r.name)).toHaveLength(3);
    expect(new Set(out.map((r) => r.name)).size).toBe(3);
    expect(issues[0]).toMatch(/fallback/);
  });

  it("integrates through applyStage4PostValidation: attaches dedupRenames array", () => {
    const brief = sampleBrief();
    const rooms = [
      mkRoom("Master Bedroom", 160),
      mkRoom("Bedroom 2", 120),
      mkRoom("Bedroom 2", 115), // duplicate
      mkRoom("Kitchen", 80),
    ];
    const extraction = mkExtraction(rooms);
    applyStage4PostValidation(extraction, brief);
    expect(extraction.dedupRenames).toBeDefined();
    expect(extraction.dedupRenames).toHaveLength(1);
    expect(extraction.dedupRenames![0].from).toBe("Bedroom 2");
    // expectedRoomsMissing should be recomputed AFTER the rename — the
    // renamed room should no longer be in the missing list.
    expect(extraction.expectedRoomsMissing).not.toContain(extraction.dedupRenames![0].to);
  });
});

// ─── Fix 3: Stage 6 applyDriftPenalty ──────────────────────────

describe("Phase 2.10.3 — applyDriftPenalty", () => {
  it("no-ops when driftMetrics is undefined", () => {
    const dims = mkDimensions();
    const r = applyDriftPenalty(dims, undefined);
    expect(r.severity).toBe("none");
    expect(r.appliedPenalty).toBe(0);
    expect(r.dimensions.dimensionPlausibility).toBe(8);
  });

  it("no-ops when severity === 'none'", () => {
    const dims = mkDimensions();
    const r = applyDriftPenalty(dims, mkDrift("none", 0.1));
    expect(r.appliedPenalty).toBe(0);
    expect(r.dimensions.dimensionPlausibility).toBe(8);
  });

  it("subtracts 5 on moderate severity", () => {
    const dims = mkDimensions({ dimensionPlausibility: 8 });
    const r = applyDriftPenalty(dims, mkDrift("moderate", 0.25));
    expect(r.severity).toBe("moderate");
    expect(r.appliedPenalty).toBe(5);
    expect(r.dimensions.dimensionPlausibility).toBe(3);
  });

  it("subtracts 10 on severe severity (allowed to go below 1 at this layer)", () => {
    // applyDriftPenalty returns raw subtracted values; clamping to [1,10]
    // happens inside computeVerdict. This test verifies the raw math.
    const dims = mkDimensions({ dimensionPlausibility: 8 });
    const r = applyDriftPenalty(dims, mkDrift("severe", 0.5));
    expect(r.severity).toBe("severe");
    expect(r.appliedPenalty).toBe(10);
    expect(r.dimensions.dimensionPlausibility).toBe(-2);
  });

  it("does not mutate the input dimensions object", () => {
    const dims = mkDimensions({ dimensionPlausibility: 8 });
    applyDriftPenalty(dims, mkDrift("severe", 0.5));
    expect(dims.dimensionPlausibility).toBe(8);
  });

  it("leaves other dimensions unchanged", () => {
    const dims = mkDimensions({ dimensionPlausibility: 8, roomCountMatch: 7 });
    const r = applyDriftPenalty(dims, mkDrift("severe", 0.5));
    expect(r.dimensions.roomCountMatch).toBe(7);
    expect(r.dimensions.noDuplicateNames).toBe(9);
    expect(r.dimensions.entranceDoor).toBe(8);
  });
});
