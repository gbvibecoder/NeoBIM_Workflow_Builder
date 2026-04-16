import type { FloorPlanProject, Floor, Room, Polygon, Point } from "@/types/floor-plan-cad";
import { parseConstraints, type ParsedConstraints, type ParsedRoom } from "./structured-parser";
import { detectInfeasibility, type InfeasibilityReport } from "./infeasibility-detector";
import { solveMandalaCSP, type MandalaAssignment, type CellIdx, cellCoords } from "./csp-solver";
import { logger } from "@/lib/logger";

export type PipelineBStage = "parse" | "infeasibility" | "mandala" | "placement" | "complete";

export interface PipelineBResult {
  project: FloorPlanProject | null;
  pipelineUsed: "B-mandala" | "B-stub" | "B-unsat";
  relaxationsApplied: string[];
  infeasibilityReason: string | null;
  infeasibilityKind: InfeasibilityReport["kind"] | null;
  cspConflict: string | null;
  cspRuleIds: string[];
  constraintsExtracted: number;
  parseAuditAttempts: number;
  mandalaAssignments: MandalaAssignment[] | null;
  timings: {
    parse_ms: number;
    detector_ms: number;
    csp_ms: number;
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

function directionFromCell(cell: CellIdx): "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "CENTER" {
  const labels = ["NW", "N", "NE", "W", "CENTER", "E", "SW", "S", "SE"] as const;
  return labels[cell];
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
 * Mandala placement: each room placed within its CSP-assigned mandala cell.
 * Plot is divided into a 3x3 grid; each cell holds one or more rooms.
 * Multiple rooms in the same cell are packed along the cell's width axis
 * (overlaps possible on single-cell-width rooms — Stage 3B will resolve).
 *
 * Falls back to sequential stub packing when assignments is null (pre-CSP).
 */
function placementProject(
  constraints: ParsedConstraints,
  projectName: string,
  assignments: MandalaAssignment[] | null,
): FloorPlanProject {
  const plotWidthFt = constraints.plot.width_ft ?? 50;
  const plotDepthFt = constraints.plot.depth_ft ?? plotWidthFt;

  const rooms: Room[] = [];

  if (assignments) {
    // Group rooms by mandala cell
    const byCell = new Map<CellIdx, { room: ParsedRoom; dims: [number, number] }[]>();
    const byId = new Map(constraints.rooms.map(r => [r.id, r]));
    for (const a of assignments) {
      const room = byId.get(a.room_id);
      if (!room) continue;
      const list = byCell.get(a.cell) ?? [];
      list.push({ room, dims: roomDimsFt(room) });
      byCell.set(a.cell, list);
    }

    const cellWidthFt = plotWidthFt / 3;
    const cellDepthFt = plotDepthFt / 3;

    for (const [cellIdx, list] of byCell.entries()) {
      const { col, row } = cellCoords(cellIdx);
      const cellOriginXFt = col * cellWidthFt;
      const cellOriginYFt = row * cellDepthFt;

      // Sort cell's rooms by area descending (bigger anchors the cell)
      list.sort((a, b) => b.dims[0] * b.dims[1] - a.dims[0] * a.dims[1]);

      let packX = 0;
      let packY = 0;
      let rowMax = 0;
      for (const { room, dims } of list) {
        const [wFt, dFt] = dims;
        if (packX + wFt > cellWidthFt && packX > 0) {
          packX = 0;
          packY += rowMax + 0.5;
          rowMax = 0;
        }
        const xMm = (cellOriginXFt + packX) * FT_TO_MM;
        const yMm = (cellOriginYFt + packY) * FT_TO_MM;
        const wMm = wFt * FT_TO_MM;
        const dMm = dFt * FT_TO_MM;
        rooms.push({
          id: room.id || `room-${rooms.length}`,
          name: room.name,
          type: functionToRoomType(room.function),
          boundary: buildStubPolygon(xMm, yMm, wMm, dMm),
          area_sqm: wFt * dFt * 0.092903,
          perimeter_mm: 2 * (wMm + dMm),
          natural_light_required: !["bathroom", "master_bathroom", "powder_room", "store", "utility"].includes(room.function),
          ventilation_required: true,
          label_position: { x: xMm + wMm / 2, y: yMm + dMm / 2 },
          wall_ids: [],
          vastu_direction: directionFromCell(cellIdx),
        });
        packX += wFt + 0.5;
        rowMax = Math.max(rowMax, dFt);
      }
    }
  } else {
    // Legacy stub path (retained for B-unsat fallback visualization)
    let cursorX = 0;
    let cursorY = 0;
    let rowMaxDepth = 0;
    const sorted = [...constraints.rooms].sort((a, b) => {
      const [aw, ad] = roomDimsFt(a);
      const [bw, bd] = roomDimsFt(b);
      return bw * bd - aw * ad;
    });
    for (const r of sorted) {
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
      rooms.push({
        id: r.id || `stub-room-${rooms.length}`,
        name: r.name,
        type: functionToRoomType(r.function),
        boundary: buildStubPolygon(xMm, yMm, wMm, dMm),
        area_sqm: wFt * dFt * 0.092903,
        perimeter_mm: 2 * (wMm + dMm),
        natural_light_required: !["bathroom", "master_bathroom", "powder_room", "store", "utility"].includes(r.function),
        ventilation_required: true,
        label_position: { x: xMm + wMm / 2, y: yMm + dMm / 2 },
        wall_ids: [],
      });
      cursorX += wFt + 1;
      rowMaxDepth = Math.max(rowMaxDepth, dFt);
    }
  }

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
  let csp_ms = 0;
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
      cspConflict: null,
      cspRuleIds: [],
      constraintsExtracted: 0,
      parseAuditAttempts: 0,
      mandalaAssignments: null,
      timings: { parse_ms, detector_ms: 0, csp_ms: 0, placement_ms: 0, total_ms: Date.now() - totalStart },
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
      cspConflict: null,
      cspRuleIds: [],
      constraintsExtracted: constraints.rooms.length,
      parseAuditAttempts,
      mandalaAssignments: null,
      timings: { parse_ms, detector_ms, csp_ms: 0, placement_ms: 0, total_ms: Date.now() - totalStart },
      error: null,
    };
  }

  // ── Stage 3A: Mandala CSP ──
  const cspStart = Date.now();
  const relaxationsApplied: string[] = [];
  let solveResult = solveMandalaCSP(constraints);
  if (!solveResult.feasible && constraints.vastu_required) {
    logger.debug(`[PIPELINE-B] CSP UNSAT with vastu_required — retrying with vastu relaxed`);
    relaxationsApplied.push("vastu_required: relaxed (Stage 3A infeasible with Vastu hard rules)");
    solveResult = solveMandalaCSP(constraints, { vastuRequired: false });
  }
  csp_ms = Date.now() - cspStart;

  if (!solveResult.feasible) {
    logger.debug(`[PIPELINE-B] CSP UNSAT (final): ${solveResult.conflict?.human_reason}`);
    return {
      project: null,
      pipelineUsed: "B-unsat",
      relaxationsApplied,
      infeasibilityReason: solveResult.conflict?.human_reason ?? "CSP_UNSAT_STAGE_3A",
      infeasibilityKind: null,
      cspConflict: solveResult.conflict?.human_reason ?? null,
      cspRuleIds: solveResult.conflict?.rule_ids ?? [],
      constraintsExtracted: constraints.rooms.length,
      parseAuditAttempts,
      mandalaAssignments: null,
      timings: { parse_ms, detector_ms, csp_ms, placement_ms: 0, total_ms: Date.now() - totalStart },
      error: null,
    };
  }

  logger.debug(`[PIPELINE-B] CSP feasible: ${solveResult.assignments.length} mandala assignments in ${solveResult.iterations} iters, ${solveResult.elapsed_ms}ms, vastu_applied=${solveResult.vastu_applied}`);

  const placementStart = Date.now();
  const projectName = constraints.plot.facing
    ? `${constraints.plot.facing}-facing plan`
    : "Pipeline B plan";
  const project = placementProject(constraints, projectName, solveResult.assignments);
  placement_ms = Date.now() - placementStart;

  return {
    project,
    pipelineUsed: "B-mandala",
    relaxationsApplied,
    infeasibilityReason: null,
    infeasibilityKind: null,
    cspConflict: null,
    cspRuleIds: [],
    constraintsExtracted: constraints.rooms.length,
    parseAuditAttempts,
    mandalaAssignments: solveResult.assignments,
    timings: { parse_ms, detector_ms, csp_ms, placement_ms, total_ms: Date.now() - totalStart },
    error: null,
  };
}
