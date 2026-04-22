/**
 * Phase 2.11.5 — Stage 6 noDuplicateNames type-vs-name disambiguation.
 *
 * Root cause: the Stage 6 prompt asked "Is every room uniquely named?"
 * without clarifying that the TYPE tag (bedroom, bathroom) can
 * legitimately repeat across rooms. The LLM on the Phase 2.10 E2E
 * penalised "Bedroom 2 and Bedroom 3 share the same internal type
 * tag 'bedroom'" even though both had distinct NAMES, dragging
 * noDuplicateNames to 4/10.
 *
 * Fix (prompt + summary, no new algorithms):
 *   (a) Tool-schema description of noDuplicateNames spells out NAME vs TYPE.
 *   (b) System prompt adds a NAME vs TYPE CLARIFICATION block with an
 *       explicit "three bedrooms all typed 'bedroom' is expected".
 *   (c) summarizeProject emits a deterministic NAME UNIQUENESS stamp —
 *       either "all distinct → score 10" or the actual duplicate names.
 *       Removes the LLM's need to re-derive uniqueness.
 */

import { describe, expect, it } from "vitest";
import { summarizeProject } from "../stage-6-quality";
import type { ArchitectBrief } from "../types";
import type { FloorPlanProject, Room } from "@/types/floor-plan-cad";

function mkPolyRect(x0: number, y0: number, x1: number, y1: number) {
  return {
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  };
}

function mkRoom(id: string, name: string, type: Room["type"]): Room {
  return {
    id,
    name,
    type,
    boundary: mkPolyRect(0, 0, 3000, 3000),
    area_sqm: 9,
    perimeter_mm: 12000,
    natural_light_required: true,
    ventilation_required: true,
    label_position: { x: 1500, y: 1500 },
    wall_ids: [],
  };
}

function mkProject(rooms: Room[]): FloorPlanProject {
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
      vastu_compliance: false,
      feng_shui_compliance: false,
      ada_compliance: false,
      nbc_compliance: false,
    },
    floors: [{ floor_level: 0, rooms, walls: [], doors: [], windows: [] }],
  } as unknown as FloorPlanProject;
}

function mkBrief(): ArchitectBrief {
  return {
    projectType: "residential",
    plotWidthFt: 40,
    plotDepthFt: 40,
    facing: "north",
    styleCues: ["modern"],
    constraints: [],
    adjacencies: [],
    roomList: [],
  };
}

describe("Phase 2.11.5 — NAME UNIQUENESS stamp in summary", () => {
  it("stamps 'all distinct → score 10' when every name is unique (3 bedrooms sharing type)", () => {
    const rooms = [
      mkRoom("r1", "Master Bedroom", "master_bedroom"),
      mkRoom("r2", "Bedroom 2", "bedroom"),
      mkRoom("r3", "Bedroom 3", "bedroom"),
      mkRoom("r4", "Living Room", "living_room"),
    ];
    const summary = summarizeProject(mkProject(rooms), mkBrief());
    expect(summary).toMatch(/NAME UNIQUENESS:.*all 4 room NAMES are distinct/);
    expect(summary).toMatch(/score noDuplicateNames as 10/);
    expect(summary).toMatch(/Shared TYPE tags.*NOT duplicates/);
  });

  it("flags actual duplicate NAMES and instructs a low score", () => {
    const rooms = [
      mkRoom("r1", "Bedroom", "bedroom"),
      mkRoom("r2", "Bedroom", "bedroom"), // same name
      mkRoom("r3", "Kitchen", "kitchen"),
    ];
    const summary = summarizeProject(mkProject(rooms), mkBrief());
    expect(summary).toMatch(/NAME UNIQUENESS: the following NAMES appear more than once/);
    expect(summary).toMatch(/"Bedroom" \(appears 2 times\)/);
    expect(summary).toMatch(/score noDuplicateNames ≤ 4/);
  });

  it("treats trimmed whitespace as the same name for dup detection", () => {
    const rooms = [
      mkRoom("r1", "Bedroom 1", "bedroom"),
      mkRoom("r2", "Bedroom 1 ", "bedroom"), // trailing space → same after trim
      mkRoom("r3", "Kitchen", "kitchen"),
    ];
    const summary = summarizeProject(mkProject(rooms), mkBrief());
    expect(summary).toMatch(/"Bedroom 1" \(appears 2 times\)/);
  });

  it("no-op when rooms list is empty — stamps as all-distinct on 0 rooms", () => {
    const summary = summarizeProject(mkProject([]), mkBrief());
    expect(summary).toMatch(/all 0 room NAMES are distinct/);
  });
});
