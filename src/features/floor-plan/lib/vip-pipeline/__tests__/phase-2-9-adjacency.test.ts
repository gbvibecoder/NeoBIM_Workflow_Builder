/**
 * Phase 2.9 — declared-adjacency enforcement tests.
 *
 * Contract:
 *   - "attached" / "direct-access" declarations trigger enforcement.
 *   - "adjacent" / "connected" are no-ops (softer, not enforced here).
 *   - Already-satisfied pairs don't move.
 *   - Smaller room snaps to larger's nearest edge.
 *   - Out-of-bounds or would-overlap moves revert cleanly.
 *   - Missing rooms don't crash.
 */

import { describe, it, expect } from "vitest";
import {
  enforceDeclaredAdjacencies,
  type AdjacencyEnforceInput,
} from "../stage-5-adjacency";
import type { AdjacencyDeclaration } from "../types";
import type { TransformedRoom } from "../stage-5-synthesis";

function tr(name: string, x: number, y: number, w: number, d: number, type = "other"): TransformedRoom {
  return {
    name,
    type,
    placed: { x, y, width: w, depth: d },
    confidence: 0.9,
    labelAsShown: name,
  };
}

function adj(a: string, b: string, relationship: AdjacencyDeclaration["relationship"] = "attached"): AdjacencyDeclaration {
  return { a, b, relationship };
}

function input(
  rooms: TransformedRoom[],
  adjacencies: AdjacencyDeclaration[],
  plotW = 40,
  plotD = 40,
): AdjacencyEnforceInput {
  return { rooms, adjacencies, plotWidthFt: plotW, plotDepthFt: plotD };
}

function nameAt(rooms: TransformedRoom[], name: string): TransformedRoom | undefined {
  return rooms.find((r) => r.name === name);
}

// ─── Happy path: attached ensuite, initially detached ──────────

describe("Phase 2.9 adjacency — move smaller room to share wall", () => {
  it("detached Master Bathroom snaps to Master Bedroom's nearest edge", () => {
    const rooms = [
      tr("Master Bedroom", 5, 10, 14, 12), // large — spans 5-19 x 10-22
      tr("Master Bathroom", 30, 30, 7, 5), // detached at opposite corner
    ];
    const res = enforceDeclaredAdjacencies(
      input(rooms, [adj("Master Bedroom", "Master Bathroom", "attached")]),
    );
    const rec = res.records[0];
    expect(rec.action).toBe("moved");
    expect(["right", "top"]).toContain(rec.edge!);
    // Master Bathroom now flush against Master Bedroom.
    const mbath = nameAt(res.rooms, "Master Bathroom")!;
    const mbed = nameAt(res.rooms, "Master Bedroom")!;
    // One edge of mbath touches one edge of mbed.
    const touches =
      Math.abs(mbath.placed.x - (mbed.placed.x + mbed.placed.width)) < 0.1 ||
      Math.abs(mbath.placed.x + mbath.placed.width - mbed.placed.x) < 0.1 ||
      Math.abs(mbath.placed.y - (mbed.placed.y + mbed.placed.depth)) < 0.1 ||
      Math.abs(mbath.placed.y + mbath.placed.depth - mbed.placed.y) < 0.1;
    expect(touches).toBe(true);
    // Master Bedroom unchanged.
    expect(mbed.placed).toEqual({ x: 5, y: 10, width: 14, depth: 12 });
  });

  it("direct-access relationship is also enforced (Pooja ↔ Living)", () => {
    const rooms = [
      tr("Living Room", 5, 10, 20, 15),
      tr("Pooja Room", 35, 35, 5, 4),
    ];
    const res = enforceDeclaredAdjacencies(
      input(rooms, [adj("Living Room", "Pooja Room", "direct-access")]),
    );
    expect(res.records[0].action).toBe("moved");
  });
});

describe("Phase 2.9 adjacency — already-satisfied no-op", () => {
  it("rooms already sharing a wall pass through unchanged", () => {
    const rooms = [
      tr("Master Bedroom", 5, 10, 14, 12), // right edge at x=19
      tr("Master Bathroom", 19, 10, 7, 5), // left edge at x=19 → sharing wall
    ];
    const res = enforceDeclaredAdjacencies(
      input(rooms, [adj("Master Bedroom", "Master Bathroom", "attached")]),
    );
    expect(res.records[0].action).toBe("already-satisfied");
    expect(nameAt(res.rooms, "Master Bathroom")!.placed).toEqual(rooms[1].placed);
  });
});

describe("Phase 2.9 adjacency — soft relationships are no-ops", () => {
  it('"adjacent" relationship is skipped with reason', () => {
    const rooms = [
      tr("Kitchen", 0, 0, 10, 8),
      tr("Dining", 25, 25, 8, 8),
    ];
    const res = enforceDeclaredAdjacencies(
      input(rooms, [adj("Kitchen", "Dining", "adjacent")]),
    );
    expect(res.records[0].action).toBe("skipped-relationship");
    expect(nameAt(res.rooms, "Dining")!.placed).toEqual(rooms[1].placed);
  });

  it('"connected" relationship is skipped with reason', () => {
    const rooms = [
      tr("Hallway", 0, 0, 20, 4),
      tr("Bedroom 2", 30, 30, 10, 10),
    ];
    const res = enforceDeclaredAdjacencies(
      input(rooms, [adj("Hallway", "Bedroom 2", "connected")]),
    );
    expect(res.records[0].action).toBe("skipped-relationship");
  });
});

describe("Phase 2.9 adjacency — safety: missing rooms & overlaps", () => {
  it("missing room → skipped-room-missing, other rooms untouched", () => {
    const rooms = [tr("Master Bedroom", 5, 5, 14, 12)];
    const res = enforceDeclaredAdjacencies(
      input(rooms, [adj("Master Bedroom", "Phantom Ensuite", "attached")]),
    );
    expect(res.records[0].action).toBe("skipped-room-missing");
    expect(res.rooms).toEqual(rooms);
  });

  it("would-overlap → skip with reason, rooms remain at pre-move coords", () => {
    // Master Bedroom + Bedroom 3 pack tightly. Master Bath would have
    // to move somewhere that overlaps Bedroom 3 or leave the plot.
    const rooms = [
      tr("Master Bedroom", 0, 0, 14, 12), // right edge at x=14
      tr("Bedroom 3", 14, 0, 14, 12), // flush with Master's right → no room there
      tr("Living Room", 0, 12, 28, 14), // takes north half
      tr("Master Bathroom", 35, 35, 5, 5), // stranded in SE corner
    ];
    const res = enforceDeclaredAdjacencies(
      input(rooms, [adj("Master Bedroom", "Master Bathroom", "attached")], 28, 26),
    );
    // The only clear edge is Master Bedroom's bottom (y=0) but the plot
    // goes 0..26 and Master Bedroom's bottom is at y=0 (plot edge) —
    // so no flush position fits inside the plot. Expect skip.
    expect(["skipped-would-overlap", "skipped-out-of-bounds"]).toContain(res.records[0].action);
    // Master Bathroom untouched.
    expect(nameAt(res.rooms, "Master Bathroom")!.placed).toEqual(rooms[3].placed);
  });
});

describe("Phase 2.9 adjacency — prefers nearest edge of larger room", () => {
  it("Master Bath to the RIGHT of Master Bedroom snaps to the RIGHT edge", () => {
    const rooms = [
      tr("Master Bedroom", 5, 10, 14, 12), // x=5..19
      tr("Master Bathroom", 30, 14, 7, 5), // east of bedroom, center at (33.5, 16.5)
    ];
    const res = enforceDeclaredAdjacencies(
      input(rooms, [adj("Master Bedroom", "Master Bathroom", "attached")]),
    );
    expect(res.records[0].edge).toBe("right");
    expect(nameAt(res.rooms, "Master Bathroom")!.placed.x).toBeCloseTo(19, 0);
  });
});

describe("Phase 2.9 adjacency — multi-pair processing", () => {
  it("processes multiple declarations sequentially, tracking each in records", () => {
    const rooms = [
      tr("Master Bedroom", 5, 5, 14, 12),
      tr("Master Bathroom", 30, 30, 7, 5),
      tr("Living Room", 20, 5, 18, 14),
      tr("Pooja Room", 0, 35, 4, 4),
    ];
    const res = enforceDeclaredAdjacencies(
      input(rooms, [
        adj("Master Bedroom", "Master Bathroom", "attached"),
        adj("Living Room", "Pooja Room", "direct-access"),
      ]),
    );
    expect(res.records).toHaveLength(2);
    expect(res.records.every((r) => r.action === "moved" || r.action === "already-satisfied")).toBe(true);
  });
});
