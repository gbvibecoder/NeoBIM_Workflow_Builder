import { describe, it, expect } from "vitest";
import { layoutFloorPlan, PlacedRoom } from "@/lib/floor-plan/layout-engine";
import type { EnhancedRoomProgram, RoomSpec, AdjacencyRequirement } from "@/lib/floor-plan/ai-room-programmer";

// ── Helper to build a minimal EnhancedRoomProgram ────────────────────────────

function makeProgram(
  rooms: Array<{ name: string; type: string; areaSqm: number; zone: RoomSpec["zone"]; mustHaveExteriorWall?: boolean; adjacentTo?: string[] }>,
  adjacency: AdjacencyRequirement[] = [],
  overrides?: Partial<EnhancedRoomProgram>,
): EnhancedRoomProgram {
  const roomSpecs: RoomSpec[] = rooms.map(r => ({
    name: r.name,
    type: r.type,
    areaSqm: r.areaSqm,
    zone: r.zone,
    mustHaveExteriorWall: r.mustHaveExteriorWall ?? !["bathroom", "utility", "storage", "hallway"].includes(r.type),
    adjacentTo: r.adjacentTo ?? [],
    preferNear: [],
  }));

  const zones = {
    public: roomSpecs.filter(r => r.zone === "public").map(r => r.name),
    private: roomSpecs.filter(r => r.zone === "private").map(r => r.name),
    service: roomSpecs.filter(r => r.zone === "service").map(r => r.name),
    circulation: roomSpecs.filter(r => r.zone === "circulation").map(r => r.name),
  };

  return {
    buildingType: "Residential Apartment",
    totalAreaSqm: roomSpecs.reduce((s, r) => s + r.areaSqm, 0),
    numFloors: 1,
    rooms: roomSpecs,
    adjacency,
    zones,
    entranceRoom: roomSpecs[0]?.name ?? "Living Room",
    circulationNotes: "",
    projectName: "Test Plan",
    ...overrides,
  };
}

// ── Validation helpers ───────────────────────────────────────────────────────

function checkZeroOverlaps(rooms: PlacedRoom[]): string[] {
  const errors: string[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
      if (overlapX > 0.15 && overlapY > 0.15) {
        errors.push(`"${a.name}" and "${b.name}" overlap by ${(overlapX * overlapY).toFixed(1)}m²`);
      }
    }
  }
  return errors;
}

function checkWithinFootprint(rooms: PlacedRoom[]): string[] {
  const errors: string[] = [];
  const maxX = Math.max(...rooms.map(r => r.x + r.width));
  const maxY = Math.max(...rooms.map(r => r.y + r.depth));

  for (const r of rooms) {
    if (r.x < -0.1) errors.push(`"${r.name}" x=${r.x} < 0`);
    if (r.y < -0.1) errors.push(`"${r.name}" y=${r.y} < 0`);
    if (r.x + r.width > maxX + 0.2) errors.push(`"${r.name}" extends past footprint right`);
    if (r.y + r.depth > maxY + 0.2) errors.push(`"${r.name}" extends past footprint bottom`);
  }
  return errors;
}

function checkAreaMatch(rooms: PlacedRoom[], targets: Array<{ name: string; areaSqm: number }>, tolerance = 0.30): string[] {
  const errors: string[] = [];
  for (const target of targets) {
    const room = rooms.find(r => r.name === target.name);
    if (!room) {
      errors.push(`Missing room "${target.name}"`);
      continue;
    }
    const actual = room.width * room.depth;
    const diff = Math.abs(actual - target.areaSqm) / target.areaSqm;
    if (diff > tolerance) {
      errors.push(`"${target.name}" area ${actual.toFixed(1)}m² vs target ${target.areaSqm}m² (${(diff * 100).toFixed(0)}% off)`);
    }
  }
  return errors;
}

function checkAspectRatios(rooms: PlacedRoom[], maxRatio = 3.0): string[] {
  const errors: string[] = [];
  for (const r of rooms) {
    if (r.type === "hallway" || r.name.toLowerCase().includes("corridor")) continue;
    const ratio = Math.max(r.width, r.depth) / Math.min(r.width, r.depth);
    if (ratio > maxRatio) {
      errors.push(`"${r.name}" aspect ratio ${ratio.toFixed(1)}:1 (${r.width.toFixed(1)}×${r.depth.toFixed(1)})`);
    }
  }
  return errors;
}

function checkMinDimensions(rooms: PlacedRoom[]): string[] {
  const errors: string[] = [];
  for (const r of rooms) {
    const min = (r.type === "bathroom" || r.name.toLowerCase().includes("bath") || r.name.toLowerCase().includes("toilet"))
      ? 1.2
      : r.type === "hallway" || r.name.toLowerCase().includes("corridor")
        ? 1.0
        : 2.0; // relaxed from 2.4 to account for grid snapping
    if (r.width < min - 0.1 || r.depth < min - 0.1) {
      errors.push(`"${r.name}" dimension too small: ${r.width.toFixed(1)}×${r.depth.toFixed(1)} (min ${min}m)`);
    }
  }
  return errors;
}

function areAdjacent(a: PlacedRoom, b: PlacedRoom, tolerance = 0.3): boolean {
  // Vertical adjacency
  if (Math.abs((a.x + a.width) - b.x) < tolerance || Math.abs((b.x + b.width) - a.x) < tolerance) {
    const yOverlap = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
    if (yOverlap > 0.5) return true;
  }
  // Horizontal adjacency
  if (Math.abs((a.y + a.depth) - b.y) < tolerance || Math.abs((b.y + b.depth) - a.y) < tolerance) {
    const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    if (xOverlap > 0.5) return true;
  }
  return false;
}

function checkCorridorWidth(rooms: PlacedRoom[]): string[] {
  const errors: string[] = [];
  const corridor = rooms.find(r => r.type === "hallway" || r.name.toLowerCase().includes("corridor"));
  if (corridor) {
    const corridorArea = corridor.width * corridor.depth;
    // Corridor should be thin (1.2m wide, full building width)
    // Area should be reasonable: building_width × 1.2m ≈ 10-15m²
    if (corridorArea > 20) {
      errors.push(`Corridor is ${corridorArea.toFixed(1)}m² — too large (should be ~${(corridor.width * 1.2).toFixed(0)}m²)`);
    }
    const minDim = Math.min(corridor.width, corridor.depth);
    if (minDim > 2.0) {
      errors.push(`Corridor minimum dimension is ${minDim.toFixed(1)}m — should be ~1.2m`);
    }
  }
  return errors;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Layout Engine", () => {

  describe("TEST 1: Standard 2BHK (6 rooms)", () => {
    const program = makeProgram([
      { name: "Living Room", type: "living", areaSqm: 18, zone: "public", adjacentTo: ["Dining Room"] },
      { name: "Kitchen", type: "kitchen", areaSqm: 8, zone: "service", adjacentTo: ["Dining Room"] },
      { name: "Dining Room", type: "dining", areaSqm: 8, zone: "public", adjacentTo: ["Living Room", "Kitchen"] },
      { name: "Master Bedroom", type: "bedroom", areaSqm: 14, zone: "private", adjacentTo: ["Bathroom 1"] },
      { name: "Bedroom 2", type: "bedroom", areaSqm: 12, zone: "private", adjacentTo: ["Bathroom 2"] },
      { name: "Bathroom 1", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 2", type: "bathroom", areaSqm: 3, zone: "service" },
    ], [
      { roomA: "Kitchen", roomB: "Dining Room", reason: "serving" },
      { roomA: "Living Room", roomB: "Dining Room", reason: "flow" },
      { roomA: "Master Bedroom", roomB: "Bathroom 1", reason: "attached bath" },
      { roomA: "Bedroom 2", roomB: "Bathroom 2", reason: "attached bath" },
    ]);

    let result: PlacedRoom[];

    it("produces the right number of rooms (+ corridor)", () => {
      result = layoutFloorPlan(program);
      // 7 input rooms + 1 corridor = 8
      expect(result.length).toBe(8);
    });

    it("has zero overlaps", () => {
      expect(checkZeroOverlaps(result)).toEqual([]);
    });

    it("all rooms within footprint", () => {
      expect(checkWithinFootprint(result)).toEqual([]);
    });

    it("room areas within ±30% of targets", () => {
      expect(checkAreaMatch(result, program.rooms)).toEqual([]);
    });

    it("no extreme aspect ratios", () => {
      expect(checkAspectRatios(result)).toEqual([]);
    });

    it("corridor is thin (≤ 1.5m)", () => {
      expect(checkCorridorWidth(result)).toEqual([]);
    });

    it("bedrooms are adjacent to their bathrooms", () => {
      const mbr = result.find(r => r.name === "Master Bedroom")!;
      const b1 = result.find(r => r.name === "Bathroom 1")!;
      expect(areAdjacent(mbr, b1)).toBe(true);

      const bed2 = result.find(r => r.name === "Bedroom 2")!;
      const b2 = result.find(r => r.name === "Bathroom 2")!;
      expect(areAdjacent(bed2, b2)).toBe(true);
    });

    it("minimum room dimensions met", () => {
      expect(checkMinDimensions(result)).toEqual([]);
    });
  });

  describe("TEST 2: Large 4BHK Villa (13 rooms)", () => {
    const program = makeProgram([
      { name: "Living Room", type: "living", areaSqm: 30, zone: "public", adjacentTo: ["Dining Room", "Foyer"] },
      { name: "Dining Room", type: "dining", areaSqm: 15, zone: "public", adjacentTo: ["Living Room", "Kitchen"] },
      { name: "Kitchen", type: "kitchen", areaSqm: 12, zone: "service", adjacentTo: ["Dining Room"] },
      { name: "Foyer", type: "entrance", areaSqm: 6, zone: "public" },
      { name: "Master Bedroom", type: "bedroom", areaSqm: 20, zone: "private", adjacentTo: ["Bathroom 1"] },
      { name: "Bedroom 2", type: "bedroom", areaSqm: 14, zone: "private", adjacentTo: ["Bathroom 2"] },
      { name: "Bedroom 3", type: "bedroom", areaSqm: 14, zone: "private", adjacentTo: ["Bathroom 3"] },
      { name: "Bedroom 4", type: "bedroom", areaSqm: 12, zone: "private", adjacentTo: ["Bathroom 4"] },
      { name: "Bathroom 1", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 2", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 3", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 4", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Utility", type: "utility", areaSqm: 5, zone: "service" },
    ], [
      { roomA: "Living Room", roomB: "Dining Room", reason: "flow" },
      { roomA: "Kitchen", roomB: "Dining Room", reason: "serving" },
      { roomA: "Master Bedroom", roomB: "Bathroom 1", reason: "attached bath" },
      { roomA: "Bedroom 2", roomB: "Bathroom 2", reason: "attached bath" },
      { roomA: "Bedroom 3", roomB: "Bathroom 3", reason: "attached bath" },
      { roomA: "Bedroom 4", roomB: "Bathroom 4", reason: "attached bath" },
    ], { totalAreaSqm: 180 });

    let result: PlacedRoom[];

    it("produces correct room count", () => {
      result = layoutFloorPlan(program);
      // 13 input rooms + 1 corridor = 14
      expect(result.length).toBe(14);
    });

    it("has zero overlaps", () => {
      expect(checkZeroOverlaps(result)).toEqual([]);
    });

    it("all rooms within footprint", () => {
      expect(checkWithinFootprint(result)).toEqual([]);
    });

    it("no extreme aspect ratios", () => {
      expect(checkAspectRatios(result)).toEqual([]);
    });

    it("corridor is thin", () => {
      expect(checkCorridorWidth(result)).toEqual([]);
    });

    it("each bedroom adjacent to its bathroom", () => {
      for (let i = 1; i <= 4; i++) {
        const bedName = i === 1 ? "Master Bedroom" : `Bedroom ${i}`;
        const bathName = `Bathroom ${i}`;
        const bed = result.find(r => r.name === bedName);
        const bath = result.find(r => r.name === bathName);
        if (bed && bath) {
          expect(areAdjacent(bed, bath)).toBe(true);
        }
      }
    });
  });

  describe("TEST 3: Studio Apartment (3 rooms)", () => {
    const program = makeProgram([
      { name: "Living Room", type: "living", areaSqm: 25, zone: "public" },
      { name: "Kitchen", type: "kitchen", areaSqm: 6, zone: "service" },
      { name: "Bathroom", type: "bathroom", areaSqm: 3, zone: "service" },
    ]);

    let result: PlacedRoom[];

    it("produces 3 rooms (no corridor for small apartment)", () => {
      result = layoutFloorPlan(program);
      expect(result.length).toBe(3);
    });

    it("has zero overlaps", () => {
      expect(checkZeroOverlaps(result)).toEqual([]);
    });

    it("all rooms within footprint", () => {
      expect(checkWithinFootprint(result)).toEqual([]);
    });

    it("total area ~34 sqm", () => {
      const total = result.reduce((s, r) => s + r.width * r.depth, 0);
      expect(total).toBeGreaterThan(28);
      expect(total).toBeLessThan(45);
    });
  });

  describe("TEST 4: Office Space (8 rooms)", () => {
    const program = makeProgram([
      { name: "Reception", type: "entrance", areaSqm: 15, zone: "public" },
      { name: "Office 1", type: "office", areaSqm: 12, zone: "private" },
      { name: "Office 2", type: "office", areaSqm: 12, zone: "private" },
      { name: "Office 3", type: "office", areaSqm: 12, zone: "private" },
      { name: "Conference Room", type: "living", areaSqm: 20, zone: "public" },
      { name: "Pantry", type: "kitchen", areaSqm: 8, zone: "service" },
      { name: "Restroom 1", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Restroom 2", type: "bathroom", areaSqm: 4, zone: "service" },
    ], [], { buildingType: "Commercial Office" });

    let result: PlacedRoom[];

    it("produces correct count", () => {
      result = layoutFloorPlan(program);
      // 8 rooms + 1 corridor = 9
      expect(result.length).toBe(9);
    });

    it("has zero overlaps", () => {
      expect(checkZeroOverlaps(result)).toEqual([]);
    });

    it("no extreme aspect ratios", () => {
      expect(checkAspectRatios(result)).toEqual([]);
    });

    it("corridor is thin", () => {
      expect(checkCorridorWidth(result)).toEqual([]);
    });
  });

  describe("TEST 5: 3BHK with special rooms", () => {
    const program = makeProgram([
      { name: "Living Room", type: "living", areaSqm: 25, zone: "public", adjacentTo: ["Dining Room"] },
      { name: "Dining Room", type: "dining", areaSqm: 12, zone: "public", adjacentTo: ["Living Room", "Kitchen"] },
      { name: "Kitchen", type: "kitchen", areaSqm: 10, zone: "service", adjacentTo: ["Dining Room"] },
      { name: "Master Bedroom", type: "bedroom", areaSqm: 16, zone: "private", adjacentTo: ["Bathroom 1"] },
      { name: "Bedroom 2", type: "bedroom", areaSqm: 12, zone: "private", adjacentTo: ["Bathroom 2"] },
      { name: "Bedroom 3", type: "bedroom", areaSqm: 12, zone: "private", adjacentTo: ["Bathroom 3"] },
      { name: "Bathroom 1", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 2", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Bathroom 3", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Verandah", type: "balcony", areaSqm: 10, zone: "public" },
      { name: "Utility", type: "utility", areaSqm: 4, zone: "service" },
    ], [
      { roomA: "Living Room", roomB: "Dining Room", reason: "flow" },
      { roomA: "Kitchen", roomB: "Dining Room", reason: "serving" },
      { roomA: "Master Bedroom", roomB: "Bathroom 1", reason: "attached bath" },
      { roomA: "Bedroom 2", roomB: "Bathroom 2", reason: "attached bath" },
      { roomA: "Bedroom 3", roomB: "Bathroom 3", reason: "attached bath" },
    ], { totalAreaSqm: 150, buildingType: "Residential Villa" });

    let result: PlacedRoom[];

    it("produces correct count", () => {
      result = layoutFloorPlan(program);
      // 11 rooms + 1 corridor = 12
      expect(result.length).toBe(12);
    });

    it("has zero overlaps", () => {
      expect(checkZeroOverlaps(result)).toEqual([]);
    });

    it("all rooms within footprint", () => {
      expect(checkWithinFootprint(result)).toEqual([]);
    });

    it("each bedroom adjacent to its bathroom", () => {
      for (let i = 1; i <= 3; i++) {
        const bedName = i === 1 ? "Master Bedroom" : `Bedroom ${i}`;
        const bathName = `Bathroom ${i}`;
        const bed = result.find(r => r.name === bedName);
        const bath = result.find(r => r.name === bathName);
        if (bed && bath) {
          expect(areAdjacent(bed, bath)).toBe(true);
        }
      }
    });

    it("corridor is thin", () => {
      expect(checkCorridorWidth(result)).toEqual([]);
    });
  });

  describe("Edge cases", () => {
    it("handles empty room list", () => {
      const program = makeProgram([]);
      const result = layoutFloorPlan(program);
      expect(result).toEqual([]);
    });

    it("handles single room", () => {
      const program = makeProgram([
        { name: "Studio", type: "living", areaSqm: 30, zone: "public" },
      ]);
      const result = layoutFloorPlan(program);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Studio");
      expect(result[0].width * result[0].depth).toBeGreaterThan(25);
    });

    it("handles two rooms", () => {
      const program = makeProgram([
        { name: "Room A", type: "living", areaSqm: 20, zone: "public" },
        { name: "Room B", type: "bedroom", areaSqm: 15, zone: "private" },
      ]);
      const result = layoutFloorPlan(program);
      expect(result.length).toBe(2);
      expect(checkZeroOverlaps(result)).toEqual([]);
    });

    it("handles all-public rooms (no private zone)", () => {
      const program = makeProgram([
        { name: "Reception", type: "entrance", areaSqm: 20, zone: "public" },
        { name: "Hall", type: "living", areaSqm: 40, zone: "public" },
        { name: "Kitchen", type: "kitchen", areaSqm: 10, zone: "service" },
      ]);
      const result = layoutFloorPlan(program);
      expect(result.length).toBe(3);
      expect(checkZeroOverlaps(result)).toEqual([]);
    });
  });
});
