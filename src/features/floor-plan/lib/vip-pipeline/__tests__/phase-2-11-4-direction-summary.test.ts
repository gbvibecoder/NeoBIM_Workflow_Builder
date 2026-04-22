/**
 * Phase 2.11.4 — directional room-placement data for Stage 6 vastu scoring.
 *
 * Root cause: Stage 6's project summary emitted room dimensions + door /
 * window counts but NOT placement directions. The vastuCompliance LLM
 * prompt had no way to check "is Pooja in NE, is Master in SW, is Kitchen
 * in SE" other than re-deriving centers from boundary polygons — a job
 * it consistently declined, returning "unverifiable" (4/10) on the Phase
 * 2.10 E2E.
 *
 * Fix:
 *   (a) computeDirection8() — pure function mapping (roomCenterMm, plotCenterMm)
 *       → N | NE | E | SE | S | SW | W | NW | CENTER. Exported for unit
 *       testing.
 *   (b) summarizeProject() now includes a `DIR` tag in every room line
 *       (`Pooja Room (pooja, NE): ...`).
 *   (c) When vastu is required, appends a "VASTU PLACEMENT REFERENCE"
 *       block listing the ideal octant per room type + a scoring
 *       rubric.
 */

import { describe, expect, it } from "vitest";
import {
  computeDirection8,
  summarizeProject,
  type Direction8,
} from "../stage-6-quality";
import type { ArchitectBrief } from "../types";
import type { FloorPlanProject, Room } from "@/types/floor-plan-cad";

// ─── computeDirection8 unit cases ──────────────────────────────

describe("Phase 2.11.4 — computeDirection8 octant math", () => {
  const plot = { x: 6000, y: 6000 }; // 40 ft plot in mm, center at 6096 — close enough for unit tests

  it.each<{ center: { x: number; y: number }; expected: Direction8 }>([
    { center: { x: 9000, y: 6000 }, expected: "E" }, // dx > 0, dy ≈ 0
    { center: { x: 9000, y: 9000 }, expected: "NE" }, // dx > 0, dy > 0
    { center: { x: 6000, y: 9000 }, expected: "N" }, // dx ≈ 0, dy > 0
    { center: { x: 3000, y: 9000 }, expected: "NW" },
    { center: { x: 3000, y: 6000 }, expected: "W" },
    { center: { x: 3000, y: 3000 }, expected: "SW" },
    { center: { x: 6000, y: 3000 }, expected: "S" },
    { center: { x: 9000, y: 3000 }, expected: "SE" },
  ])("room at ($center.x, $center.y) resolves to $expected", ({ center, expected }) => {
    expect(computeDirection8(center, plot)).toBe(expected);
  });

  it("returns CENTER when the room's center is within 3 ft of the plot center", () => {
    const centerRadius = 3 * 304.8;
    // Exactly at plot center.
    expect(computeDirection8(plot, plot, centerRadius)).toBe("CENTER");
    // 2 ft off (inside the radius).
    expect(computeDirection8({ x: plot.x + 2 * 304.8, y: plot.y }, plot, centerRadius)).toBe("CENTER");
    // 4 ft off (outside the radius) → regular octant.
    expect(computeDirection8({ x: plot.x + 4 * 304.8, y: plot.y }, plot, centerRadius)).toBe("E");
  });

  it("handles boundary-angle ties deterministically at 22.5° increments", () => {
    // Exactly east: 0° → E; just past the 22.5° boundary → NE.
    expect(computeDirection8({ x: 9000, y: 6000 }, plot)).toBe("E");
    // 22.5° + tiny amount into NE.
    const ang = (22.6 * Math.PI) / 180;
    const r = 3000;
    expect(computeDirection8({ x: plot.x + r * Math.cos(ang), y: plot.y + r * Math.sin(ang) }, plot)).toBe("NE");
  });
});

// ─── summarizeProject — DIR tag + vastu block ───────────────────

function mkPolyRect(xFt: number, yFt: number, wFt: number, hFt: number) {
  const x0 = xFt * 304.8;
  const y0 = yFt * 304.8;
  const x1 = (xFt + wFt) * 304.8;
  const y1 = (yFt + hFt) * 304.8;
  return {
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  };
}

function mkRoom(
  id: string,
  name: string,
  type: Room["type"],
  xFt: number,
  yFt: number,
  wFt: number,
  hFt: number,
): Room {
  return {
    id,
    name,
    type,
    boundary: mkPolyRect(xFt, yFt, wFt, hFt),
    area_sqm: wFt * hFt * 0.0929,
    perimeter_mm: 2 * (wFt + hFt) * 304.8,
    natural_light_required: true,
    ventilation_required: true,
    label_position: { x: (xFt + wFt / 2) * 304.8, y: (yFt + hFt / 2) * 304.8 },
    wall_ids: [],
  };
}

function mkProject(rooms: Room[], plotW = 40, plotD = 40): FloorPlanProject {
  void plotW;
  void plotD;
  return {
    project_id: "test",
    project_name: "test",
    created_at: new Date().toISOString(),
    units: "mm",
    metadata: {
      architect: "test",
      project_type: "residential",
      wall_thickness_mm: 150,
      paper_size: "A3",
      orientation: "landscape",
      north_angle_deg: 0,
      vastu_compliance: true,
      feng_shui_compliance: false,
      ada_compliance: false,
      nbc_compliance: false,
    },
    floors: [
      {
        floor_level: 0,
        rooms,
        walls: [],
        doors: [],
        windows: [],
      },
    ],
  } as unknown as FloorPlanProject;
}

function mkVastuBrief(plotW = 40, plotD = 40): ArchitectBrief {
  return {
    projectType: "residential",
    plotWidthFt: plotW,
    plotDepthFt: plotD,
    facing: "north",
    styleCues: ["vastu compliant"],
    constraints: [],
    adjacencies: [],
    roomList: [],
  };
}

describe("Phase 2.11.4 — summarizeProject emits DIR tags + vastu block", () => {
  it("includes a (type, DIR) tag in every room line", () => {
    // Pooja in NE corner, Master in SW, Kitchen in SE on a 40×40 plot.
    const rooms = [
      mkRoom("r1", "Pooja Room", "puja_room", 28, 28, 8, 8), // NE
      mkRoom("r2", "Master Bedroom", "master_bedroom", 0, 0, 16, 16), // SW
      mkRoom("r3", "Kitchen", "kitchen", 28, 0, 12, 12), // SE
    ];
    const summary = summarizeProject(mkProject(rooms), mkVastuBrief());
    expect(summary).toMatch(/Pooja Room \(puja_room, NE\):/);
    expect(summary).toMatch(/Master Bedroom \(master_bedroom, SW\):/);
    expect(summary).toMatch(/Kitchen \(kitchen, SE\):/);
  });

  it("appends the VASTU PLACEMENT REFERENCE block when vastu is required", () => {
    const summary = summarizeProject(mkProject([]), mkVastuBrief());
    expect(summary).toMatch(/VASTU PLACEMENT REFERENCE/);
    expect(summary).toMatch(/Pooja.*NE/);
    expect(summary).toMatch(/Master Bedroom.*SW/);
    expect(summary).toMatch(/Kitchen.*SE/);
    expect(summary).toMatch(/Score vastuCompliance/);
  });

  it("omits the VASTU block when vastu is NOT required", () => {
    const brief: ArchitectBrief = { ...mkVastuBrief(), styleCues: ["modern"] };
    const summary = summarizeProject(mkProject([]), brief);
    expect(summary).not.toMatch(/VASTU PLACEMENT REFERENCE/);
  });
});
