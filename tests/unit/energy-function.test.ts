import { describe, it, expect } from "vitest";
import {
  computeEnergy,
  roomsShareWall,
  roomTouchesPerimeter,
  roomDistance,
  ENERGY_WEIGHTS,
  type PlacedRoom,
  type EnergyResult,
  type EnergyBreakdown,
} from "@/features/floor-plan/lib/energy-function";
import type { EnhancedRoomProgram } from "@/features/floor-plan/lib/ai-room-programmer";

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function makeProgram(
  adjacency: Array<{ roomA: string; roomB: string; reason: string }> = [],
  entranceRoom = "",
): EnhancedRoomProgram {
  return {
    buildingType: "apartment",
    totalAreaSqm: 70,
    numFloors: 1,
    rooms: [],
    adjacency,
    zones: { public: [], private: [], service: [], circulation: [] },
    entranceRoom,
    circulationNotes: "",
    projectName: "Test",
  };
}

function printBreakdown(label: string, result: EnergyResult): void {
  console.log(`\n=== ${label} ===`);
  console.log(`Total energy: ${result.total.toFixed(1)}`);
  const b = result.breakdown;
  const keys = Object.keys(b) as Array<keyof EnergyBreakdown>;
  for (const k of keys) {
    const val = b[k];
    const weight = ENERGY_WEIGHTS[k];
    const weighted = val * weight;
    if (val > 0.001) {
      console.log(
        `  ${k.padEnd(22)} raw: ${val.toFixed(3).padStart(8)}  × ${String(weight).padStart(5)}  = ${weighted.toFixed(1).padStart(8)}`,
      );
    }
  }
}

// ── Reference layouts ───────────────────────────────────────────────────────

/**
 * Known-good 2BHK layout: 10.2m × 8.5m footprint
 *
 *   ┌───────────┬────────┬───────────┬────────┐
 *   │ MasterBed │ MBath  │ Bedroom2  │ Bath2  │  row 0 (y=0, private)
 *   │ 3.4×3.8   │1.8×2.5 │ 3.2×3.8   │1.8×2.5 │
 *   ├───────────┴────────┴───────────┴────────┤
 *   │              Corridor 1.2m              │  row 1 (y=3.8)
 *   ├───────────┬──────────────────────┬──────┤
 *   │ Kitchen   │   Living-Dining      │Balc. │  row 2 (y=5.0, public)
 *   │ 2.5×3.5   │   5.4×3.5            │1.5×3.0│
 *   └───────────┴──────────────────────┴──────┘
 *            ENTRANCE (south = y=8.5)
 */
const FP_GOOD = { width: 10.2, depth: 8.5 };

const GOOD_LAYOUT: PlacedRoom[] = [
  // Row 0: private (top/north, y=0)
  makeRoom("bed1", "Master Bedroom", "master_bedroom", 0, 0, 3.4, 3.8, {
    zone: "private", targetArea: 3.4 * 3.8, mustHaveExteriorWall: true,
  }),
  makeRoom("bath1", "Master Bathroom", "master_bathroom", 3.4, 0, 1.8, 2.5, {
    zone: "service", targetArea: 1.8 * 2.5,
  }),
  makeRoom("bed2", "Bedroom 2", "bedroom", 5.2, 0, 3.2, 3.8, {
    zone: "private", targetArea: 3.2 * 3.8, mustHaveExteriorWall: true,
  }),
  makeRoom("bath2", "Common Bathroom", "bathroom", 8.4, 0, 1.8, 2.5, {
    zone: "service", targetArea: 1.8 * 2.5,
  }),
  // Row 1: corridor (y=3.8)
  makeRoom("corr", "Corridor", "corridor", 0, 3.8, 10.2, 1.2, {
    zone: "circulation", targetArea: 10.2 * 1.2,
  }),
  // Row 2: public (bottom/south, y=5.0) — balcony extends to right edge (10.2m)
  makeRoom("kit", "Kitchen", "kitchen", 0, 5.0, 2.5, 3.5, {
    zone: "service", targetArea: 2.5 * 3.5, mustHaveExteriorWall: true,
  }),
  makeRoom("liv", "Living Room", "living_room", 2.5, 5.0, 5.4, 3.5, {
    zone: "public", targetArea: 5.4 * 3.5, mustHaveExteriorWall: true,
  }),
  makeRoom("balc", "Balcony", "balcony", 7.9, 5.0, 2.3, 3.5, {
    zone: "outdoor", targetArea: 2.3 * 3.5,
  }),
];

const GOOD_PROGRAM = makeProgram(
  [
    { roomA: "Master Bedroom", roomB: "Master Bathroom", reason: "attached" },
    { roomA: "Kitchen", roomB: "Living Room", reason: "kitchen-dining flow" },
  ],
  "Living Room",
);

// ── Tests ───────────────────────────────────────────────────────────────────

describe("energy-function — helper functions", () => {
  it("roomsShareWall returns true for adjacent rooms", () => {
    const a = makeRoom("a", "A", "bedroom", 0, 0, 3.0, 4.0);
    const b = makeRoom("b", "B", "bathroom", 3.0, 0, 1.8, 2.5);
    expect(roomsShareWall(a, b)).toBe(true);
  });

  it("roomsShareWall returns true for rooms with small gap", () => {
    const a = makeRoom("a", "A", "bedroom", 0, 0, 3.0, 4.0);
    const b = makeRoom("b", "B", "bathroom", 3.2, 0, 1.8, 2.5);
    expect(roomsShareWall(a, b, 0.3)).toBe(true);
  });

  it("roomsShareWall returns false for separated rooms", () => {
    const a = makeRoom("a", "A", "bedroom", 0, 0, 3.0, 4.0);
    const b = makeRoom("b", "B", "bathroom", 5.0, 0, 1.8, 2.5);
    expect(roomsShareWall(a, b)).toBe(false);
  });

  it("roomsShareWall returns false for insufficient contact length", () => {
    const a = makeRoom("a", "A", "bedroom", 0, 0, 3.0, 4.0);
    const b = makeRoom("b", "B", "bathroom", 3.0, 3.7, 1.8, 2.5); // only 0.3m vertical overlap
    expect(roomsShareWall(a, b, 0.3, 0.5)).toBe(false);
  });

  it("roomTouchesPerimeter detects left edge", () => {
    const r = makeRoom("r", "R", "bedroom", 0, 2, 3, 4);
    expect(roomTouchesPerimeter(r, { width: 10, depth: 10 })).toBe(true);
  });

  it("roomTouchesPerimeter detects right edge", () => {
    const r = makeRoom("r", "R", "bedroom", 7, 2, 3, 4);
    expect(roomTouchesPerimeter(r, { width: 10, depth: 10 })).toBe(true);
  });

  it("roomTouchesPerimeter returns false for interior room", () => {
    const r = makeRoom("r", "R", "bedroom", 3, 3, 2, 2);
    expect(roomTouchesPerimeter(r, { width: 10, depth: 10 })).toBe(false);
  });

  it("roomDistance returns 0 for touching rooms", () => {
    const a = makeRoom("a", "A", "bedroom", 0, 0, 3, 4);
    const b = makeRoom("b", "B", "bedroom", 3, 0, 3, 4);
    expect(roomDistance(a, b)).toBeCloseTo(0, 1);
  });

  it("roomDistance returns correct value for separated rooms", () => {
    const a = makeRoom("a", "A", "bedroom", 0, 0, 3, 3);
    const b = makeRoom("b", "B", "bedroom", 6, 0, 3, 3); // 3m horizontal gap
    expect(roomDistance(a, b)).toBeCloseTo(3.0, 1);
  });

  it("roomDistance returns diagonal distance for corner-separated rooms", () => {
    const a = makeRoom("a", "A", "bedroom", 0, 0, 3, 3);
    const b = makeRoom("b", "B", "bedroom", 6, 4, 3, 3); // 3m right, 1m down
    expect(roomDistance(a, b)).toBeCloseTo(Math.sqrt(9 + 1), 1);
  });
});

describe("energy-function — Test 1: known-good 2BHK layout", () => {
  let result: EnergyResult;

  it("computes energy < 150 for a well-designed layout", () => {
    // Soft constraints (preferredAdjacency, plumbingScatter) are always non-zero
    // in a real layout. A good layout scores ~80-130.
    result = computeEnergy(GOOD_LAYOUT, FP_GOOD, GOOD_PROGRAM);
    printBreakdown("Good 2BHK layout", result);
    expect(result.total).toBeLessThan(150);
  });

  it("has zero overlap", () => {
    expect(result.breakdown.overlap).toBe(0);
  });

  it("has zero boundary violation", () => {
    expect(result.breakdown.boundary).toBeCloseTo(0, 1);
  });

  it("has zero min-dimension violation", () => {
    expect(result.breakdown.minDimension).toBeCloseTo(0, 1);
  });
});

describe("energy-function — Test 2: bedroom-kitchen swap (zone violation)", () => {
  // Swap bed1 and kitchen positions
  const swappedLayout = GOOD_LAYOUT.map((r) => {
    if (r.id === "bed1") return { ...r, x: 0, y: 5.0, width: 2.5, depth: 3.5, zone: "private" as const };
    if (r.id === "kit") return { ...r, x: 0, y: 0, width: 3.4, depth: 3.8, zone: "service" as const };
    return r;
  });

  it("has energy > 80 (zone + adjacency violations)", () => {
    const result = computeEnergy(swappedLayout, FP_GOOD, GOOD_PROGRAM);
    printBreakdown("Bed-kitchen swap", result);
    expect(result.total).toBeGreaterThan(80);
  });

  it("has zone violation > 0", () => {
    const result = computeEnergy(swappedLayout, FP_GOOD, GOOD_PROGRAM);
    expect(result.breakdown.zoneViolation).toBeGreaterThan(0);
  });
});

describe("energy-function — Test 3: bedroom overlap (1m overlap)", () => {
  const overlappingLayout = GOOD_LAYOUT.map((r) => {
    if (r.id === "bed2") return { ...r, x: 2.4 }; // 1m overlap with bed1 (3.4-2.4=1.0)
    return r;
  });

  it("has energy > 1000 (overlap dominates)", () => {
    const result = computeEnergy(overlappingLayout, FP_GOOD, GOOD_PROGRAM);
    printBreakdown("Bedroom overlap 1m", result);
    expect(result.total).toBeGreaterThan(1000);
  });

  it("overlap term > 0", () => {
    const result = computeEnergy(overlappingLayout, FP_GOOD, GOOD_PROGRAM);
    expect(result.breakdown.overlap).toBeGreaterThan(0);
  });
});

describe("energy-function — Test 4: room outside footprint", () => {
  const oobLayout = GOOD_LAYOUT.map((r) => {
    if (r.id === "bed1") return { ...r, x: -2 }; // 2m outside left edge
    return r;
  });

  it("has energy > 500 (boundary violation)", () => {
    const result = computeEnergy(oobLayout, FP_GOOD, GOOD_PROGRAM);
    printBreakdown("Room outside footprint", result);
    expect(result.total).toBeGreaterThan(500);
  });

  it("boundary term > 0", () => {
    const result = computeEnergy(oobLayout, FP_GOOD, GOOD_PROGRAM);
    expect(result.breakdown.boundary).toBeGreaterThan(0);
  });
});

describe("energy-function — Test 5: room with bad aspect ratio 3:1", () => {
  const badAR = [
    makeRoom("bed1", "Master Bedroom", "master_bedroom", 0, 0, 2.0, 6.0, {
      zone: "private", targetArea: 12, mustHaveExteriorWall: true,
    }),
    makeRoom("bath1", "Bathroom", "bathroom", 2.0, 0, 1.8, 2.5, {
      zone: "service", targetArea: 4,
    }),
  ];
  const fp = { width: 4.0, depth: 6.0 };

  it("aspect ratio term > 0 for 3:1 bedroom (max 1.8)", () => {
    const result = computeEnergy(badAR, fp, makeProgram());
    printBreakdown("Bad AR 3:1 bedroom", result);
    expect(result.breakdown.aspectRatio).toBeGreaterThan(0);
    // 6/2 = 3.0, max 1.8, excess = 1.2
    expect(result.breakdown.aspectRatio).toBeCloseTo(1.2, 0);
  });
});

describe("energy-function — Test 6: bathroom not adjacent to bedroom", () => {
  const detachedLayout = [
    makeRoom("bed1", "Master Bedroom", "master_bedroom", 0, 0, 3.4, 3.8, {
      zone: "private", targetArea: 14,
    }),
    makeRoom("bath1", "Master Bathroom", "master_bathroom", 8.0, 5.0, 1.8, 2.5, {
      zone: "service", targetArea: 4.5,
    }),
  ];
  const fp = { width: 10, depth: 8 };
  const prog = makeProgram([
    { roomA: "Master Bedroom", roomB: "Master Bathroom", reason: "attached" },
  ]);

  it("required adjacency term > 0", () => {
    const result = computeEnergy(detachedLayout, fp, prog);
    printBreakdown("Detached bathroom", result);
    expect(result.breakdown.adjacencyRequired).toBeGreaterThan(0);
  });
});

describe("energy-function — Test 7: wet rooms scattered", () => {
  const scatteredWet = [
    makeRoom("kit", "Kitchen", "kitchen", 0, 0, 2.5, 3.5, {
      zone: "service", targetArea: 8,
    }),
    makeRoom("bath1", "Bathroom", "bathroom", 8, 6, 1.8, 2.5, {
      zone: "service", targetArea: 4,
    }),
    makeRoom("bath2", "Toilet", "toilet", 4, 3, 1.2, 1.5, {
      zone: "service", targetArea: 2,
    }),
  ];
  const fp = { width: 10, depth: 9 };

  it("plumbing scatter term > 0", () => {
    const result = computeEnergy(scatteredWet, fp, makeProgram());
    printBreakdown("Wet rooms scattered", result);
    expect(result.breakdown.plumbingScatter).toBeGreaterThan(0);
  });
});

describe("energy-function — Test 8: wet rooms clustered", () => {
  const clusteredWet = [
    makeRoom("kit", "Kitchen", "kitchen", 0, 0, 2.5, 3.5, {
      zone: "service", targetArea: 8,
    }),
    makeRoom("bath1", "Bathroom", "bathroom", 2.5, 0, 1.8, 2.5, {
      zone: "service", targetArea: 4,
    }),
    makeRoom("bath2", "Toilet", "toilet", 2.5, 2.5, 1.2, 1.5, {
      zone: "service", targetArea: 2,
    }),
  ];
  const fp = { width: 5, depth: 4 };

  it("plumbing scatter term is small (< 1.0)", () => {
    // Even clustered rooms have non-zero scatter since their centers differ
    const result = computeEnergy(clusteredWet, fp, makeProgram());
    printBreakdown("Wet rooms clustered", result);
    expect(result.breakdown.plumbingScatter).toBeLessThan(1.0);
  });
});

describe("energy-function — Test 9: corridor too narrow (0.8m)", () => {
  const narrowCorridor = [
    makeRoom("corr", "Corridor", "corridor", 0, 3, 8, 0.8, {
      zone: "circulation", targetArea: 6,
    }),
  ];
  const fp = { width: 8, depth: 8 };

  it("corridor width term > 0", () => {
    const result = computeEnergy(narrowCorridor, fp, makeProgram());
    printBreakdown("Narrow corridor 0.8m", result);
    expect(result.breakdown.corridorWidth).toBeGreaterThan(0);
    // shortDim=0.8 < 1.0 → penalty = (1.0-0.8)*5 = 1.0
    expect(result.breakdown.corridorWidth).toBeCloseTo(1.0, 1);
  });
});

describe("energy-function — Test 10: perfect vs terrible layout", () => {
  // Perfect: our known-good layout
  const perfectResult = computeEnergy(GOOD_LAYOUT, FP_GOOD, GOOD_PROGRAM);

  // Terrible: everything wrong — overlapping, out of bounds, wrong zones
  const terribleLayout: PlacedRoom[] = [
    // Two bedrooms overlapping in the public zone
    makeRoom("bed1", "Master Bedroom", "master_bedroom", 0, 6, 3.4, 3.8, {
      zone: "private", targetArea: 14, mustHaveExteriorWall: true,
    }),
    makeRoom("bed2", "Bedroom 2", "bedroom", 1.0, 6, 3.2, 3.8, {
      zone: "private", targetArea: 12, mustHaveExteriorWall: true,
    }),
    // Bathroom far from bedroom, out of bounds
    makeRoom("bath1", "Master Bathroom", "master_bathroom", 9, 0, 1.8, 2.5, {
      zone: "service", targetArea: 4.5,
    }),
    makeRoom("bath2", "Common Bathroom", "bathroom", -1, 3, 1.8, 2.5, {
      zone: "service", targetArea: 3.5,
    }),
    // Kitchen in private zone (back)
    makeRoom("kit", "Kitchen", "kitchen", 5, 0, 2.5, 3.5, {
      zone: "service", targetArea: 8, mustHaveExteriorWall: true,
    }),
    // Living room in the back
    makeRoom("liv", "Living Room", "living_room", 0, 0, 5.0, 3.0, {
      zone: "public", targetArea: 18, mustHaveExteriorWall: true,
    }),
    // Corridor way too narrow
    makeRoom("corr", "Corridor", "corridor", 0, 4, 10.2, 0.5, {
      zone: "circulation", targetArea: 12,
    }),
  ];

  it("perfect energy < 150", () => {
    // Soft constraints keep this above zero; a well-designed layout scores ~80-130
    printBreakdown("PERFECT layout", perfectResult);
    expect(perfectResult.total).toBeLessThan(150);
  });

  it("terrible energy > 500", () => {
    const terribleResult = computeEnergy(terribleLayout, FP_GOOD, GOOD_PROGRAM);
    printBreakdown("TERRIBLE layout", terribleResult);
    expect(terribleResult.total).toBeGreaterThan(500);
  });

  it("perfect.total < terrible.total (monotonicity)", () => {
    const terribleResult = computeEnergy(terribleLayout, FP_GOOD, GOOD_PROGRAM);
    expect(perfectResult.total).toBeLessThan(terribleResult.total);
  });
});

describe("energy-function — exterior wall penalty", () => {
  it("penalizes interior room that needs exterior wall", () => {
    const rooms = [
      makeRoom("bed1", "Master Bedroom", "master_bedroom", 3, 3, 3, 3, {
        zone: "private", targetArea: 9, mustHaveExteriorWall: true,
      }),
    ];
    const fp = { width: 10, depth: 10 };
    const result = computeEnergy(rooms, fp, makeProgram());
    expect(result.breakdown.exteriorWall).toBeGreaterThan(0);
  });

  it("no penalty for perimeter room", () => {
    const rooms = [
      makeRoom("bed1", "Master Bedroom", "master_bedroom", 0, 0, 3, 3, {
        zone: "private", targetArea: 9, mustHaveExteriorWall: true,
      }),
    ];
    const fp = { width: 10, depth: 10 };
    const result = computeEnergy(rooms, fp, makeProgram());
    expect(result.breakdown.exteriorWall).toBe(0);
  });
});

describe("energy-function — dead space penalty", () => {
  it("no penalty when rooms fill 85%+ of footprint", () => {
    const rooms = [
      makeRoom("a", "Room", "living_room", 0, 0, 10, 9, {
        zone: "public", targetArea: 90,
      }),
    ];
    const fp = { width: 10, depth: 10 }; // 90/100 = 90% > 85%
    const result = computeEnergy(rooms, fp, makeProgram());
    expect(result.breakdown.deadSpace).toBe(0);
  });

  it("penalizes when rooms fill < 85% of footprint", () => {
    const rooms = [
      makeRoom("a", "Room", "living_room", 0, 0, 5, 5, {
        zone: "public", targetArea: 25,
      }),
    ];
    const fp = { width: 10, depth: 10 }; // 25/100 = 25%, dead ratio = 75%
    const result = computeEnergy(rooms, fp, makeProgram());
    expect(result.breakdown.deadSpace).toBeGreaterThan(0);
  });
});

describe("energy-function — entrance flow", () => {
  it("penalizes when living room is not adjacent to entrance and in back", () => {
    const rooms = [
      makeRoom("foyer", "Foyer", "foyer", 4, 7, 2, 2, {
        zone: "public", targetArea: 4,
      }),
      makeRoom("liv", "Living Room", "living_room", 0, 0, 4, 3, {
        zone: "public", targetArea: 12,
      }),
    ];
    const fp = { width: 8, depth: 9 };
    const prog = makeProgram([], "Foyer");
    const result = computeEnergy(rooms, fp, prog);
    expect(result.breakdown.entranceFlow).toBeGreaterThan(0);
  });
});

describe("energy-function — area error", () => {
  it("penalizes when room area differs from target", () => {
    const rooms = [
      makeRoom("bed1", "Bedroom", "bedroom", 0, 0, 4, 4, {
        zone: "private", targetArea: 12, // actual 16, 33% over
      }),
    ];
    const fp = { width: 5, depth: 5 };
    const result = computeEnergy(rooms, fp, makeProgram());
    // error = |16-12|/12 = 0.333
    expect(result.breakdown.areaError).toBeCloseTo(0.333, 1);
  });

  it("no area penalty when actual matches target", () => {
    const rooms = [
      makeRoom("bed1", "Bedroom", "bedroom", 0, 0, 3, 4, {
        zone: "private", targetArea: 12, // actual = 12
      }),
    ];
    const fp = { width: 5, depth: 5 };
    const result = computeEnergy(rooms, fp, makeProgram());
    expect(result.breakdown.areaError).toBeCloseTo(0, 2);
  });
});

describe("energy-function — performance", () => {
  it("computes 5000 iterations in < 500ms for 12-room layout", () => {
    const start = performance.now();
    for (let i = 0; i < 5000; i++) {
      computeEnergy(GOOD_LAYOUT, FP_GOOD, GOOD_PROGRAM);
    }
    const elapsed = performance.now() - start;
    console.log(`\n=== PERF: 5000 calls = ${elapsed.toFixed(1)}ms (${(elapsed / 5000).toFixed(3)}ms/call) ===`);
    expect(elapsed).toBeLessThan(500);
  });
});
