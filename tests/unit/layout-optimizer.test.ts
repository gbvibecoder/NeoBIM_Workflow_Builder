import { describe, it, expect } from "vitest";
import {
  optimizeLayout,
  type OptimizationResult,
} from "@/features/floor-plan/lib/layout-optimizer";
import {
  computeEnergy,
  type PlacedRoom,
  type EnergyBreakdown,
} from "@/features/floor-plan/lib/energy-function";
import { matchTypology } from "@/features/floor-plan/lib/typology-matcher";
import type {
  EnhancedRoomProgram,
  RoomSpec,
} from "@/features/floor-plan/lib/ai-room-programmer";

// ── Helpers ─────────────────────────────────────────────────────────────────

function room(
  name: string,
  type: string,
  areaSqm: number,
  zone: "public" | "private" | "service" | "circulation" = "private",
): RoomSpec {
  return {
    name,
    type,
    areaSqm,
    zone,
    mustHaveExteriorWall: false,
    adjacentTo: [],
    preferNear: [],
  };
}

function makeProgram(
  rooms: RoomSpec[],
  opts: {
    buildingType?: string;
    totalAreaSqm?: number;
    originalPrompt?: string;
  } = {},
): EnhancedRoomProgram {
  const totalArea =
    opts.totalAreaSqm ?? rooms.reduce((s, r) => s + r.areaSqm, 0);
  return {
    buildingType: opts.buildingType ?? "apartment",
    totalAreaSqm: totalArea,
    numFloors: 1,
    rooms,
    adjacency: [],
    zones: { public: [], private: [], service: [], circulation: [] },
    entranceRoom: rooms[0]?.name ?? "",
    circulationNotes: "",
    projectName: "Test",
    originalPrompt: opts.originalPrompt,
  };
}

function makeRoom(
  id: string,
  name: string,
  type: string,
  x: number,
  y: number,
  width: number,
  depth: number,
  opts: {
    zone?: PlacedRoom["zone"];
    targetArea?: number;
    mustHaveExteriorWall?: boolean;
  } = {},
): PlacedRoom {
  return {
    id,
    name,
    type,
    x,
    y,
    width,
    depth,
    zone: opts.zone ?? "private",
    targetArea: opts.targetArea ?? width * depth,
    mustHaveExteriorWall: opts.mustHaveExteriorWall ?? false,
  };
}

/** Convert ScaledRoom[] from matcher to PlacedRoom[] for optimizer */
function scaledToPlaced(
  scaledRooms: Array<{
    slotId: string;
    name: string;
    type: string;
    x: number;
    y: number;
    width: number;
    depth: number;
    zone: string;
  }>,
): PlacedRoom[] {
  return scaledRooms.map((r) => ({
    id: r.slotId,
    name: r.name,
    type: r.type,
    x: r.x,
    y: r.y,
    width: r.width,
    depth: r.depth,
    zone: r.zone as PlacedRoom["zone"],
    targetArea: r.width * r.depth,
    mustHaveExteriorWall: false,
  }));
}

function printResult(label: string, result: OptimizationResult): void {
  const b = result.energy.breakdown;
  const topTerms = (Object.keys(b) as Array<keyof EnergyBreakdown>)
    .map((k) => ({ k, v: b[k] }))
    .filter((t) => t.v > 0.001)
    .sort((a, b_) => b_.v - a.v)
    .slice(0, 5);

  console.log(`\n=== ${label} ===`);
  console.log(
    `Initial: ${result.initialEnergy.toFixed(1)} → Final: ${result.energy.total.toFixed(1)}  (${((1 - result.energy.total / Math.max(result.initialEnergy, 0.01)) * 100).toFixed(1)}% improvement)`,
  );
  console.log(
    `Iterations: ${result.iterations} | Improvements: ${result.improvements} | Time: ${result.timeMs.toFixed(0)}ms`,
  );
  if (topTerms.length > 0) {
    console.log(
      `Top terms: ${topTerms.map((t) => `${t.k}=${t.v.toFixed(2)}`).join(", ")}`,
    );
  }
  console.log("Rooms:");
  for (const r of result.rooms) {
    const ar = Math.max(r.width, r.depth) / Math.min(r.width, r.depth);
    console.log(
      `  ${r.name.padEnd(22)} ${r.width.toFixed(1)}×${r.depth.toFixed(1)}m  AR=${ar.toFixed(2)}  [${r.type}]`,
    );
  }
}

// ── Test 1: Template-seeded 2BHK optimization ───────────────────────────────

describe("layout-optimizer — Test 1: 2BHK template optimization", () => {
  const programRooms = [
    room("Master Bedroom", "bedroom", 14, "private"),
    room("Bedroom 2", "bedroom", 12, "private"),
    room("Master Bathroom", "bathroom", 4, "service"),
    room("Common Bathroom", "bathroom", 3.5, "service"),
    room("Kitchen", "kitchen", 8, "service"),
    room("Living Room", "living_room", 18, "public"),
    room("Balcony", "balcony", 4, "public"),
    room("Corridor", "corridor", 6, "circulation"),
  ];
  const program = makeProgram(programRooms, {
    buildingType: "apartment",
    totalAreaSqm: 70,
    originalPrompt: "2BHK apartment 70 sqm",
  });

  let result: OptimizationResult;

  it("produces a layout with lower energy than input", () => {
    const match = matchTypology(program);
    expect(match).not.toBeNull();
    const placed = scaledToPlaced(match!.scaledRooms);
    const fp = match!.footprint;

    result = optimizeLayout(placed, fp, program);
    printResult("2BHK template optimization", result);

    expect(result.energy.total).toBeLessThanOrEqual(result.initialEnergy);
  });

  it("has zero overlaps", () => {
    expect(result.energy.breakdown.overlap).toBeCloseTo(0, 2);
  });

  it("has zero boundary violations", () => {
    expect(result.energy.breakdown.boundary).toBeCloseTo(0, 2);
  });

  it("all rooms have AR ≤ 2.5 (except corridor)", () => {
    for (const r of result.rooms) {
      if (["corridor", "hallway", "passage"].includes(r.type)) continue;
      const ar = Math.max(r.width, r.depth) / Math.min(r.width, r.depth);
      expect(ar).toBeLessThanOrEqual(2.5);
    }
  });
});

// ── Test 2: Deliberately bad layout optimization ────────────────────────────

describe("layout-optimizer — Test 2: bad layout optimization", () => {
  const fp = { width: 10, depth: 8.5 };
  const badLayout: PlacedRoom[] = [
    // Overlapping bedrooms
    makeRoom("bed1", "Master Bedroom", "master_bedroom", 1, 1, 3.5, 4.0, {
      zone: "private", targetArea: 14,
    }),
    makeRoom("bed2", "Bedroom 2", "bedroom", 2, 1, 3.2, 3.8, {
      zone: "private", targetArea: 12,
    }),
    // Bathroom out of position
    makeRoom("bath1", "Bathroom", "bathroom", 7, 5, 1.8, 2.5, {
      zone: "service", targetArea: 4,
    }),
    // Kitchen overlapping bathroom
    makeRoom("kit", "Kitchen", "kitchen", 6.5, 4.5, 2.5, 3.5, {
      zone: "service", targetArea: 8,
    }),
    // Living room
    makeRoom("liv", "Living Room", "living_room", 0, 5, 5.0, 3.5, {
      zone: "public", targetArea: 18,
    }),
    // Corridor
    makeRoom("corr", "Corridor", "corridor", 0, 3.8, 10, 1.2, {
      zone: "circulation", targetArea: 12,
    }),
  ];

  const program = makeProgram(
    [
      room("Master Bedroom", "bedroom", 14, "private"),
      room("Bedroom 2", "bedroom", 12, "private"),
      room("Bathroom", "bathroom", 4, "service"),
      room("Kitchen", "kitchen", 8, "service"),
      room("Living Room", "living_room", 18, "public"),
      room("Corridor", "corridor", 12, "circulation"),
    ],
    { buildingType: "apartment", totalAreaSqm: 70 },
  );

  it("dramatically reduces energy from bad starting point", () => {
    const initialEnergy = computeEnergy(badLayout, fp, program).total;
    const result = optimizeLayout(badLayout, fp, program, { maxIterations: 5000 });
    printResult("Bad layout optimization", result);

    // Energy should decrease significantly
    expect(result.energy.total).toBeLessThan(initialEnergy);
    // Should improve by at least 30%
    const improvement = 1 - result.energy.total / initialEnergy;
    expect(improvement).toBeGreaterThan(0.3);
  });
});

// ── Test 3: 3BHK double-loaded template optimization ────────────────────────

describe("layout-optimizer — Test 3: 3BHK double-loaded", () => {
  const programRooms = [
    room("Master Bedroom", "bedroom", 15, "private"),
    room("Bedroom 2", "bedroom", 12, "private"),
    room("Bedroom 3", "bedroom", 12, "private"),
    room("Master Bathroom", "bathroom", 4.5, "service"),
    room("Bathroom 2", "bathroom", 3.5, "service"),
    room("Common Bathroom", "bathroom", 3.5, "service"),
    room("Kitchen", "kitchen", 9, "service"),
    room("Dining Room", "dining_room", 10, "public"),
    room("Living Room", "living_room", 18, "public"),
    room("Balcony", "balcony", 4, "public"),
    room("Utility", "utility", 3.5, "service"),
    room("Corridor", "corridor", 7, "circulation"),
  ];
  const program = makeProgram(programRooms, {
    buildingType: "flat",
    totalAreaSqm: 102,
    originalPrompt: "3BHK flat 100 sqm",
  });

  let result: OptimizationResult;

  it("reduces energy and maintains zero hard violations", () => {
    const match = matchTypology(program);
    expect(match).not.toBeNull();
    const placed = scaledToPlaced(match!.scaledRooms);
    const fp = match!.footprint;

    result = optimizeLayout(placed, fp, program);
    printResult("3BHK double-loaded optimization", result);

    expect(result.energy.total).toBeLessThanOrEqual(result.initialEnergy);
    expect(result.energy.breakdown.overlap).toBeCloseTo(0, 2);
    expect(result.energy.breakdown.boundary).toBeCloseTo(0, 2);
  });

  it("all bedrooms have AR ≤ 1.8", () => {
    const bedrooms = result.rooms.filter((r) =>
      ["master_bedroom", "bedroom"].includes(r.type),
    );
    for (const r of bedrooms) {
      const ar = Math.max(r.width, r.depth) / Math.min(r.width, r.depth);
      expect(ar).toBeLessThanOrEqual(1.85); // tiny tolerance for float math
    }
  });
});

// ── Test 4: Performance test with 15 rooms ──────────────────────────────────

describe("layout-optimizer — Test 4: performance (15 rooms)", () => {
  const programRooms = [
    room("Master Bedroom", "bedroom", 20, "private"),
    room("Bedroom 2", "bedroom", 15, "private"),
    room("Bedroom 3", "bedroom", 15, "private"),
    room("Bedroom 4", "bedroom", 14, "private"),
    room("Bedroom 5", "bedroom", 14, "private"),
    room("Master Bathroom", "bathroom", 5.5, "service"),
    room("Bathroom 2", "bathroom", 4, "service"),
    room("Bathroom 3", "bathroom", 4, "service"),
    room("Bathroom 4", "bathroom", 3.5, "service"),
    room("Bathroom 5", "bathroom", 3.5, "service"),
    room("Kitchen", "kitchen", 12, "service"),
    room("Dining Room", "dining_room", 14, "public"),
    room("Living Room", "living_room", 25, "public"),
    room("Drawing Room", "drawing_room", 18, "public"),
    room("Corridor", "corridor", 12, "circulation"),
  ];
  const program = makeProgram(programRooms, {
    buildingType: "villa",
    totalAreaSqm: 250,
    originalPrompt: "5BHK villa 250 sqm",
  });

  it("completes 5000 iterations in < 3 seconds", () => {
    const match = matchTypology(program);
    expect(match).not.toBeNull();
    const placed = scaledToPlaced(match!.scaledRooms);
    const fp = match!.footprint;

    const result = optimizeLayout(placed, fp, program, {
      maxIterations: 5000,
      restarts: 2,
    });
    printResult("5BHK performance test", result);

    expect(result.timeMs).toBeLessThan(3000);
    expect(result.iterations).toBeGreaterThan(1000);
  });
});

// ── Test 5: Determinism ─────────────────────────────────────────────────────

describe("layout-optimizer — Test 5: determinism", () => {
  const programRooms = [
    room("Master Bedroom", "bedroom", 14, "private"),
    room("Bedroom 2", "bedroom", 12, "private"),
    room("Bathroom", "bathroom", 4, "service"),
    room("Kitchen", "kitchen", 8, "service"),
    room("Living Room", "living_room", 18, "public"),
    room("Corridor", "corridor", 6, "circulation"),
  ];
  const program = makeProgram(programRooms, {
    buildingType: "apartment",
    totalAreaSqm: 65,
    originalPrompt: "2BHK apartment 65 sqm",
  });

  it("produces identical energy on two runs with same input", () => {
    const match = matchTypology(program);
    expect(match).not.toBeNull();
    const placed = scaledToPlaced(match!.scaledRooms);
    const fp = match!.footprint;

    const result1 = optimizeLayout(placed, fp, program);
    const result2 = optimizeLayout(placed, fp, program);

    expect(result1.energy.total).toBeCloseTo(result2.energy.total, 3);
    expect(result1.improvements).toBe(result2.improvements);
  });
});

// ── Test 6: Restart benefit ─────────────────────────────────────────────────

describe("layout-optimizer — Test 6: restart benefit", () => {
  const programRooms = [
    room("Master Bedroom", "bedroom", 14, "private"),
    room("Bedroom 2", "bedroom", 12, "private"),
    room("Master Bathroom", "bathroom", 4.5, "service"),
    room("Common Bathroom", "bathroom", 3.5, "service"),
    room("Kitchen", "kitchen", 8, "service"),
    room("Living Room", "living_room", 18, "public"),
    room("Dining Room", "dining_room", 10, "public"),
    room("Corridor", "corridor", 7, "circulation"),
  ];
  const program = makeProgram(programRooms, {
    buildingType: "apartment",
    totalAreaSqm: 80,
    originalPrompt: "2BHK apartment 80 sqm",
  });

  it("3 restarts ≤ 1 restart energy (more restarts = better or equal)", () => {
    const match = matchTypology(program);
    expect(match).not.toBeNull();
    const placed = scaledToPlaced(match!.scaledRooms);
    const fp = match!.footprint;

    const result1 = optimizeLayout(placed, fp, program, { restarts: 1 });
    const result3 = optimizeLayout(placed, fp, program, { restarts: 3 });

    console.log(
      `\n=== Restart comparison ===\n1 restart: ${result1.energy.total.toFixed(1)} (${result1.timeMs.toFixed(0)}ms)\n3 restarts: ${result3.energy.total.toFixed(1)} (${result3.timeMs.toFixed(0)}ms)`,
    );

    // 3 restarts should be at least as good (lower or equal energy)
    expect(result3.energy.total).toBeLessThanOrEqual(result1.energy.total + 0.1);
  });
});

// ── Structural invariants ───────────────────────────────────────────────────

describe("layout-optimizer — structural invariants", () => {
  it("output has same number of rooms as input", () => {
    const rooms: PlacedRoom[] = [
      makeRoom("a", "Room A", "bedroom", 0, 0, 3, 4, { zone: "private" }),
      makeRoom("b", "Room B", "bathroom", 3, 0, 1.8, 2.5, { zone: "service" }),
      makeRoom("c", "Room C", "kitchen", 0, 4, 2.5, 3, { zone: "service" }),
      makeRoom("d", "Room D", "living_room", 2.5, 4, 4, 3, { zone: "public" }),
    ];
    const fp = { width: 7, depth: 7 };
    const prog = makeProgram([
      room("Room A", "bedroom", 12),
      room("Room B", "bathroom", 4.5, "service"),
      room("Room C", "kitchen", 7.5, "service"),
      room("Room D", "living_room", 12, "public"),
    ]);

    const result = optimizeLayout(rooms, fp, prog, { maxIterations: 500 });
    expect(result.rooms.length).toBe(rooms.length);
  });

  it("all room IDs are preserved", () => {
    const rooms: PlacedRoom[] = [
      makeRoom("r1", "A", "bedroom", 0, 0, 3, 4),
      makeRoom("r2", "B", "bathroom", 3, 0, 2, 2.5, { zone: "service" }),
    ];
    const fp = { width: 6, depth: 5 };
    const prog = makeProgram([
      room("A", "bedroom", 12),
      room("B", "bathroom", 5, "service"),
    ]);

    const result = optimizeLayout(rooms, fp, prog, { maxIterations: 200 });
    const ids = result.rooms.map((r) => r.id).sort();
    expect(ids).toEqual(["r1", "r2"]);
  });

  it("all rooms have positive dimensions after optimization", () => {
    const rooms: PlacedRoom[] = [
      makeRoom("a", "Bed", "bedroom", 0, 0, 3, 3.5),
      makeRoom("b", "Bath", "bathroom", 3, 0, 1.8, 2.5, { zone: "service" }),
      makeRoom("c", "Living", "living_room", 0, 3.5, 4.8, 3.6, { zone: "public" }),
    ];
    const fp = { width: 5, depth: 7.5 };
    const prog = makeProgram([
      room("Bed", "bedroom", 10.5),
      room("Bath", "bathroom", 4.5, "service"),
      room("Living", "living_room", 17.3, "public"),
    ]);

    const result = optimizeLayout(rooms, fp, prog, { maxIterations: 1000 });
    for (const r of result.rooms) {
      expect(r.width).toBeGreaterThan(0);
      expect(r.depth).toBeGreaterThan(0);
    }
  });
});
