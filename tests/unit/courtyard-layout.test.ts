import { describe, it, expect } from "vitest";
import { layoutCourtyardPlan, hasCourtyardRoom } from "@/lib/floor-plan/courtyard-layout";
import type { EnhancedRoomProgram, RoomSpec } from "@/lib/floor-plan/ai-room-programmer";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeProgram(
  rooms: Array<{ name: string; type: string; areaSqm: number; zone: RoomSpec["zone"] }>,
  overrides?: Partial<EnhancedRoomProgram>,
): EnhancedRoomProgram {
  const roomSpecs: RoomSpec[] = rooms.map(r => ({
    name: r.name,
    type: r.type,
    areaSqm: r.areaSqm,
    zone: r.zone,
    mustHaveExteriorWall: true,
    adjacentTo: [],
    preferNear: [],
  }));

  return {
    buildingType: "Traditional Villa",
    totalAreaSqm: roomSpecs.reduce((s, r) => s + r.areaSqm, 0),
    numFloors: 1,
    rooms: roomSpecs,
    adjacency: [],
    zones: { public: [], private: [], service: [], circulation: [] },
    entranceRoom: "Foyer",
    circulationNotes: "",
    projectName: "Courtyard Test",
    ...overrides,
  };
}

function checkNoOverlaps(rooms: Array<{ name: string; x: number; y: number; width: number; depth: number }>): string[] {
  const errors: string[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
      if (ox > 0.15 && oy > 0.15) {
        errors.push(`"${a.name}" and "${b.name}" overlap`);
      }
    }
  }
  return errors;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Courtyard Layout", () => {
  it("detects courtyard room in program", () => {
    const program = makeProgram([
      { name: "Central Courtyard", type: "other", areaSqm: 20, zone: "public" },
      { name: "Living Room", type: "living", areaSqm: 25, zone: "public" },
    ]);
    expect(hasCourtyardRoom(program)).toBe(true);
  });

  it("returns null when no courtyard room present", () => {
    const program = makeProgram([
      { name: "Living Room", type: "living", areaSqm: 25, zone: "public" },
      { name: "Kitchen", type: "kitchen", areaSqm: 12, zone: "service" },
    ]);
    expect(hasCourtyardRoom(program)).toBe(false);
    expect(layoutCourtyardPlan(program, 10, 10)).toBeNull();
  });

  it("places courtyard in center of footprint", () => {
    const program = makeProgram([
      { name: "Central Courtyard", type: "other", areaSqm: 16, zone: "public" },
      { name: "Foyer", type: "entrance", areaSqm: 10, zone: "public" },
      { name: "Living Room", type: "living", areaSqm: 20, zone: "public" },
      { name: "Kitchen", type: "kitchen", areaSqm: 12, zone: "service" },
      { name: "Bedroom", type: "bedroom", areaSqm: 14, zone: "private" },
    ]);

    const result = layoutCourtyardPlan(program, 16, 16);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(5);

    const courtyard = result!.find(r => r.name === "Central Courtyard")!;
    expect(courtyard).toBeDefined();
    // Courtyard should be roughly centered
    expect(courtyard.x).toBeGreaterThan(2);
    expect(courtyard.y).toBeGreaterThan(2);
    expect(courtyard.x + courtyard.width).toBeLessThan(14);
    expect(courtyard.y + courtyard.depth).toBeLessThan(14);
  });

  it("no room overlaps with courtyard void", () => {
    const program = makeProgram([
      { name: "Central Courtyard", type: "other", areaSqm: 16, zone: "public" },
      { name: "Foyer", type: "entrance", areaSqm: 8, zone: "public" },
      { name: "Drawing Room", type: "living", areaSqm: 20, zone: "public" },
      { name: "Kitchen", type: "kitchen", areaSqm: 12, zone: "service" },
      { name: "Dining", type: "dining", areaSqm: 10, zone: "public" },
      { name: "Bedroom", type: "bedroom", areaSqm: 14, zone: "private" },
      { name: "Bathroom", type: "bathroom", areaSqm: 4, zone: "service" },
      { name: "Store", type: "storage", areaSqm: 4, zone: "service" },
    ]);

    const result = layoutCourtyardPlan(program, 18, 18);
    expect(result).not.toBeNull();
    expect(checkNoOverlaps(result!)).toEqual([]);
  });

  it("all rooms present in output", () => {
    const program = makeProgram([
      { name: "Courtyard", type: "other", areaSqm: 20, zone: "public" },
      { name: "Living", type: "living", areaSqm: 25, zone: "public" },
      { name: "Kitchen", type: "kitchen", areaSqm: 12, zone: "service" },
      { name: "Bedroom", type: "bedroom", areaSqm: 15, zone: "private" },
      { name: "Bath", type: "bathroom", areaSqm: 4, zone: "service" },
    ]);

    const result = layoutCourtyardPlan(program, 16, 16);
    expect(result).not.toBeNull();
    const names = result!.map(r => r.name);
    expect(names).toContain("Courtyard");
    expect(names).toContain("Living");
    expect(names).toContain("Kitchen");
    expect(names).toContain("Bedroom");
    expect(names).toContain("Bath");
  });

  it("rooms distributed to 4 strips around courtyard", () => {
    const program = makeProgram([
      { name: "Central Courtyard", type: "other", areaSqm: 16, zone: "public" },
      { name: "Foyer", type: "entrance", areaSqm: 10, zone: "public" },
      { name: "Kitchen", type: "kitchen", areaSqm: 12, zone: "service" },
      { name: "Master Bedroom", type: "bedroom", areaSqm: 16, zone: "private" },
      { name: "Servant Room", type: "other", areaSqm: 8, zone: "service" },
    ]);

    const result = layoutCourtyardPlan(program, 16, 16);
    expect(result).not.toBeNull();

    const courtyard = result!.find(r => r.name === "Central Courtyard")!;
    const cyCenter = { x: courtyard.x + courtyard.width / 2, y: courtyard.y + courtyard.depth / 2 };

    // Other rooms should be OUTSIDE the courtyard bounds
    for (const room of result!) {
      if (room.name === "Central Courtyard") continue;
      // Room center should NOT be inside courtyard
      const rx = room.x + room.width / 2;
      const ry = room.y + room.depth / 2;
      const insideX = rx > courtyard.x && rx < courtyard.x + courtyard.width;
      const insideY = ry > courtyard.y && ry < courtyard.y + courtyard.depth;
      expect(insideX && insideY).toBe(false);
    }
  });
});
