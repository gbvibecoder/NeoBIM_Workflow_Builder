/**
 * Phase 2.11.1 — fidelity-mode stub spine must not render a phantom Hallway.
 *
 * Root cause: stage-5-fidelity.ts::buildStubSpine emits a {plotW × 0.01 ft}
 * Rect purely to satisfy SpineLayout's typing contract. The strip-pack
 * converter (buildRooms in strip-pack/converter.ts) historically
 * unconditionally emitted a "Hallway" Room from whatever spine rect it
 * received — so fidelity-mode projects came out with a
 * 40 × 0.01 ft "Hallway" that Stage 6 read as a dimensionPlausibility
 * violation.
 *
 * Fix: add `synthetic?: boolean` to SpineLayout. Fidelity stub sets it to
 * `true`; converter's buildRooms skips the Hallway Room when the flag
 * is set. Strip-pack's normal code path never sets the flag, so that
 * path's Hallway emission is unchanged.
 *
 * These tests exercise the behavior end-to-end from Stage 5 fidelity
 * mode (the real production entry point) rather than poking at the
 * converter directly — both ends of the contract need to agree.
 */

import { describe, expect, it } from "vitest";
import { runStage5FidelityMode } from "../stage-5-fidelity";
import type {
  ExtractedRoom,
  ExtractedRooms,
  Stage5Input,
} from "../types";

const PX_PER_FT = 1024 / 40; // 25.6 — a 40×40 ft plot on a 1024×1024 image.

function mkRoom(
  name: string,
  xFt: number,
  yFt: number,
  wFt: number,
  hFt: number,
): ExtractedRoom {
  return {
    name,
    rectPx: {
      x: Math.round(xFt * PX_PER_FT),
      y: Math.round(yFt * PX_PER_FT),
      w: Math.round(wFt * PX_PER_FT),
      h: Math.round(hFt * PX_PER_FT),
    },
    confidence: 0.9,
    labelAsShown: name,
  };
}

function mkExtraction(rooms: ExtractedRoom[]): ExtractedRooms {
  return {
    imageSize: { width: 1024, height: 1024 },
    plotBoundsPx: { x: 0, y: 0, w: 1024, h: 1024 },
    rooms,
    issues: [],
    expectedRoomsMissing: [],
    unexpectedRoomsFound: [],
  };
}

function mkInput(ex: ExtractedRooms): Stage5Input {
  return {
    extraction: ex,
    plotWidthFt: 40,
    plotDepthFt: 40,
    facing: "north",
    parsedConstraints: {
      plot: { width_ft: 40, depth_ft: 40, facing: "north" },
      rooms: [],
      adjacency_pairs: [],
      connects_all_groups: [],
      vastu_required: false,
      special_features: [],
      budget: null,
    } as unknown as Stage5Input["parsedConstraints"],
  };
}

describe("Phase 2.11.1 — no phantom Hallway from fidelity-mode stub spine", () => {
  it("does NOT emit a corridor Room when the extraction has no hallway/corridor/passage", async () => {
    // 3 rooms tiling a 40×40 ft plot — no corridor type at all.
    const ex = mkExtraction([
      mkRoom("Master Bedroom", 0, 0, 20, 20),
      mkRoom("Living Room", 20, 0, 20, 20),
      mkRoom("Kitchen", 0, 20, 40, 20),
    ]);
    const { output } = await runStage5FidelityMode(mkInput(ex), undefined);
    const rooms = output.project.floors[0].rooms;

    // Exactly 3 rooms — no synthetic Hallway injected.
    expect(rooms).toHaveLength(3);
    expect(rooms.some((r) => r.type === "corridor")).toBe(false);
    expect(rooms.some((r) => r.name === "Hallway")).toBe(false);
  });

  it("does NOT emit a 40 × 0.01 ft degenerate Hallway rect (the exact E2E regression)", async () => {
    const ex = mkExtraction([
      mkRoom("Master Bedroom", 0, 0, 15, 15),
      mkRoom("Kitchen", 15, 0, 25, 15),
      mkRoom("Living Room", 0, 15, 40, 25),
    ]);
    const { output } = await runStage5FidelityMode(mkInput(ex), undefined);
    const rooms = output.project.floors[0].rooms;

    // No room should have a degenerate dimension (< 1 ft).
    // Each boundary is a quad in mm; compute bbox and reject tiny slivers.
    for (const r of rooms) {
      const pts = r.boundary.points;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const wFt = (maxX - minX) / 304.8;
      const hFt = (maxY - minY) / 304.8;
      expect(wFt, `room "${r.name}" width in ft`).toBeGreaterThanOrEqual(1);
      expect(hFt, `room "${r.name}" depth in ft`).toBeGreaterThanOrEqual(1);
    }
  });

  it("STILL renders a Hallway when the extraction explicitly contains a corridor room", async () => {
    const ex = mkExtraction([
      mkRoom("Master Bedroom", 0, 0, 20, 15),
      mkRoom("Living Room", 20, 0, 20, 15),
      mkRoom("Hallway", 0, 15, 40, 5), // explicit corridor, reasonable 40×5 ft
      mkRoom("Kitchen", 0, 20, 40, 20),
    ]);
    const { output } = await runStage5FidelityMode(mkInput(ex), undefined);
    const rooms = output.project.floors[0].rooms;

    // Exactly 4 rooms, one of them is the extracted Hallway (not a synth
    // duplicate — double-emission would produce 5 rooms).
    expect(rooms).toHaveLength(4);
    const hallway = rooms.find((r) => r.name === "Hallway");
    expect(hallway).toBeDefined();
    // The Hallway's dimensions should match the extraction (not a 0.01 ft stub).
    const pts = hallway!.boundary.points;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const hFt = (maxY - minY) / 304.8;
    expect(hFt).toBeGreaterThanOrEqual(3); // real corridor depth
  });
});
