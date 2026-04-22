/**
 * Phase 2.7C — Stage 5 Fidelity Mode tests.
 *
 * Lock in the contract:
 *  - Dispatch: confidence >= 0.75 AND plotBounds non-null AND
 *    VIP_FORCE_STRIP_PACK != "true" → fidelity path.
 *  - Wall derivation: for a 2×2 grid, 4 interior + 8 exterior walls,
 *    each edge accounted for exactly once.
 *  - Doors: one per pair of rooms sharing an interior wall + one
 *    main entrance on the facing edge.
 *  - Windows: only on exterior walls, type-appropriate width,
 *    hallway/pooja/store skipped.
 *  - Validation: overlap flagged WITHOUT moving rooms;
 *    out-of-bounds flagged WITHOUT clipping.
 *  - Ensuite preservation: master bedroom + master bathroom share a
 *    wall in input → interior wall between them in output, rooms
 *    at unchanged positions.
 */

import { describe, it, expect } from "vitest";
import {
  shouldDispatchFidelity,
  runStage5FidelityMode,
  __internals,
} from "../stage-5-fidelity";
import type { Stage5Input, ExtractedRooms, ExtractedRoom } from "../types";
import type { StripPackRoom } from "../../strip-pack/types";
import type { ParsedConstraints } from "../../structured-parser";

const { deriveWalls, placeFidelityDoors, placeFidelityWindows, validateFidelity, buildFidelityRooms } =
  __internals;

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

function extraction(
  rooms: ExtractedRoom[],
  plotSize = 1024,
): ExtractedRooms {
  return {
    imageSize: { width: plotSize, height: plotSize },
    plotBoundsPx: { x: 0, y: 0, w: plotSize, h: plotSize },
    rooms,
    issues: [],
    expectedRoomsMissing: [],
    unexpectedRoomsFound: [],
  };
}

function parsedConstraints(): ParsedConstraints {
  return {
    plot: {
      width_ft: 40,
      depth_ft: 40,
      facing: null,
      shape: null,
      total_built_up_sqft: null,
    },
    rooms: [],
    adjacency_pairs: [],
    connects_all_groups: [],
    vastu_required: false,
    special_features: [],
    constraint_budget: {} as unknown as ParsedConstraints["constraint_budget"],
    extraction_notes: "",
  };
}

function stage5Input(
  ex: ExtractedRooms,
  plot = { w: 40, d: 40, facing: "north" as const },
): Stage5Input {
  return {
    extraction: ex,
    plotWidthFt: plot.w,
    plotDepthFt: plot.d,
    facing: plot.facing,
    parsedConstraints: parsedConstraints(),
    adjacencies: [],
  };
}

// ─── Dispatch predicate ────────────────────────────────────────

describe("shouldDispatchFidelity", () => {
  it("returns use=true when confidence >= 0.75 AND plotBounds present AND no force env", () => {
    const ex = extraction([
      extractedRoom("A", 0, 0, 100, 100, 0.9),
      extractedRoom("B", 100, 0, 100, 100, 0.9),
    ]);
    const r = shouldDispatchFidelity(ex, {});
    expect(r.use).toBe(true);
    expect(r.avgConfidence).toBeCloseTo(0.9);
    expect(r.reason).toMatch(/0\.9.*>=\s*0\.75/);
  });

  it("returns use=false when avg confidence < 0.75", () => {
    const ex = extraction([
      extractedRoom("A", 0, 0, 100, 100, 0.5),
      extractedRoom("B", 100, 0, 100, 100, 0.6),
    ]);
    const r = shouldDispatchFidelity(ex, {});
    expect(r.use).toBe(false);
    expect(r.reason).toMatch(/<\s*0\.75/);
  });

  it("returns use=false when plotBoundsPx is null", () => {
    const ex: ExtractedRooms = {
      ...extraction([extractedRoom("A", 0, 0, 100, 100, 0.9)]),
      plotBoundsPx: null,
    };
    const r = shouldDispatchFidelity(ex, {});
    expect(r.use).toBe(false);
    expect(r.reason).toMatch(/no plotBounds/);
  });

  it("returns use=false when VIP_FORCE_STRIP_PACK=true", () => {
    const ex = extraction([extractedRoom("A", 0, 0, 100, 100, 0.95)]);
    const r = shouldDispatchFidelity(ex, { VIP_FORCE_STRIP_PACK: "true" });
    expect(r.use).toBe(false);
    expect(r.reason).toMatch(/VIP_FORCE_STRIP_PACK/);
  });

  it("returns use=false when no rooms extracted", () => {
    const ex = extraction([]);
    const r = shouldDispatchFidelity(ex, {});
    expect(r.use).toBe(false);
  });
});

// ─── Wall derivation ───────────────────────────────────────────

describe("deriveWalls — 2×2 room grid", () => {
  // A 2×2 grid of 10×10ft rooms fills a 20×20ft plot.
  // Expected interior walls: 4 (1 horizontal between TL-BL + 1 TR-BR;
  //   1 vertical between TL-TR + 1 BL-BR). Wait, re-count:
  //   - Vertical between TL↔TR at x=10, y∈[10,20]
  //   - Vertical between BL↔BR at x=10, y∈[0,10]
  //   - Horizontal between TL↔BL at y=10, x∈[0,10]
  //   - Horizontal between TR↔BR at y=10, x∈[10,20]
  //   → 4 interior walls.
  // Expected exterior walls: 4 rooms × 2 exterior edges each = 8 segments.
  //   → 8 exterior walls.
  // Total: 12 walls.
  function build2x2(): StripPackRoom[] {
    return buildFidelityRooms([
      { name: "TL", type: "bedroom", placed: { x: 0, y: 10, width: 10, depth: 10 }, confidence: 0.9, labelAsShown: "TL" },
      { name: "TR", type: "bedroom", placed: { x: 10, y: 10, width: 10, depth: 10 }, confidence: 0.9, labelAsShown: "TR" },
      { name: "BL", type: "bedroom", placed: { x: 0, y: 0, width: 10, depth: 10 }, confidence: 0.9, labelAsShown: "BL" },
      { name: "BR", type: "bedroom", placed: { x: 10, y: 0, width: 10, depth: 10 }, confidence: 0.9, labelAsShown: "BR" },
    ]);
  }

  it("produces 4 interior walls and 8 exterior walls", () => {
    const walls = deriveWalls(build2x2());
    const interior = walls.filter((w) => w.type === "internal");
    const exterior = walls.filter((w) => w.type === "external");
    expect(interior.length).toBe(4);
    expect(exterior.length).toBe(8);
  });

  it("every interior wall has exactly 2 room_ids", () => {
    const walls = deriveWalls(build2x2());
    for (const w of walls.filter((w) => w.type === "internal")) {
      expect(w.room_ids.length).toBe(2);
    }
  });

  it("every exterior wall has exactly 1 room_id", () => {
    const walls = deriveWalls(build2x2());
    for (const w of walls.filter((w) => w.type === "external")) {
      expect(w.room_ids.length).toBe(1);
    }
  });

  it("preserves room positions — placed.x/y/width/depth unchanged after buildFidelityRooms", () => {
    const rooms = build2x2();
    expect(rooms[0].placed).toEqual({ x: 0, y: 10, width: 10, depth: 10 });
    expect(rooms[3].placed).toEqual({ x: 10, y: 0, width: 10, depth: 10 });
  });
});

describe("deriveWalls — partial edge sharing (L-shape touch)", () => {
  it("the non-shared part of an edge becomes exterior", () => {
    // Room A: 0..10 × 0..10. Room B: 10..20 × 0..5 (only touches bottom half).
    const rooms = buildFidelityRooms([
      { name: "A", type: "living", placed: { x: 0, y: 0, width: 10, depth: 10 }, confidence: 0.9, labelAsShown: "A" },
      { name: "B", type: "bedroom", placed: { x: 10, y: 0, width: 10, depth: 5 }, confidence: 0.9, labelAsShown: "B" },
    ]);
    const walls = deriveWalls(rooms);
    // Interior: 1 vertical at x=10, y∈[0,5]
    const interior = walls.filter((w) => w.type === "internal");
    expect(interior.length).toBe(1);
    expect(interior[0].start).toEqual({ x: 10, y: 0 });
    expect(interior[0].end).toEqual({ x: 10, y: 5 });
    // A has exterior right edge at x=10 from y=5 to y=10 — a partial segment.
    const aRightExterior = walls.find(
      (w) =>
        w.type === "external" &&
        w.room_ids[0] === rooms[0].id &&
        w.start.x === 10 &&
        w.end.x === 10 &&
        w.start.y === 5,
    );
    expect(aRightExterior).toBeDefined();
  });
});

// ─── Door placement ────────────────────────────────────────────

describe("placeFidelityDoors", () => {
  it("places one door per pair of rooms sharing a wall", () => {
    const rooms = buildFidelityRooms([
      { name: "Living", type: "living", placed: { x: 0, y: 0, width: 20, depth: 15 }, confidence: 0.9, labelAsShown: "Living" },
      { name: "Bedroom", type: "bedroom", placed: { x: 0, y: 15, width: 20, depth: 10 }, confidence: 0.9, labelAsShown: "Bedroom" },
    ]);
    const walls = deriveWalls(rooms);
    const doors = placeFidelityDoors(rooms, walls, "north", 20, 25, []);
    // One internal door + possibly one main entrance.
    const internalDoors = doors.filter((d) => !d.is_main_entrance);
    expect(internalDoors.length).toBe(1);
    expect(internalDoors[0].between).toContain("Living");
    expect(internalDoors[0].between).toContain("Bedroom");
  });

  it("places a main entrance on the facing-side exterior wall", () => {
    const rooms = buildFidelityRooms([
      { name: "Living", type: "living", placed: { x: 0, y: 0, width: 20, depth: 25 }, confidence: 0.9, labelAsShown: "Living" },
    ]);
    const walls = deriveWalls(rooms);
    const doors = placeFidelityDoors(rooms, walls, "north", 20, 25, []);
    const entrance = doors.find((d) => d.is_main_entrance);
    expect(entrance).toBeDefined();
    // North edge is y = plotDepth = 25.
    expect(entrance!.start.y).toBeCloseTo(25);
  });

  it("puts the primary circulation room first in `between` tuple", () => {
    // Bedroom ↔ Living: Living is primary (circulation), should be first.
    const rooms = buildFidelityRooms([
      { name: "Living Room", type: "living", placed: { x: 0, y: 0, width: 20, depth: 15 }, confidence: 0.9, labelAsShown: "LR" },
      { name: "Bedroom", type: "bedroom", placed: { x: 0, y: 15, width: 20, depth: 10 }, confidence: 0.9, labelAsShown: "B" },
    ]);
    const walls = deriveWalls(rooms);
    const doors = placeFidelityDoors(rooms, walls, "north", 20, 25, []);
    const internal = doors.find((d) => !d.is_main_entrance)!;
    expect(internal.between[0]).toBe("Living Room");
    expect(internal.between[1]).toBe("Bedroom");
  });
});

// ─── Window placement ─────────────────────────────────────────

describe("placeFidelityWindows", () => {
  it("places windows on exterior walls only", () => {
    const rooms = buildFidelityRooms([
      { name: "Living", type: "living", placed: { x: 0, y: 0, width: 20, depth: 15 }, confidence: 0.9, labelAsShown: "Living" },
      { name: "Bedroom", type: "bedroom", placed: { x: 0, y: 15, width: 20, depth: 10 }, confidence: 0.9, labelAsShown: "Bedroom" },
    ]);
    const walls = deriveWalls(rooms);
    const doors = placeFidelityDoors(rooms, walls, "north", 20, 25, []);
    const windows = placeFidelityWindows(rooms, walls, doors, "north", 20, 25);
    for (const w of windows) {
      const wall = walls.find((ww) => ww.id === w.wall_id);
      expect(wall?.type).toBe("external");
    }
  });

  it("uses ventilation (1.5ft) windows for bathrooms with high sill", () => {
    const rooms = buildFidelityRooms([
      { name: "Bath", type: "bathroom", placed: { x: 0, y: 0, width: 6, depth: 5 }, confidence: 0.9, labelAsShown: "Bath" },
    ]);
    const walls = deriveWalls(rooms);
    const windows = placeFidelityWindows(rooms, walls, [], "north", 6, 5);
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.width_ft).toBeCloseTo(1.5);
      expect(w.kind).toBe("ventilation");
      expect(w.sill_height_ft).toBeGreaterThanOrEqual(5.5);
    }
  });

  it("skips windows for hallway/pooja/store rooms", () => {
    const rooms = buildFidelityRooms([
      { name: "Hallway", type: "hallway", placed: { x: 0, y: 0, width: 10, depth: 3 }, confidence: 0.9, labelAsShown: "H" },
      { name: "Pooja", type: "pooja", placed: { x: 10, y: 0, width: 5, depth: 4 }, confidence: 0.9, labelAsShown: "P" },
    ]);
    const walls = deriveWalls(rooms);
    const windows = placeFidelityWindows(rooms, walls, [], "north", 15, 10);
    expect(windows.length).toBe(0);
  });
});

// ─── Validation (flag, don't fix) ─────────────────────────────

describe("validateFidelity — flag but don't mutate", () => {
  it("flags overlapping rooms without moving them", () => {
    const rooms = buildFidelityRooms([
      { name: "A", type: "bedroom", placed: { x: 0, y: 0, width: 10, depth: 10 }, confidence: 0.9, labelAsShown: "A" },
      { name: "B", type: "bedroom", placed: { x: 8, y: 0, width: 10, depth: 10 }, confidence: 0.9, labelAsShown: "B" },
    ]);
    // Overlap area = 2 × 10 = 20 sqft — well above the 0.5 sqft threshold.
    const issues = validateFidelity(rooms, 20, 10, []);
    expect(issues.some((i) => /overlap/i.test(i))).toBe(true);
    // Rooms positions untouched.
    expect(rooms[0].placed).toEqual({ x: 0, y: 0, width: 10, depth: 10 });
    expect(rooms[1].placed).toEqual({ x: 8, y: 0, width: 10, depth: 10 });
  });

  it("flags out-of-bounds rooms without clipping them", () => {
    const rooms = buildFidelityRooms([
      { name: "A", type: "bedroom", placed: { x: 0, y: 0, width: 50, depth: 10 }, confidence: 0.9, labelAsShown: "A" },
    ]);
    // Plot is 20×10. Room width 50 blows past.
    const issues = validateFidelity(rooms, 20, 10, []);
    expect(issues.some((i) => /beyond plot/i.test(i))).toBe(true);
    expect(rooms[0].placed).toEqual({ x: 0, y: 0, width: 50, depth: 10 });
  });

  it("flags when door count is insufficient for roomCount - 1 connectivity", () => {
    const rooms = buildFidelityRooms([
      { name: "A", type: "bedroom", placed: { x: 0, y: 0, width: 10, depth: 10 }, confidence: 0.9, labelAsShown: "A" },
      { name: "B", type: "bedroom", placed: { x: 11, y: 0, width: 10, depth: 10 }, confidence: 0.9, labelAsShown: "B" },
      { name: "C", type: "bedroom", placed: { x: 22, y: 0, width: 10, depth: 10 }, confidence: 0.9, labelAsShown: "C" },
    ]);
    // Three rooms, zero doors → insufficient connectivity.
    const issues = validateFidelity(rooms, 40, 10, []);
    expect(issues.some((i) => /disconnected|doors for/.test(i))).toBe(true);
  });
});

// ─── End-to-end: ensuite preservation ─────────────────────────

describe("runStage5FidelityMode — ensuite stays attached (no Option X, no movement)", () => {
  it("master bedroom + master bathroom that share a wall in input still share in output", async () => {
    // Room layout (feet):
    //   Master Bedroom: 0..15 × 0..12
    //   Master Bathroom: 15..22 × 0..7  (shares wall at x=15, y∈[0,7])
    //   Living Room: 0..22 × 12..24
    // Pixel coords: scaled to fit 1024px image mapped to 40ft plot (25.6 px/ft).
    const PX = 25.6;
    const ex = extraction(
      [
        { name: "Master Bedroom", rectPx: { x: 0, y: (40 - 12) * PX, w: 15 * PX, h: 12 * PX }, confidence: 0.9, labelAsShown: "MB" },
        { name: "Master Bathroom", rectPx: { x: 15 * PX, y: (40 - 7) * PX, w: 7 * PX, h: 7 * PX }, confidence: 0.9, labelAsShown: "MBa" },
        { name: "Living Room", rectPx: { x: 0, y: (40 - 24) * PX, w: 22 * PX, h: 12 * PX }, confidence: 0.9, labelAsShown: "L" },
      ],
      40 * PX,
    );

    // Set plotBoundsPx to match the 40×40ft = 1024×1024 px plot.
    ex.plotBoundsPx = { x: 0, y: 0, w: 40 * PX, h: 40 * PX };
    ex.imageSize = { width: 40 * PX, height: 40 * PX };

    const result = await runStage5FidelityMode(stage5Input(ex), undefined);
    const roomsOut = result.output.project.floors[0].rooms;
    // Our 3 input rooms must all appear; toFloorPlanProject may add a
    // synthetic hallway room for the spine — that's fine.
    expect(roomsOut.length).toBeGreaterThanOrEqual(3);

    // Metadata should reflect fidelity path + confidence.
    const meta = result.output.project.metadata as unknown as Record<string, unknown>;
    expect(meta.generation_stage5_path).toBe("fidelity");
    expect(meta.generation_stage4_avg_confidence).toBeCloseTo(0.9, 1);

    // Metrics path + avgConfidence.
    expect(result.metrics.path).toBe("fidelity");
    expect(result.metrics.avgConfidence).toBeCloseTo(0.9, 1);

    // Position preservation — the real fidelity contract. After
    // pixel→feet round-trip, Master Bedroom + Master Bathroom must
    // still sit with the ensuite's left edge touching the bedroom's
    // right edge at x=15ft. Project rooms are in millimeters
    // (FT_TO_MM = 304.8), so 15ft = 4572mm.
    const mbRoom = roomsOut.find((r) => /master bedroom/i.test(r.name));
    const mbaRoom = roomsOut.find((r) => /master bathroom/i.test(r.name));
    expect(mbRoom).toBeDefined();
    expect(mbaRoom).toBeDefined();

    // Room shapes are polygonal — extract bounding boxes from outline_mm.
    function bbox(points: Array<{ x: number; y: number }>): { minX: number; maxX: number; minY: number; maxY: number } {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, maxX, minY, maxY };
    }

    const mbBox = bbox(mbRoom!.boundary.points);
    const mbaBox = bbox(mbaRoom!.boundary.points);

    // Master Bedroom right edge ~ Master Bathroom left edge (x = 15ft = 4572mm).
    // Allow 50mm tolerance for rounding.
    expect(mbBox.maxX).toBeCloseTo(mbaBox.minX, -2); // ±100mm precision
    expect(mbBox.maxX).toBeGreaterThan(4500);
    expect(mbBox.maxX).toBeLessThan(4700);

    // Master Bathroom should NOT have been relocated (Option X would
    // snap it to a different x). With fidelity, maxX stays ~22ft = 6705mm.
    expect(mbaBox.maxX).toBeGreaterThan(6500);
    expect(mbaBox.maxX).toBeLessThan(6900);
  });
});
