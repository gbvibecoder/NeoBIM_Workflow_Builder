/**
 * Phase 2.3 Option X — post-placement swap tests for
 * enforceAttachedAdjacencies. Heuristic that mutates room positions
 * so that declared "attached" adjacencies share a wall after Stage 5.
 */

import { describe, it, expect } from "vitest";
import {
  enforceAttachedAdjacencies,
  type TransformedRoom,
} from "@/features/floor-plan/lib/vip-pipeline/stage-5-synthesis";
import type { AdjacencyDeclaration } from "@/features/floor-plan/lib/vip-pipeline/types";

function room(
  name: string,
  x: number,
  y: number,
  width: number,
  depth: number,
  type = "other",
): TransformedRoom {
  return {
    name,
    type,
    placed: { x, y, width, depth },
    confidence: 1,
    labelAsShown: name,
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────

function masterAndDetachedBath(): TransformedRoom[] {
  // Plot 40x40. Master Bedroom at SW corner (0,0,14,12). Master Bathroom
  // stranded at opposite NE corner (25,20,7,5) with no shared wall.
  // Kitchen blocks east of Master; Living Room placed at y=18 leaving the
  // (0,12,*,6) band free for the bathroom to slide into on the north side.
  return [
    room("Master Bedroom", 0, 0, 14, 12, "master_bedroom"),
    room("Master Bathroom", 25, 20, 7, 5, "master_bathroom"),
    room("Kitchen", 15, 0, 10, 8, "kitchen"),
    room("Living Room", 0, 18, 16, 14, "living"),
  ];
}

// ─── Tests ────────────────────────────────────────────────────────

describe("enforceAttachedAdjacencies (Option X)", () => {
  it("is a no-op when the pair already shares a wall", () => {
    // Master Bedroom (0,0,14,12) and Master Bathroom (0,12,7,5): share
    // a wall on the top edge (y=12), horizontal overlap on x=[0,7].
    const rooms: TransformedRoom[] = [
      room("Master Bedroom", 0, 0, 14, 12, "master_bedroom"),
      room("Master Bathroom", 0, 12, 7, 5, "master_bathroom"),
    ];
    const adjacencies: AdjacencyDeclaration[] = [
      { a: "Master Bedroom", b: "Master Bathroom", relationship: "attached" },
    ];
    const issues: string[] = [];
    const stats = enforceAttachedAdjacencies(rooms, adjacencies, 40, 40, issues);
    expect(stats.attempted).toBe(1);
    expect(stats.satisfied).toBe(1);
    expect(stats.moved).toBe(0);
    expect(rooms[1].placed.x).toBe(0);
    expect(rooms[1].placed.y).toBe(12);
    expect(issues).toEqual([]);
  });

  it("moves Master Bathroom east of Master Bedroom when the NE corner is stranded", () => {
    const rooms = masterAndDetachedBath();
    const adjacencies: AdjacencyDeclaration[] = [
      { a: "Master Bedroom", b: "Master Bathroom", relationship: "attached" },
    ];
    const issues: string[] = [];
    const stats = enforceAttachedAdjacencies(rooms, adjacencies, 40, 40, issues);

    expect(stats.attempted).toBe(1);
    expect(stats.satisfied).toBe(1);
    expect(stats.moved).toBe(1);
    const bath = rooms.find((r) => r.name === "Master Bathroom")!;
    // East side of Master Bedroom starts at x=14; bath width 7 → fits within plot.
    // But Kitchen occupies (15,0,10,8), so east side would overlap kitchen. The
    // algorithm should try west (x=-7, rejected), then north (0,12), which is
    // inside the plot and does not overlap other rooms → bath moves to (0,12,7,5).
    expect(bath.placed.x).toBe(0);
    expect(bath.placed.y).toBe(12);
    expect(issues.some((m) => /moved "Master Bathroom"/.test(m))).toBe(true);
  });

  it("ignores non-'attached' relationships (adjacent, direct-access, connected)", () => {
    const rooms = masterAndDetachedBath();
    const snapshot = rooms.map((r) => ({ ...r.placed }));
    const adjacencies: AdjacencyDeclaration[] = [
      { a: "Kitchen", b: "Living Room", relationship: "adjacent" },
      { a: "Living Room", b: "Master Bedroom", relationship: "direct-access" },
      { a: "Master Bedroom", b: "Master Bathroom", relationship: "connected" },
    ];
    const issues: string[] = [];
    const stats = enforceAttachedAdjacencies(rooms, adjacencies, 40, 40, issues);

    expect(stats.attempted).toBe(0);
    expect(stats.moved).toBe(0);
    rooms.forEach((r, i) => {
      expect(r.placed.x).toBe(snapshot[i].x);
      expect(r.placed.y).toBe(snapshot[i].y);
    });
  });

  it("flags unfixable when every side overlaps another room and plot is saturated", () => {
    // Master Bedroom at center surrounded by rooms on all 4 sides.
    // No gap to drop the Master Bathroom into.
    const rooms: TransformedRoom[] = [
      room("Master Bedroom", 16, 16, 8, 8, "master_bedroom"),
      room("A", 0, 0, 40, 16, "other"),   // south slab
      room("B", 0, 24, 40, 16, "other"),  // north slab
      room("C", 0, 16, 16, 8, "other"),   // west slab
      room("D", 24, 16, 16, 8, "other"),  // east slab
      room("Master Bathroom", 38, 38, 2, 2, "master_bathroom"), // stranded
    ];
    const adjacencies: AdjacencyDeclaration[] = [
      { a: "Master Bedroom", b: "Master Bathroom", relationship: "attached" },
    ];
    const issues: string[] = [];
    const stats = enforceAttachedAdjacencies(rooms, adjacencies, 40, 40, issues);

    expect(stats.attempted).toBe(1);
    expect(stats.unfixable).toBe(1);
    expect(stats.moved).toBe(0);
    expect(issues.some((m) => /could not place "Master Bathroom"/.test(m))).toBe(true);
    // bath position unchanged
    expect(rooms[rooms.length - 1].placed.x).toBe(38);
    expect(rooms[rooms.length - 1].placed.y).toBe(38);
  });

  it("handles multiple 'attached' pairs in one pass", () => {
    const rooms: TransformedRoom[] = [
      room("Master Bedroom", 0, 0, 14, 12, "master_bedroom"),
      room("Master Bathroom", 30, 30, 7, 5, "master_bathroom"), // stranded NE
      room("Bedroom 2", 15, 0, 12, 10, "bedroom"),
      room("Bedroom 2 Bath", 35, 5, 6, 5, "bathroom"), // pretend second ensuite, stranded
    ];
    const adjacencies: AdjacencyDeclaration[] = [
      { a: "Master Bedroom", b: "Master Bathroom", relationship: "attached" },
      { a: "Bedroom 2", b: "Bedroom 2 Bath", relationship: "attached" },
    ];
    const issues: string[] = [];
    const stats = enforceAttachedAdjacencies(rooms, adjacencies, 40, 40, issues);

    expect(stats.attempted).toBe(2);
    expect(stats.satisfied).toBeGreaterThanOrEqual(1);
  });

  it("is a no-op when adjacencies array is empty", () => {
    const rooms = masterAndDetachedBath();
    const snapshot = rooms.map((r) => ({ ...r.placed }));
    const stats = enforceAttachedAdjacencies(rooms, [], 40, 40, []);
    expect(stats.attempted).toBe(0);
    rooms.forEach((r, i) => {
      expect(r.placed.x).toBe(snapshot[i].x);
      expect(r.placed.y).toBe(snapshot[i].y);
    });
  });

  it("logs unfixable when adjacency references a non-existent room", () => {
    const rooms: TransformedRoom[] = [
      room("Master Bedroom", 0, 0, 14, 12, "master_bedroom"),
    ];
    const adjacencies: AdjacencyDeclaration[] = [
      { a: "Master Bedroom", b: "Phantom Bathroom", relationship: "attached" },
    ];
    const issues: string[] = [];
    const stats = enforceAttachedAdjacencies(rooms, adjacencies, 40, 40, issues);

    expect(stats.attempted).toBe(1);
    expect(stats.unfixable).toBe(1);
    expect(issues.some((m) => /could not find room/.test(m))).toBe(true);
  });
});
