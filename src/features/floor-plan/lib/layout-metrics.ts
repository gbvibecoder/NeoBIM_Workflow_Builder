/**
 * layout-metrics.ts
 *
 * Pipeline-agnostic post-solve validator. Takes a generated FloorPlanProject
 * (and optionally the ParsedConstraints it was generated from) and returns
 * honest metrics: efficiency, void area, door coverage, orphan rooms,
 * adjacency satisfaction, dimensional accuracy, plus actionable quality flags.
 *
 * Reads only — never mutates the project.
 */
import type { Door, Floor, FloorPlanProject, Polygon, Room, RoomType } from "@/types/floor-plan-cad";
import type { ParsedConstraints, ParsedRoom } from "./structured-parser";

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ───────────────────────────────────────────────────────────────────────────

export type QualitySeverity = "info" | "warning" | "critical";

export type QualityCode =
  | "LOW_EFFICIENCY"
  | "LARGE_VOIDS"
  | "MISSING_DOORS"
  | "ORPHAN_ROOMS"
  | "AREA_SHORTFALL"
  | "ADJACENCY_GAPS"
  | "DIM_DEVIATION";

export interface QualityFlag {
  severity: QualitySeverity;
  code: QualityCode;
  message: string;
  suggestion: string;
}

export interface DimDeviation {
  room: string;
  axis: "width" | "depth";
  asked_ft: number;
  got_ft: number;
  deviation_pct: number;
}

export interface LayoutMetrics {
  // Area (square feet — the unit users speak in)
  plot_area_sqft: number;
  total_room_area_sqft: number;
  corridor_area_sqft: number;
  void_area_sqft: number;
  efficiency_pct: number;

  // Connectivity
  total_rooms: number;
  rooms_with_doors: number;
  door_coverage_pct: number;
  orphan_rooms: string[];

  // Adjacency (only meaningful when parsedConstraints is supplied)
  required_adjacencies: number;
  satisfied_adjacencies: number;
  adjacency_satisfaction_pct: number;

  // Dimensions (only meaningful when parsedConstraints is supplied with explicit dims)
  dim_deviations: DimDeviation[];
  mean_dim_deviation_pct: number;

  // Overall fidelity
  area_deviation_pct: number;

  // Human-readable issues
  quality_flags: QualityFlag[];
}

// ───────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ───────────────────────────────────────────────────────────────────────────

const SQM_TO_SQFT = 10.7639;
const MM_TO_FT = 1 / 304.8;
// 1 mm² → ft²: (MM_TO_FT)²
const MM2_TO_SQFT = MM_TO_FT * MM_TO_FT;

const CIRCULATION_TYPES: ReadonlySet<RoomType> = new Set([
  "corridor",
  "lobby",
  "foyer",
  "staircase",
  "lift_lobby",
]);

// Corridor proper for the void/efficiency split — foyer + staircase count as
// rooms (they have programmatic value), pure corridor/lobby count as service
// circulation.
const CORRIDOR_ONLY_TYPES: ReadonlySet<RoomType> = new Set([
  "corridor",
  "lobby",
]);

// ───────────────────────────────────────────────────────────────────────────
// GEOMETRY HELPERS
// ───────────────────────────────────────────────────────────────────────────

/** Shoelace polygon area in mm². Returns 0 for degenerate polygons. */
function polygonAreaMm2(poly: Polygon): number {
  const pts = poly.points;
  if (pts.length < 3) return 0;
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    acc += a.x * b.y - b.x * a.y;
  }
  let area = Math.abs(acc) / 2;
  if (poly.holes) {
    for (const hole of poly.holes) {
      let h = 0;
      for (let i = 0; i < hole.length; i++) {
        const a = hole[i];
        const b = hole[(i + 1) % hole.length];
        h += a.x * b.y - b.x * a.y;
      }
      area -= Math.abs(h) / 2;
    }
  }
  return area;
}

/** Bounding box dims of a room polygon, in feet. */
function roomDimsFt(room: Room): { width_ft: number; depth_ft: number } {
  const pts = room.boundary.points;
  if (pts.length === 0) return { width_ft: 0, depth_ft: 0 };
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of pts) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  return {
    width_ft: (xMax - xMin) * MM_TO_FT,
    depth_ft: (yMax - yMin) * MM_TO_FT,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// PLOT-AREA RESOLUTION
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve the plot's "asked-for" area in sqft, in priority order:
 *   1. parsedConstraints.plot.total_built_up_sqft
 *   2. parsedConstraints.plot.width_ft × depth_ft
 *   3. project.metadata.built_up_area_sqm
 *   4. polygon area of the ground floor boundary
 */
function resolvePlotAreaSqft(project: FloorPlanProject, parsed?: ParsedConstraints): number {
  if (parsed?.plot.total_built_up_sqft && parsed.plot.total_built_up_sqft > 0) {
    return parsed.plot.total_built_up_sqft;
  }
  if (parsed?.plot.width_ft && parsed.plot.depth_ft) {
    const a = parsed.plot.width_ft * parsed.plot.depth_ft;
    if (a > 0) return a;
  }
  if (project.metadata.built_up_area_sqm && project.metadata.built_up_area_sqm > 0) {
    return project.metadata.built_up_area_sqm * SQM_TO_SQFT;
  }
  // Fall back to the floor-boundary polygon (sum across floors for multi-floor).
  let totalMm2 = 0;
  for (const f of project.floors) totalMm2 += polygonAreaMm2(f.boundary);
  return totalMm2 * MM2_TO_SQFT;
}

// ───────────────────────────────────────────────────────────────────────────
// CONNECTIVITY: door coverage + orphan detection
// ───────────────────────────────────────────────────────────────────────────

interface ConnectivitySummary {
  rooms_with_doors: number;
  orphan_rooms: string[];
}

function summarizeConnectivity(floor: Floor): ConnectivitySummary {
  if (floor.rooms.length === 0) {
    return { rooms_with_doors: 0, orphan_rooms: [] };
  }

  const roomById = new Map<string, Room>();
  for (const r of floor.rooms) roomById.set(r.id, r);

  // 1. Which rooms are touched by at least one door?
  const touched = new Set<string>();
  // 2. Adjacency map for BFS.
  const adj = new Map<string, Set<string>>();
  for (const r of floor.rooms) adj.set(r.id, new Set());

  for (const door of floor.doors) {
    const [a, b] = door.connects_rooms;
    if (a) touched.add(a);
    if (b) touched.add(b);
    if (a && b && roomById.has(a) && roomById.has(b)) {
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }

  const rooms_with_doors = floor.rooms.filter(r => touched.has(r.id)).length;

  // Find seed for BFS: room that contains the main_entrance door.
  let seedId: string | null = null;
  const mainEntrance = floor.doors.find(
    (d: Door) => d.type === "main_entrance" || d.type === "service_entrance",
  );
  if (mainEntrance) {
    const [a, b] = mainEntrance.connects_rooms;
    seedId = (a && roomById.has(a)) ? a : (b && roomById.has(b)) ? b : null;
  }
  // Fallback: pick the room with the highest door-degree.
  if (!seedId) {
    let best = -1;
    for (const r of floor.rooms) {
      const deg = adj.get(r.id)?.size ?? 0;
      if (deg > best) {
        best = deg;
        seedId = r.id;
      }
    }
  }

  const orphans = new Set<string>(floor.rooms.map(r => r.id));
  if (seedId) {
    const visited = new Set<string>([seedId]);
    const queue: string[] = [seedId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      orphans.delete(cur);
      for (const next of adj.get(cur) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }

  // A room is "orphan" if it is unreachable from the entrance via doors.
  // Rooms that simply have zero doors are also orphans by this definition,
  // since they cannot be reached.
  return {
    rooms_with_doors,
    orphan_rooms: floor.rooms.filter(r => orphans.has(r.id)).map(r => r.name),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// PARSED-ROOM ↔ PROJECT-ROOM MATCHING
// ───────────────────────────────────────────────────────────────────────────

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findProjectRoom(parsed: ParsedRoom, allRooms: Room[]): Room | null {
  const target = normalizeName(parsed.name);
  // Exact normalized match first.
  const exact = allRooms.find(r => normalizeName(r.name) === target);
  if (exact) return exact;
  // Substring either direction.
  const partial = allRooms.find(r => {
    const n = normalizeName(r.name);
    return n.includes(target) || target.includes(n);
  });
  if (partial) return partial;
  // Token overlap fallback.
  const targetTokens = new Set(target.split(" ").filter(t => t.length >= 3));
  if (targetTokens.size === 0) return null;
  let best: { room: Room; score: number } | null = null;
  for (const r of allRooms) {
    const tokens = normalizeName(r.name).split(" ").filter(t => t.length >= 3);
    let score = 0;
    for (const t of tokens) if (targetTokens.has(t)) score++;
    if (score > 0 && (!best || score > best.score)) best = { room: r, score };
  }
  return best?.room ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// ADJACENCY SATISFACTION
// ───────────────────────────────────────────────────────────────────────────

function summarizeAdjacency(
  parsed: ParsedConstraints,
  parsedToProject: Map<string, Room>,
  allDoors: Door[],
): { required: number; satisfied: number } {
  if (parsed.adjacency_pairs.length === 0) {
    return { required: 0, satisfied: 0 };
  }

  const doorPairs = new Set<string>();
  for (const d of allDoors) {
    const [a, b] = d.connects_rooms;
    if (a && b) {
      const k = [a, b].sort().join("|");
      doorPairs.add(k);
    }
  }

  let satisfied = 0;
  for (const adj of parsed.adjacency_pairs) {
    const ra = parsedToProject.get(adj.room_a_id);
    const rb = parsedToProject.get(adj.room_b_id);
    if (!ra || !rb) continue;
    const k = [ra.id, rb.id].sort().join("|");
    if (doorPairs.has(k)) satisfied++;
  }

  return { required: parsed.adjacency_pairs.length, satisfied };
}

// ───────────────────────────────────────────────────────────────────────────
// DIM DEVIATIONS
// ───────────────────────────────────────────────────────────────────────────

function computeDimDeviations(
  parsed: ParsedConstraints,
  parsedToProject: Map<string, Room>,
): DimDeviation[] {
  const out: DimDeviation[] = [];
  for (const pr of parsed.rooms) {
    if (pr.dim_width_ft == null || pr.dim_depth_ft == null) continue;
    const proj = parsedToProject.get(pr.id);
    if (!proj) continue;
    const { width_ft, depth_ft } = roomDimsFt(proj);
    // The solver may rotate a room, so compare unsorted-by-axis to the
    // closest interpretation.
    const askedMajor = Math.max(pr.dim_width_ft, pr.dim_depth_ft);
    const askedMinor = Math.min(pr.dim_width_ft, pr.dim_depth_ft);
    const gotMajor = Math.max(width_ft, depth_ft);
    const gotMinor = Math.min(width_ft, depth_ft);

    const devMajor = askedMajor > 0 ? Math.abs(gotMajor - askedMajor) / askedMajor * 100 : 0;
    const devMinor = askedMinor > 0 ? Math.abs(gotMinor - askedMinor) / askedMinor * 100 : 0;

    out.push({
      room: pr.name,
      axis: "width",
      asked_ft: Math.round(askedMajor * 10) / 10,
      got_ft: Math.round(gotMajor * 10) / 10,
      deviation_pct: Math.round(devMajor * 10) / 10,
    });
    out.push({
      room: pr.name,
      axis: "depth",
      asked_ft: Math.round(askedMinor * 10) / 10,
      got_ft: Math.round(gotMinor * 10) / 10,
      deviation_pct: Math.round(devMinor * 10) / 10,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// QUALITY FLAGS
// ───────────────────────────────────────────────────────────────────────────

function buildQualityFlags(m: Omit<LayoutMetrics, "quality_flags">): QualityFlag[] {
  const flags: QualityFlag[] = [];

  if (m.efficiency_pct < 70) {
    flags.push({
      severity: "critical",
      code: "LOW_EFFICIENCY",
      message: `Plot is only ${m.efficiency_pct.toFixed(0)}% used — industry standard is 75–85%.`,
      suggestion: "Add a hallway, larger rooms, or extra rooms (utility, store) to fill the slack.",
    });
  }

  if (m.void_area_sqft > 300) {
    flags.push({
      severity: "warning",
      code: "LARGE_VOIDS",
      message: `${Math.round(m.void_area_sqft)} sqft of empty space inside the plot.`,
      suggestion: "Increase room sizes or add a corridor / utility room to reclaim the voids.",
    });
  }

  if (m.door_coverage_pct < 80) {
    const missing = m.total_rooms - m.rooms_with_doors;
    flags.push({
      severity: "critical",
      code: "MISSING_DOORS",
      message: `Only ${m.rooms_with_doors} of ${m.total_rooms} rooms have doors — ${missing} room(s) are unreachable.`,
      suggestion: "Try a simpler prompt with fewer rooms, or move rooms together so they share walls where doors can be placed.",
    });
  }

  if (m.orphan_rooms.length > 0) {
    flags.push({
      severity: "critical",
      code: "ORPHAN_ROOMS",
      message: `${m.orphan_rooms.length} orphan room(s): ${m.orphan_rooms.slice(0, 5).join(", ")}${m.orphan_rooms.length > 5 ? "…" : ""}`,
      suggestion: "Orphan rooms can't be reached from the entrance. Drag them next to a connected room or regenerate.",
    });
  }

  if (m.area_deviation_pct > 20) {
    flags.push({
      severity: "warning",
      code: "AREA_SHORTFALL",
      message: `Generated total area is ${m.area_deviation_pct.toFixed(0)}% off from what you asked for.`,
      suggestion: "Either reduce the plot size you asked for, or add more rooms / larger rooms to match.",
    });
  }

  if (m.required_adjacencies > 0 && m.adjacency_satisfaction_pct < 80) {
    const unmet = m.required_adjacencies - m.satisfied_adjacencies;
    flags.push({
      severity: "warning",
      code: "ADJACENCY_GAPS",
      message: `${unmet} of ${m.required_adjacencies} adjacency request(s) not satisfied (${m.adjacency_satisfaction_pct.toFixed(0)}% met).`,
      suggestion: "Drag rooms closer or regenerate — some rooms you wanted next to each other are not.",
    });
  }

  if (m.dim_deviations.length > 0 && m.mean_dim_deviation_pct > 10) {
    flags.push({
      severity: "warning",
      code: "DIM_DEVIATION",
      message: `Average room-dimension deviation is ${m.mean_dim_deviation_pct.toFixed(0)}% from your spec.`,
      suggestion: "Edit individual rooms in the editor, or simplify the prompt to give the solver more slack.",
    });
  }

  return flags;
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC ENTRY POINT
// ───────────────────────────────────────────────────────────────────────────

export function computeLayoutMetrics(
  project: FloorPlanProject,
  parsedConstraints?: ParsedConstraints,
): LayoutMetrics {
  const allRooms: Room[] = project.floors.flatMap(f => f.rooms);
  const allDoors: Door[] = project.floors.flatMap(f => f.doors);

  // Areas
  const plotAreaSqft = resolvePlotAreaSqft(project, parsedConstraints);
  let totalRoomAreaSqft = 0;
  let corridorAreaSqft = 0;
  for (const r of allRooms) {
    const sqft = r.area_sqm * SQM_TO_SQFT;
    if (CORRIDOR_ONLY_TYPES.has(r.type)) {
      corridorAreaSqft += sqft;
    } else {
      totalRoomAreaSqft += sqft;
    }
  }
  const occupied = totalRoomAreaSqft + corridorAreaSqft;
  const voidAreaSqft = Math.max(0, plotAreaSqft - occupied);
  const efficiencyPct = plotAreaSqft > 0 ? Math.min(100, (occupied / plotAreaSqft) * 100) : 0;

  // Connectivity (per-floor sum)
  let roomsWithDoors = 0;
  const orphanRooms: string[] = [];
  for (const f of project.floors) {
    const c = summarizeConnectivity(f);
    roomsWithDoors += c.rooms_with_doors;
    orphanRooms.push(...c.orphan_rooms);
  }
  const totalRooms = allRooms.length;
  const doorCoveragePct = totalRooms > 0 ? (roomsWithDoors / totalRooms) * 100 : 100;

  // Parsed-constraints-dependent metrics
  let requiredAdj = 0;
  let satisfiedAdj = 0;
  let dimDeviations: DimDeviation[] = [];
  let meanDimDev = 0;
  let areaDeviationPct = 0;

  if (parsedConstraints) {
    const parsedToProject = new Map<string, Room>();
    for (const pr of parsedConstraints.rooms) {
      const match = findProjectRoom(pr, allRooms);
      if (match) parsedToProject.set(pr.id, match);
    }

    const adj = summarizeAdjacency(parsedConstraints, parsedToProject, allDoors);
    requiredAdj = adj.required;
    satisfiedAdj = adj.satisfied;

    dimDeviations = computeDimDeviations(parsedConstraints, parsedToProject);
    if (dimDeviations.length > 0) {
      const sum = dimDeviations.reduce((s, d) => s + d.deviation_pct, 0);
      meanDimDev = sum / dimDeviations.length;
    }

    const askedTotal =
      parsedConstraints.plot.total_built_up_sqft ??
      ((parsedConstraints.plot.width_ft ?? 0) * (parsedConstraints.plot.depth_ft ?? 0));
    if (askedTotal > 0) {
      areaDeviationPct = Math.abs(occupied - askedTotal) / askedTotal * 100;
    }
  } else if (project.metadata.built_up_area_sqm && project.metadata.built_up_area_sqm > 0) {
    const askedTotal = project.metadata.built_up_area_sqm * SQM_TO_SQFT;
    areaDeviationPct = Math.abs(occupied - askedTotal) / askedTotal * 100;
  }

  const adjacencySatisfactionPct =
    requiredAdj > 0 ? (satisfiedAdj / requiredAdj) * 100 : 100;

  const partial: Omit<LayoutMetrics, "quality_flags"> = {
    plot_area_sqft: Math.round(plotAreaSqft),
    total_room_area_sqft: Math.round(totalRoomAreaSqft),
    corridor_area_sqft: Math.round(corridorAreaSqft),
    void_area_sqft: Math.round(voidAreaSqft),
    efficiency_pct: Math.round(efficiencyPct * 10) / 10,
    total_rooms: totalRooms,
    rooms_with_doors: roomsWithDoors,
    door_coverage_pct: Math.round(doorCoveragePct * 10) / 10,
    orphan_rooms: orphanRooms,
    required_adjacencies: requiredAdj,
    satisfied_adjacencies: satisfiedAdj,
    adjacency_satisfaction_pct: Math.round(adjacencySatisfactionPct * 10) / 10,
    dim_deviations: dimDeviations,
    mean_dim_deviation_pct: Math.round(meanDimDev * 10) / 10,
    area_deviation_pct: Math.round(areaDeviationPct * 10) / 10,
  };

  return {
    ...partial,
    quality_flags: buildQualityFlags(partial),
  };
}

// Helper used by Task 5 banner: aggregate severity across the flag list.
export function topFlagSeverity(flags: QualityFlag[]): QualitySeverity | null {
  if (flags.some(f => f.severity === "critical")) return "critical";
  if (flags.some(f => f.severity === "warning")) return "warning";
  if (flags.some(f => f.severity === "info")) return "info";
  return null;
}

// Used to flag CIRCULATION_TYPES when consumers want to render a "service"
// breakdown later — exported for parity with design-quality-checker.
export { CIRCULATION_TYPES };

// ───────────────────────────────────────────────────────────────────────────
// HONEST SCORE
// ───────────────────────────────────────────────────────────────────────────

export type HonestGrade = "A" | "B" | "C" | "D" | "F";

export interface HonestScore {
  score: number;       // 0–100
  grade: HonestGrade;
  rationale: string[]; // human-readable contributions ("efficiency 56% → -25")
}

/**
 * Phase 1 honest scoring.
 *
 * Independent of `design-quality-checker.computeDesignScore` (which only
 * measures design heuristics like privacy and corridor ratio). This score
 * REWARDS plot-level fidelity:
 *   - void / efficiency
 *   - door coverage
 *   - orphan rooms (cap penalty so a layout doesn't go negative)
 *   - area / dim deviation against the user spec
 *   - adjacency satisfaction
 *
 * It collapses the metric severities AND adds a few graded penalties so
 * "everything just barely passes" doesn't read as 100/100.
 */
export function computeHonestScore(metrics: LayoutMetrics): HonestScore {
  const rationale: string[] = [];
  let score = 100;

  // Efficiency band — graded, not just on/off.
  if (metrics.efficiency_pct < 50) {
    score -= 35;
    rationale.push(`Efficiency ${metrics.efficiency_pct}% (<50): -35`);
  } else if (metrics.efficiency_pct < 70) {
    score -= 20;
    rationale.push(`Efficiency ${metrics.efficiency_pct}% (<70): -20`);
  } else if (metrics.efficiency_pct < 80) {
    score -= 8;
    rationale.push(`Efficiency ${metrics.efficiency_pct}% (<80): -8`);
  }

  // Door coverage — a layout where rooms can't be reached is broken.
  if (metrics.total_rooms > 0) {
    if (metrics.door_coverage_pct < 60) {
      score -= 35;
      rationale.push(`Door coverage ${metrics.door_coverage_pct}% (<60): -35`);
    } else if (metrics.door_coverage_pct < 80) {
      score -= 20;
      rationale.push(`Door coverage ${metrics.door_coverage_pct}% (<80): -20`);
    } else if (metrics.door_coverage_pct < 95) {
      score -= 10;
      rationale.push(`Door coverage ${metrics.door_coverage_pct}% (<95): -10`);
    }
    // Bonus: 100% coverage = no penalty (reward fully connected plans)
  }

  // Orphan rooms — unreachable rooms are the WORST defect. An architect
  // would never approve a room you can't walk to. Heavy penalty.
  if (metrics.orphan_rooms.length > 0) {
    const penalty = Math.min(45, metrics.orphan_rooms.length * 15);
    score -= penalty;
    rationale.push(`${metrics.orphan_rooms.length} orphan room(s): -${penalty}`);
  }

  // Voids — a small amount is OK, large voids signal layout failure.
  if (metrics.void_area_sqft > 600) {
    score -= 10;
    rationale.push(`Voids ${metrics.void_area_sqft} sqft (>600): -10`);
  } else if (metrics.void_area_sqft > 300) {
    score -= 5;
    rationale.push(`Voids ${metrics.void_area_sqft} sqft (>300): -5`);
  }

  // Area fidelity vs user spec.
  if (metrics.area_deviation_pct > 30) {
    score -= 10;
    rationale.push(`Area deviation ${metrics.area_deviation_pct}% (>30): -10`);
  } else if (metrics.area_deviation_pct > 15) {
    score -= 5;
    rationale.push(`Area deviation ${metrics.area_deviation_pct}% (>15): -5`);
  }

  // Adjacency satisfaction (only if there were any required adjacencies).
  if (metrics.required_adjacencies > 0) {
    if (metrics.adjacency_satisfaction_pct < 50) {
      score -= 12;
      rationale.push(`Adjacency satisfaction ${metrics.adjacency_satisfaction_pct}% (<50): -12`);
    } else if (metrics.adjacency_satisfaction_pct < 80) {
      score -= 6;
      rationale.push(`Adjacency satisfaction ${metrics.adjacency_satisfaction_pct}% (<80): -6`);
    }
  }

  // Dim deviation (only if SPECIFIC prompt with explicit dims).
  if (metrics.dim_deviations.length > 0) {
    if (metrics.mean_dim_deviation_pct > 20) {
      score -= 8;
      rationale.push(`Mean dim deviation ${metrics.mean_dim_deviation_pct}% (>20): -8`);
    } else if (metrics.mean_dim_deviation_pct > 10) {
      score -= 4;
      rationale.push(`Mean dim deviation ${metrics.mean_dim_deviation_pct}% (>10): -4`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: gradeFor(score), rationale };
}

function gradeFor(score: number): HonestGrade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}
