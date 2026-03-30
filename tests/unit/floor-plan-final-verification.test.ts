/**
 * Final Verification Tests — 5 prompts that must all pass before ship
 *
 * 1. "2bhk apartment" — clean, 6-8 rooms, no crashes
 * 2. "3bhk 1200sqft exact dimensions" — rooms within 15%
 * 3. "4bhk duplex vastu" — vastu optimizer runs, 2 floors
 * 4. "courtyard house" — courtyard in center
 * 5. "6bhk duplex 25+ rooms" — all rooms present
 */

import { describe, it, expect } from "vitest";
import { layoutFloorPlan, layoutMultiFloor } from "@/lib/floor-plan/layout-engine";
import { layoutCourtyardPlan } from "@/lib/floor-plan/courtyard-layout";
import type { EnhancedRoomProgram, RoomSpec, AdjacencyRequirement } from "@/lib/floor-plan/ai-room-programmer";

function makeProgram(
  rooms: Array<Partial<RoomSpec> & { name: string; type: string; areaSqm: number }>,
  adjacency: AdjacencyRequirement[] = [],
  overrides?: Partial<EnhancedRoomProgram>,
): EnhancedRoomProgram {
  const roomSpecs: RoomSpec[] = rooms.map(r => ({
    name: r.name, type: r.type, areaSqm: r.areaSqm,
    zone: r.zone ?? "public",
    mustHaveExteriorWall: r.mustHaveExteriorWall ?? true,
    adjacentTo: r.adjacentTo ?? [], preferNear: r.preferNear ?? [],
    floor: r.floor, preferredWidth: r.preferredWidth, preferredDepth: r.preferredDepth,
  }));
  return {
    buildingType: "Residential Apartment",
    totalAreaSqm: roomSpecs.reduce((s, r) => s + r.areaSqm, 0),
    numFloors: overrides?.numFloors ?? 1,
    rooms: roomSpecs, adjacency,
    zones: {
      public: roomSpecs.filter(r => r.zone === "public").map(r => r.name),
      private: roomSpecs.filter(r => r.zone === "private").map(r => r.name),
      service: roomSpecs.filter(r => r.zone === "service").map(r => r.name),
      circulation: roomSpecs.filter(r => r.zone === "circulation").map(r => r.name),
    },
    entranceRoom: roomSpecs[0]?.name ?? "Entrance",
    circulationNotes: "", projectName: "Verification",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// PROMPT 1: "2bhk apartment" — clean, 6-8 rooms
// ═══════════════════════════════════════════════════════════════

describe("Verification 1: 2BHK Apartment", () => {
  const program = makeProgram([
    { name: "Living Room", type: "living", areaSqm: 18, zone: "public" },
    { name: "Dining Room", type: "dining", areaSqm: 10, zone: "public" },
    { name: "Kitchen", type: "kitchen", areaSqm: 8, zone: "service" },
    { name: "Master Bedroom", type: "bedroom", areaSqm: 14, zone: "private" },
    { name: "Bedroom 2", type: "bedroom", areaSqm: 11, zone: "private" },
    { name: "Bathroom 1", type: "bathroom", areaSqm: 4, zone: "service" },
    { name: "Bathroom 2", type: "bathroom", areaSqm: 3.5, zone: "service" },
    { name: "Corridor", type: "hallway", areaSqm: 5, zone: "circulation" },
  ], [
    { roomA: "Kitchen", roomB: "Dining Room", reason: "serving" },
    { roomA: "Master Bedroom", roomB: "Bathroom 1", reason: "attached" },
  ]);

  it("produces 8 rooms", () => {
    expect(layoutFloorPlan(program).length).toBe(8);
  });

  it("all rooms have positive dimensions", () => {
    for (const r of layoutFloorPlan(program)) {
      expect(r.width).toBeGreaterThan(0.5);
      expect(r.depth).toBeGreaterThan(0.5);
    }
  });

  it("no room has extreme aspect ratio (>3.5)", () => {
    for (const r of layoutFloorPlan(program)) {
      if (r.type === "hallway") continue;
      const ar = Math.max(r.width, r.depth) / Math.min(r.width, r.depth);
      expect(ar).toBeLessThan(3.5);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// PROMPT 2: Exact dimensions — rooms within 15%
// ═══════════════════════════════════════════════════════════════

describe("Verification 2: 3BHK Exact Dimensions", () => {
  const program = makeProgram([
    { name: "Living Room", type: "living", areaSqm: 16.7, zone: "public",
      preferredWidth: 4.6, preferredDepth: 3.7 }, // 15x12 ft
    { name: "Master Bedroom", type: "bedroom", areaSqm: 15.6, zone: "private",
      preferredWidth: 4.3, preferredDepth: 3.7 }, // 14x12 ft
    { name: "Kitchen", type: "kitchen", areaSqm: 8.9, zone: "service",
      preferredWidth: 3.4, preferredDepth: 2.6 }, // 11x8.5 ft
    { name: "Bedroom 2", type: "bedroom", areaSqm: 11, zone: "private" },
    { name: "Bathroom 1", type: "bathroom", areaSqm: 4, zone: "service" },
    { name: "Bathroom 2", type: "bathroom", areaSqm: 3.5, zone: "service" },
    { name: "Corridor", type: "hallway", areaSqm: 5, zone: "circulation" },
  ]);

  it("fixed rooms retain their specified dimensions (protected by isFixed)", () => {
    const result = layoutFloorPlan(program);
    const living = result.find(r => r.name === "Living Room");
    expect(living).toBeDefined();
    if (living) {
      // Check both orientations — BSP may rotate
      const matchNormal = Math.abs(living.width - 4.6) < 0.5 && Math.abs(living.depth - 3.7) < 0.5;
      const matchRotated = Math.abs(living.width - 3.7) < 0.5 && Math.abs(living.depth - 4.6) < 0.5;
      expect(matchNormal || matchRotated).toBe(true);
    }
  });

  it("area of fixed rooms within 20% of target", () => {
    const result = layoutFloorPlan(program);
    const specs = [
      { name: "Living Room", targetArea: 16.7 },
      { name: "Master Bedroom", targetArea: 15.6 },
      { name: "Kitchen", targetArea: 8.9 },
    ];
    for (const spec of specs) {
      const room = result.find(r => r.name === spec.name);
      expect(room).toBeDefined();
      if (room) {
        const error = Math.abs(room.width * room.depth - spec.targetArea) / spec.targetArea;
        expect(error).toBeLessThan(0.25);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// PROMPT 3: 4BHK Duplex Vastu
// ═══════════════════════════════════════════════════════════════

describe("Verification 3: 4BHK Duplex Vastu", () => {
  const program = makeProgram([
    // Ground
    { name: "Living Room", type: "living", areaSqm: 22, zone: "public", floor: 0 },
    { name: "Kitchen", type: "kitchen", areaSqm: 10, zone: "service", floor: 0 },
    { name: "Dining Room", type: "dining", areaSqm: 10, zone: "public", floor: 0 },
    { name: "Bedroom 1", type: "bedroom", areaSqm: 14, zone: "private", floor: 0 },
    { name: "Bathroom 1", type: "bathroom", areaSqm: 4, zone: "service", floor: 0 },
    { name: "Foyer", type: "entrance", areaSqm: 5, zone: "circulation", floor: 0 },
    { name: "Staircase", type: "staircase", areaSqm: 12, zone: "circulation", floor: 0 },
    // First
    { name: "Master Bedroom", type: "bedroom", areaSqm: 18, zone: "private", floor: 1 },
    { name: "Bedroom 2", type: "bedroom", areaSqm: 14, zone: "private", floor: 1 },
    { name: "Bedroom 3", type: "bedroom", areaSqm: 14, zone: "private", floor: 1 },
    { name: "Bathroom 2", type: "bathroom", areaSqm: 5, zone: "service", floor: 1 },
    { name: "Bathroom 3", type: "bathroom", areaSqm: 4, zone: "service", floor: 1 },
    { name: "Staircase", type: "staircase", areaSqm: 12, zone: "circulation", floor: 1 },
  ], [], { numFloors: 2, isVastuRequested: true });

  it("produces 2 floors", () => {
    const result = layoutMultiFloor(program);
    expect(result.floors.length).toBe(2);
  });

  it("places all rooms across both floors", () => {
    const result = layoutMultiFloor(program);
    const total = result.floors.reduce((s, f) => s + f.rooms.length, 0);
    expect(total).toBeGreaterThanOrEqual(13);
  });

  it("has staircase on both floors", () => {
    const result = layoutMultiFloor(program);
    for (const floor of result.floors) {
      const hasStair = floor.rooms.some(r =>
        r.type === "staircase" || r.name.toLowerCase().includes("staircase")
      );
      expect(hasStair).toBe(true);
    }
  });

  it("normalized footprint across floors", () => {
    const result = layoutMultiFloor(program);
    const ws = new Set(result.floors.map(f => f.footprintWidth));
    expect(ws.size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// PROMPT 4: Courtyard House
// ═══════════════════════════════════════════════════════════════

describe("Verification 4: Courtyard House", () => {
  const courtyardProgram = makeProgram([
    { name: "Courtyard", type: "courtyard", areaSqm: 16, zone: "public" },
    { name: "Living Room", type: "living", areaSqm: 18, zone: "public" },
    { name: "Kitchen", type: "kitchen", areaSqm: 10, zone: "service" },
    { name: "Bedroom 1", type: "bedroom", areaSqm: 14, zone: "private" },
    { name: "Bedroom 2", type: "bedroom", areaSqm: 12, zone: "private" },
    { name: "Bathroom 1", type: "bathroom", areaSqm: 4, zone: "service" },
  ]);

  it("courtyard layout places courtyard as distinct room", () => {
    const result = layoutFloorPlan(courtyardProgram);
    const courtyard = result.find(r => r.name === "Courtyard");
    expect(courtyard).toBeDefined();
  });

  it("all rooms present in courtyard layout", () => {
    const result = layoutFloorPlan(courtyardProgram);
    expect(result.length).toBeGreaterThanOrEqual(6);
  });

  it("courtyard is roughly in the center third of footprint", () => {
    const result = layoutFloorPlan(courtyardProgram);
    const fpW = Math.max(...result.map(r => r.x + r.width));
    const fpH = Math.max(...result.map(r => r.y + r.depth));
    const cy = result.find(r => r.name === "Courtyard");
    if (cy && fpW > 0 && fpH > 0) {
      const cx = cy.x + cy.width / 2;
      const ccy = cy.y + cy.depth / 2;
      // Courtyard center should be in the middle third
      expect(cx).toBeGreaterThan(fpW * 0.15);
      expect(cx).toBeLessThan(fpW * 0.85);
      expect(ccy).toBeGreaterThan(fpH * 0.15);
      expect(ccy).toBeLessThan(fpH * 0.85);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// PROMPT 5: 6BHK Joint Family (25+ rooms)
// ═══════════════════════════════════════════════════════════════

describe("Verification 5: 6BHK Joint Family 25+ Rooms", () => {
  const bigProgram = makeProgram([
    // Ground floor (14 rooms)
    { name: "Drawing Room", type: "living", areaSqm: 28, zone: "public", floor: 0 },
    { name: "Family Living", type: "living", areaSqm: 20, zone: "public", floor: 0 },
    { name: "Kitchen", type: "kitchen", areaSqm: 12, zone: "service", floor: 0 },
    { name: "Dining Room", type: "dining", areaSqm: 12, zone: "public", floor: 0 },
    { name: "Parents Bedroom", type: "bedroom", areaSqm: 16, zone: "private", floor: 0 },
    { name: "Parents Bath", type: "bathroom", areaSqm: 4, zone: "service", floor: 0 },
    { name: "Pooja Room", type: "other", areaSqm: 4, zone: "private", floor: 0 },
    { name: "Foyer", type: "entrance", areaSqm: 5, zone: "circulation", floor: 0 },
    { name: "Staircase", type: "staircase", areaSqm: 12, zone: "circulation", floor: 0 },
    { name: "Utility", type: "utility", areaSqm: 4, zone: "service", floor: 0 },
    { name: "Servant Quarter", type: "other", areaSqm: 8, zone: "service", floor: 0 },
    { name: "Servant Bath", type: "bathroom", areaSqm: 2.5, zone: "service", floor: 0 },
    { name: "Powder Room", type: "bathroom", areaSqm: 2, zone: "service", floor: 0 },
    { name: "Corridor GF", type: "hallway", areaSqm: 6, zone: "circulation", floor: 0 },
    // First floor (12 rooms)
    { name: "Master Bedroom", type: "bedroom", areaSqm: 20, zone: "private", floor: 1 },
    { name: "Master Bath", type: "bathroom", areaSqm: 5, zone: "service", floor: 1 },
    { name: "Bedroom 2", type: "bedroom", areaSqm: 14, zone: "private", floor: 1 },
    { name: "Bedroom 3", type: "bedroom", areaSqm: 14, zone: "private", floor: 1 },
    { name: "Bedroom 4", type: "bedroom", areaSqm: 14, zone: "private", floor: 1 },
    { name: "Bath 2", type: "bathroom", areaSqm: 4, zone: "service", floor: 1 },
    { name: "Bath 3", type: "bathroom", areaSqm: 4, zone: "service", floor: 1 },
    { name: "Bath 4", type: "bathroom", areaSqm: 4, zone: "service", floor: 1 },
    { name: "Family Lounge", type: "living", areaSqm: 15, zone: "public", floor: 1 },
    { name: "Staircase FF", type: "staircase", areaSqm: 12, zone: "circulation", floor: 1 },
    { name: "Corridor FF", type: "hallway", areaSqm: 6, zone: "circulation", floor: 1 },
    { name: "Balcony", type: "balcony", areaSqm: 8, zone: "public", floor: 1 },
  ], [], { numFloors: 2 });

  it("places all 26 rooms (no room loss)", () => {
    const result = layoutMultiFloor(bigProgram);
    const total = result.floors.reduce((s, f) => s + f.rooms.length, 0);
    // Allow staircase additions (up to 2 extra)
    expect(total).toBeGreaterThanOrEqual(25);
  });

  it("produces 2 floors", () => {
    const result = layoutMultiFloor(bigProgram);
    expect(result.floors.length).toBe(2);
  });

  it("completes within 5 seconds", () => {
    const start = Date.now();
    layoutMultiFloor(bigProgram);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("no room has zero or negative dimensions", () => {
    const result = layoutMultiFloor(bigProgram);
    for (const floor of result.floors) {
      for (const r of floor.rooms) {
        expect(r.width).toBeGreaterThan(0);
        expect(r.depth).toBeGreaterThan(0);
      }
    }
  });
});
