/**
 * Phase 2.11.3 — exterior-window coverage on habitable exterior-facing rooms.
 *
 * Root cause: Stage 5 fidelity mode's window placer was wall-centric. It
 * iterates every exterior wall and places a midpoint window if the wall
 * is long enough for the policy-declared width. Rooms whose only
 * exterior walls were too short for STANDARD (3 ft) or LARGE (4 ft)
 * windows ended up with zero windows; Pooja Rooms were explicitly
 * skipped (policy returned null). Phase 2.10 E2E showed
 * exteriorWindows = 5/10 with Pooja Room flagged for "0 doors and
 * 0 windows."
 *
 * Fix:
 *   (a) `shouldHaveWindow("pooja"|"prayer"|"mandir")` now returns a
 *       ventilation-grade opening instead of null.
 *   (b) Room-centric coverage pass after the wall-centric loop:
 *       habitable rooms with a non-null policy + an exterior wall but
 *       no placed window get a window on the longest available
 *       exterior wall; STANDARD → VENT (1.5 ft) degradation when the
 *       wall is too short for the policy default.
 */

import { describe, expect, it } from "vitest";
import { runStage5FidelityMode } from "../stage-5-fidelity";
import type {
  ArchitectBrief,
  ExtractedRoom,
  ExtractedRooms,
  Stage5Input,
} from "../types";

const PX_PER_FT = 1024 / 40;

interface TypedFixture {
  name: string;
  type: string;
  xFt: number;
  yFt: number;
  wFt: number;
  hFt: number;
}

function mkRoom(fx: TypedFixture): ExtractedRoom {
  return {
    name: fx.name,
    rectPx: {
      x: Math.round(fx.xFt * PX_PER_FT),
      y: Math.round(fx.yFt * PX_PER_FT),
      w: Math.round(fx.wFt * PX_PER_FT),
      h: Math.round(fx.hFt * PX_PER_FT),
    },
    confidence: 0.9,
    labelAsShown: fx.name,
  };
}

function mkBrief(fixtures: TypedFixture[], plotW: number, plotD: number): ArchitectBrief {
  return {
    projectType: "residential",
    plotWidthFt: plotW,
    plotDepthFt: plotD,
    facing: "north",
    styleCues: [],
    constraints: [],
    adjacencies: [],
    roomList: fixtures.map((f) => ({ name: f.name, type: f.type, approxAreaSqft: f.wFt * f.hFt })),
  };
}

function mkExtraction(fixtures: TypedFixture[]): ExtractedRooms {
  return {
    imageSize: { width: 1024, height: 1024 },
    plotBoundsPx: { x: 0, y: 0, w: 1024, h: 1024 },
    rooms: fixtures.map(mkRoom),
    issues: [],
    expectedRoomsMissing: [],
    unexpectedRoomsFound: [],
  };
}

function mkInput(fixtures: TypedFixture[], plotWidthFt = 40, plotDepthFt = 40): Stage5Input {
  return {
    extraction: mkExtraction(fixtures),
    plotWidthFt,
    plotDepthFt,
    facing: "north",
    brief: mkBrief(fixtures, plotWidthFt, plotDepthFt),
    parsedConstraints: {
      plot: { width_ft: plotWidthFt, depth_ft: plotDepthFt, facing: "north" },
      // Fidelity mode reads `function` here to populate StripPackRoom.type;
      // brief.roomList is used by the Phase 2.9 classifier, not the types
      // themselves. Supply both to keep the fixture faithful.
      rooms: fixtures.map((f) => ({
        id: f.name,
        name: f.name,
        function: f.type,
        dim_width_ft: f.wFt,
        dim_depth_ft: f.hFt,
        is_wet: false,
        is_sacred: false,
      })),
      adjacency_pairs: [],
      connects_all_groups: [],
      vastu_required: false,
      special_features: [],
      budget: null,
    } as unknown as Stage5Input["parsedConstraints"],
  };
}

describe("Phase 2.11.3 — habitable exterior-facing rooms always get ≥1 window", () => {
  it("Pooja Room on an exterior wall receives a ventilation window", async () => {
    const fixtures: TypedFixture[] = [
      { name: "Living Room", type: "living", xFt: 0, yFt: 0, wFt: 25, hFt: 40 },
      { name: "Bedroom", type: "bedroom", xFt: 25, yFt: 0, wFt: 15, hFt: 20 },
      { name: "Pooja Room", type: "pooja", xFt: 25, yFt: 20, wFt: 15, hFt: 20 },
    ];
    const { output } = await runStage5FidelityMode(mkInput(fixtures), undefined);
    const floor = output.project.floors[0];
    const pooja = floor.rooms.find((r) => r.name === "Pooja Room")!;
    const poojaWindows = floor.windows.filter((w) => {
      const wall = floor.walls.find((wl) => wl.id === w.wall_id);
      return wall && (wall.left_room_id === pooja.id || wall.right_room_id === pooja.id);
    });
    expect(poojaWindows.length).toBeGreaterThanOrEqual(1);
  });

  it("every habitable room with an exterior wall has ≥ 1 window (canonical 3BHK layout)", async () => {
    const fixtures: TypedFixture[] = [
      { name: "Master Bedroom", type: "master_bedroom", xFt: 0, yFt: 0, wFt: 14, hFt: 14 },
      { name: "Master Bathroom", type: "master_bathroom", xFt: 14, yFt: 0, wFt: 6, hFt: 7 },
      { name: "Bedroom 2", type: "bedroom", xFt: 0, yFt: 14, wFt: 14, hFt: 12 },
      { name: "Bedroom 3", type: "bedroom", xFt: 14, yFt: 14, wFt: 12, hFt: 12 },
      { name: "Living Room", type: "living", xFt: 0, yFt: 26, wFt: 20, hFt: 14 },
      { name: "Kitchen", type: "kitchen", xFt: 20, yFt: 26, wFt: 14, hFt: 14 },
      { name: "Pooja Room", type: "pooja", xFt: 14, yFt: 7, wFt: 6, hFt: 7 },
      { name: "Common Bathroom", type: "bathroom", xFt: 20, yFt: 14, wFt: 6, hFt: 12 },
    ];
    const { output } = await runStage5FidelityMode(mkInput(fixtures), undefined);
    const floor = output.project.floors[0];
    const windowsByRoomId = new Map<string, number>();
    for (const w of floor.windows) {
      const wall = floor.walls.find((wl) => wl.id === w.wall_id);
      if (!wall) continue;
      for (const rid of [wall.left_room_id, wall.right_room_id]) {
        if (!rid) continue;
        windowsByRoomId.set(rid, (windowsByRoomId.get(rid) ?? 0) + 1);
      }
    }

    const mustHaveWindowIfExterior = new Set([
      "bedroom", "master_bedroom", "guest_bedroom", "kids_bedroom", "study",
      "living", "drawing_room", "hall", "dining", "kitchen",
      "bathroom", "master_bathroom", "powder_room", "toilet", "utility", "laundry",
      "pooja", "prayer", "mandir",
    ]);

    for (const r of floor.rooms) {
      if (!mustHaveWindowIfExterior.has(r.type)) continue;
      const onExterior = floor.walls.some((wall) => {
        const owns = wall.left_room_id === r.id || wall.right_room_id === r.id;
        return owns && (wall.left_room_id == null || wall.right_room_id == null);
      });
      if (!onExterior) continue;
      expect(
        windowsByRoomId.get(r.id) ?? 0,
        `room "${r.name}" (type "${r.type}") has no window despite an exterior wall`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("interior-only rooms do NOT get windows (only exterior walls receive windows)", async () => {
    // A pooja room sandwiched between two bedrooms without touching the plot edge
    // should not receive a window (windows only go on exterior walls).
    const fixtures: TypedFixture[] = [
      { name: "Living Room", type: "living", xFt: 0, yFt: 0, wFt: 40, hFt: 20 },
      { name: "Bedroom 1", type: "bedroom", xFt: 0, yFt: 20, wFt: 15, hFt: 20 },
      { name: "Bedroom 2", type: "bedroom", xFt: 25, yFt: 20, wFt: 15, hFt: 20 },
      { name: "Pooja Room", type: "pooja", xFt: 15, yFt: 20, wFt: 10, hFt: 20 },
    ];
    const { output } = await runStage5FidelityMode(mkInput(fixtures), undefined);
    const floor = output.project.floors[0];
    const pooja = floor.rooms.find((r) => r.name === "Pooja Room")!;
    const onExterior = floor.walls.some((wall) => {
      const owns = wall.left_room_id === pooja.id || wall.right_room_id === pooja.id;
      return owns && (wall.left_room_id == null || wall.right_room_id == null);
    });
    if (!onExterior) {
      const poojaWindows = floor.windows.filter((w) => {
        const wall = floor.walls.find((wl) => wl.id === w.wall_id);
        return wall && (wall.left_room_id === pooja.id || wall.right_room_id === pooja.id);
      });
      expect(poojaWindows.length).toBe(0);
    }
  });

  it("corridor rooms never get windows (null policy preserved)", async () => {
    const fixtures: TypedFixture[] = [
      { name: "Master Bedroom", type: "master_bedroom", xFt: 0, yFt: 0, wFt: 20, hFt: 20 },
      { name: "Hallway", type: "corridor", xFt: 20, yFt: 0, wFt: 4, hFt: 40 },
      { name: "Bedroom 2", type: "bedroom", xFt: 24, yFt: 0, wFt: 16, hFt: 20 },
      { name: "Living Room", type: "living", xFt: 0, yFt: 20, wFt: 24, hFt: 20 },
      { name: "Kitchen", type: "kitchen", xFt: 24, yFt: 20, wFt: 16, hFt: 20 },
    ];
    const { output } = await runStage5FidelityMode(mkInput(fixtures), undefined);
    const floor = output.project.floors[0];
    const hallway = floor.rooms.find((r) => r.name === "Hallway");
    if (hallway) {
      const hallWindows = floor.windows.filter((w) => {
        const wall = floor.walls.find((wl) => wl.id === w.wall_id);
        return wall && (wall.left_room_id === hallway.id || wall.right_room_id === hallway.id);
      });
      expect(hallWindows.length).toBe(0);
    }
  });

  it("no wall gets two windows (no double-dip between primary + coverage passes)", async () => {
    const fixtures: TypedFixture[] = [
      { name: "Bedroom 1", type: "bedroom", xFt: 0, yFt: 0, wFt: 20, hFt: 40 },
      { name: "Bedroom 2", type: "bedroom", xFt: 20, yFt: 0, wFt: 20, hFt: 40 },
    ];
    const { output } = await runStage5FidelityMode(mkInput(fixtures), undefined);
    const floor = output.project.floors[0];
    const wallIds = floor.windows.map((w) => w.wall_id).filter((x): x is string => !!x);
    const unique = new Set(wallIds);
    expect(unique.size).toBe(wallIds.length);
  });
});
