import type { FloorPlanProject, Floor, Room, Polygon, Point } from "@/types/floor-plan-cad";
import { parseConstraints, type ParsedConstraints, type ParsedRoom } from "./structured-parser";
import { detectInfeasibility, type InfeasibilityReport } from "./infeasibility-detector";
import { logger } from "@/lib/logger";

export type PipelineBStage = "parse" | "infeasibility" | "stub-placement" | "complete";

export interface PipelineBResult {
  project: FloorPlanProject | null;
  pipelineUsed: "B-stub" | "B-unsat";
  relaxationsApplied: string[];
  infeasibilityReason: string | null;
  infeasibilityKind: InfeasibilityReport["kind"] | null;
  constraintsExtracted: number;
  parseAuditAttempts: number;
  timings: {
    parse_ms: number;
    detector_ms: number;
    placement_ms: number;
    total_ms: number;
  };
  error: string | null;
}

const FT_TO_MM = 304.8;

const DEFAULT_DIMS_FT: Record<string, [number, number]> = {
  bedroom: [12, 11],
  master_bedroom: [14, 13],
  guest_bedroom: [12, 11],
  kids_bedroom: [11, 10],
  living: [16, 13],
  dining: [12, 11],
  kitchen: [10, 9],
  bathroom: [7, 5],
  master_bathroom: [9, 6],
  powder_room: [5, 4],
  walk_in_wardrobe: [7, 5],
  walk_in_closet: [7, 5],
  foyer: [8, 7],
  porch: [9, 6],
  verandah: [12, 8],
  balcony: [10, 4],
  corridor: [12, 4],
  staircase: [10, 8],
  utility: [6, 5],
  store: [6, 5],
  pooja: [5, 4],
  study: [10, 9],
  servant_quarter: [9, 8],
  other: [10, 8],
};

function roomDimsFt(r: ParsedRoom): [number, number] {
  if (r.dim_width_ft != null && r.dim_depth_ft != null) {
    return [r.dim_width_ft, r.dim_depth_ft];
  }
  return DEFAULT_DIMS_FT[r.function] ?? [10, 8];
}

function buildStubPolygon(xMm: number, yMm: number, wMm: number, dMm: number): Polygon {
  const points: Point[] = [
    { x: xMm, y: yMm },
    { x: xMm + wMm, y: yMm },
    { x: xMm + wMm, y: yMm + dMm },
    { x: xMm, y: yMm + dMm },
  ];
  return { points };
}

function functionToRoomType(fn: string): Room["type"] {
  const map: Record<string, Room["type"]> = {
    bedroom: "bedroom",
    master_bedroom: "master_bedroom",
    guest_bedroom: "guest_bedroom",
    kids_bedroom: "bedroom",
    living: "living_room",
    dining: "dining_room",
    kitchen: "kitchen",
    bathroom: "bathroom",
    master_bathroom: "bathroom",
    powder_room: "toilet",
    walk_in_wardrobe: "walk_in_closet",
    walk_in_closet: "walk_in_closet",
    foyer: "foyer",
    porch: "verandah",
    verandah: "verandah",
    balcony: "balcony",
    corridor: "corridor",
    staircase: "staircase",
    utility: "utility",
    store: "store_room",
    pooja: "puja_room",
    study: "study",
    servant_quarter: "servant_quarter",
    other: "custom",
  };
  return map[fn] ?? "custom";
}

/**
 * Stub placement: pack rooms in a grid from (0,0) without solving. Renderable
 * but obviously unsolved — purpose is to validate the request->response contract
 * and exercise downstream rendering code before the CSP solver lands.
 */
function stubPlacementProject(constraints: ParsedConstraints, projectName: string): FloorPlanProject {
  const sortedRooms = [...constraints.rooms].sort((a, b) => {
    const [aw, ad] = roomDimsFt(a);
    const [bw, bd] = roomDimsFt(b);
    return bw * bd - aw * ad;
  });

  const plotWidthFt = constraints.plot.width_ft ?? 50;

  let cursorX = 0;
  let cursorY = 0;
  let rowMaxDepth = 0;

  const rooms: Room[] = sortedRooms.map((r, idx) => {
    const [wFt, dFt] = roomDimsFt(r);
    if (cursorX + wFt > plotWidthFt) {
      cursorX = 0;
      cursorY += rowMaxDepth + 1;
      rowMaxDepth = 0;
    }
    const xMm = cursorX * FT_TO_MM;
    const yMm = cursorY * FT_TO_MM;
    const wMm = wFt * FT_TO_MM;
    const dMm = dFt * FT_TO_MM;

    cursorX += wFt + 1;
    rowMaxDepth = Math.max(rowMaxDepth, dFt);

    const room: Room = {
      id: r.id || `stub-room-${idx}`,
      name: r.name,
      type: functionToRoomType(r.function),
      boundary: buildStubPolygon(xMm, yMm, wMm, dMm),
      area_sqm: (wFt * dFt) * 0.092903,
      perimeter_mm: 2 * (wMm + dMm),
      natural_light_required: !["bathroom", "master_bathroom", "powder_room", "store", "utility"].includes(r.function),
      ventilation_required: true,
      label_position: { x: xMm + wMm / 2, y: yMm + dMm / 2 },
      wall_ids: [],
    };
    return room;
  });

  const totalWidthMm = Math.max(...rooms.flatMap(r => r.boundary.points.map(p => p.x)));
  const totalDepthMm = Math.max(...rooms.flatMap(r => r.boundary.points.map(p => p.y)));
  const floorBoundary: Polygon = {
    points: [
      { x: 0, y: 0 },
      { x: totalWidthMm, y: 0 },
      { x: totalWidthMm, y: totalDepthMm },
      { x: 0, y: totalDepthMm },
    ],
  };

  const floor: Floor = {
    id: "floor-0",
    name: "Ground Floor",
    level: 0,
    floor_to_floor_height_mm: 3000,
    slab_thickness_mm: 150,
    boundary: floorBoundary,
    walls: [],
    rooms,
    doors: [],
    windows: [],
    stairs: [],
    columns: [],
    furniture: [],
    fixtures: [],
    annotations: [],
    dimensions: [],
    zones: [],
  };

  const totalAreaSqm = rooms.reduce((s, r) => s + r.area_sqm, 0);

  return {
    id: `pipelineB-stub-${Date.now()}`,
    name: projectName,
    version: "1.0.0",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {
      project_type: "residential",
      building_type: "apartment",
      built_up_area_sqm: totalAreaSqm,
      carpet_area_sqm: totalAreaSqm * 0.85,
      num_floors: 1,
      generation_model: "pipeline-b-stub",
      generation_timestamp: new Date().toISOString(),
    },
    settings: {
      units: "metric",
      display_unit: "ft",
      scale: "1:100",
      grid_size_mm: 100,
      wall_thickness_mm: 150,
      paper_size: "A3",
      orientation: "landscape",
      north_angle_deg: 0,
      vastu_compliance: false,
      feng_shui_compliance: false,
      ada_compliance: false,
      nbc_compliance: false,
    },
    floors: [floor],
  };
}

export async function runPipelineB(prompt: string, apiKey: string): Promise<PipelineBResult> {
  const totalStart = Date.now();
  let parse_ms = 0;
  let detector_ms = 0;
  let placement_ms = 0;

  const parseStart = Date.now();
  let constraints: ParsedConstraints;
  let parseAuditAttempts = 0;
  try {
    const result = await parseConstraints(prompt, apiKey);
    constraints = result.constraints;
    parseAuditAttempts = result.audit_attempts;
  } catch (err) {
    parse_ms = Date.now() - parseStart;
    return {
      project: null,
      pipelineUsed: "B-unsat",
      relaxationsApplied: [],
      infeasibilityReason: null,
      infeasibilityKind: null,
      constraintsExtracted: 0,
      parseAuditAttempts: 0,
      timings: { parse_ms, detector_ms: 0, placement_ms: 0, total_ms: Date.now() - totalStart },
      error: `parser_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  parse_ms = Date.now() - parseStart;
  logger.debug(`[PIPELINE-B] Parser: ${constraints.rooms.length} rooms, budget=${constraints.constraint_budget.total}, attempts=${parseAuditAttempts}`);

  const detectorStart = Date.now();
  const infeasibility = detectInfeasibility(constraints);
  detector_ms = Date.now() - detectorStart;

  if (!infeasibility.feasible) {
    logger.debug(`[PIPELINE-B] Infeasible: ${infeasibility.kind} — ${infeasibility.reason}`);
    return {
      project: null,
      pipelineUsed: "B-unsat",
      relaxationsApplied: [],
      infeasibilityReason: infeasibility.reason ?? "infeasible",
      infeasibilityKind: infeasibility.kind ?? null,
      constraintsExtracted: constraints.rooms.length,
      parseAuditAttempts,
      timings: { parse_ms, detector_ms, placement_ms: 0, total_ms: Date.now() - totalStart },
      error: null,
    };
  }

  const placementStart = Date.now();
  const projectName = constraints.plot.facing
    ? `${constraints.plot.facing}-facing plan`
    : "Pipeline B plan";
  const project = stubPlacementProject(constraints, projectName);
  placement_ms = Date.now() - placementStart;

  return {
    project,
    pipelineUsed: "B-stub",
    relaxationsApplied: ["stub-placement: rooms placed without solver — Day 3 skeleton"],
    infeasibilityReason: null,
    infeasibilityKind: null,
    constraintsExtracted: constraints.rooms.length,
    parseAuditAttempts,
    timings: { parse_ms, detector_ms, placement_ms, total_ms: Date.now() - totalStart },
    error: null,
  };
}
