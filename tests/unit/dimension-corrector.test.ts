import { describe, it, expect } from "vitest";
import { correctDimensions, RoomWithTarget } from "@/features/floor-plan/lib/dimension-corrector";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRoom(
  name: string, type: string,
  x: number, y: number, w: number, h: number,
  targetArea: number,
): RoomWithTarget {
  return { name, type, x, y, width: w, depth: h, area: w * h, targetArea };
}

function checkNoOverlaps(rooms: RoomWithTarget[]): string[] {
  const errors: string[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
      if (ox > 0.15 && oy > 0.15) {
        errors.push(`"${a.name}" and "${b.name}" overlap by ${(ox * oy).toFixed(1)}m²`);
      }
    }
  }
  return errors;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Dimension Corrector", () => {
  it("preserves no-overlap invariant", () => {
    const rooms: RoomWithTarget[] = [
      makeRoom("Living", "living", 0, 0, 6, 4, 20),
      makeRoom("Kitchen", "kitchen", 6, 0, 4, 4, 10),
      makeRoom("Bedroom", "bedroom", 0, 4, 5, 3, 15),
      makeRoom("Bath", "bathroom", 5, 4, 5, 3, 5),
    ];

    const result = correctDimensions(rooms, 10, 7);
    expect(checkNoOverlaps(result)).toEqual([]);
  });

  it("moves boundary toward oversized room", () => {
    // Room A is 2x its target, Room B is 0.5x its target
    const rooms: RoomWithTarget[] = [
      makeRoom("Big", "living", 0, 0, 8, 5, 20),   // actual=40, target=20 (2x)
      makeRoom("Small", "bedroom", 8, 0, 2, 5, 20), // actual=10, target=20 (0.5x)
    ];

    const result = correctDimensions(rooms, 10, 5);
    const big = result.find(r => r.name === "Big")!;
    const small = result.find(r => r.name === "Small")!;

    // Big should have shrunk, Small should have grown
    expect(big.width).toBeLessThan(8);
    expect(small.width).toBeGreaterThan(2);
    // No overlaps
    expect(checkNoOverlaps(result)).toEqual([]);
  });

  it("does not create rooms below minimum dimension", () => {
    const rooms: RoomWithTarget[] = [
      makeRoom("Hall", "living", 0, 0, 9, 5, 45),    // big target
      makeRoom("WC", "bathroom", 9, 0, 1.5, 5, 2),   // small target near min
    ];

    const result = correctDimensions(rooms, 10.5, 5);
    const wc = result.find(r => r.name === "WC")!;
    // Bathroom minimum is 1.2m
    expect(wc.width).toBeGreaterThanOrEqual(1.0);
    expect(wc.depth).toBeGreaterThanOrEqual(1.0);
  });

  it("handles rooms with no deviation (already correct)", () => {
    const rooms: RoomWithTarget[] = [
      makeRoom("A", "living", 0, 0, 5, 4, 20),   // exact match
      makeRoom("B", "bedroom", 5, 0, 5, 4, 20),  // exact match
    ];

    const result = correctDimensions(rooms, 10, 4);
    // Should return rooms essentially unchanged
    expect(result[0].width).toBeCloseTo(5, 0);
    expect(result[1].width).toBeCloseTo(5, 0);
  });

  it("handles complex 4-room layout without overlap", () => {
    const rooms: RoomWithTarget[] = [
      makeRoom("Living", "living", 0, 0, 5, 4, 25),     // too small (20 vs 25)
      makeRoom("Kitchen", "kitchen", 5, 0, 5, 4, 12),    // too big (20 vs 12)
      makeRoom("Bedroom", "bedroom", 0, 4, 5, 4, 18),    // close
      makeRoom("Bath", "bathroom", 5, 4, 5, 4, 8),       // too big (20 vs 8)
    ];

    const result = correctDimensions(rooms, 10, 8);
    expect(checkNoOverlaps(result)).toEqual([]);
    // All rooms should still have positive dimensions
    for (const room of result) {
      expect(room.width).toBeGreaterThan(0);
      expect(room.depth).toBeGreaterThan(0);
    }
  });
});
