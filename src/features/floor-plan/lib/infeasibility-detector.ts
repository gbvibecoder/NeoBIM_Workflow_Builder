import type { ParsedConstraints, ParsedRoom, CenterDirection } from "./structured-parser";

export type InfeasibilityKind =
  | "AREA_IMPOSSIBLE"
  | "ROOM_TOO_BIG"
  | "POSITION_CONFLICT"
  | "VASTU_CONFLICT";

/**
 * Non-blocking signals from the detector. Warnings DO NOT cause a 422 — the
 * pipeline still runs. They are surfaced through the API response so the
 * client UI can show them alongside layoutMetrics quality flags.
 */
export type InfeasibilityWarningKind = "UNDER_FULL";

export interface InfeasibilityWarning {
  kind: InfeasibilityWarningKind;
  severity: "info" | "warning";
  message: string;
  details: Record<string, unknown>;
}

export interface InfeasibilityReport {
  feasible: boolean;
  kind?: InfeasibilityKind;
  reason?: string;
  details?: Record<string, unknown>;
  /** Non-blocking warnings collected even when feasible=true. */
  warnings?: InfeasibilityWarning[];
}

interface HardVastuRule {
  applies_to_function: (room: ParsedRoom) => boolean;
  forbidden: CenterDirection[];
  rule_id: string;
}

const HARD_VASTU_RULES: HardVastuRule[] = [
  {
    rule_id: "V-RP-001",
    applies_to_function: r => r.function === "master_bedroom",
    forbidden: ["NE", "SE"],
  },
  {
    rule_id: "V-RP-002",
    applies_to_function: r => r.function === "kitchen",
    forbidden: ["NE", "SW", "N"],
  },
  {
    rule_id: "V-RP-005",
    applies_to_function: r => r.function === "pooja",
    forbidden: ["S", "SW", "SE", "W"],
  },
  {
    rule_id: "V-RP-012",
    applies_to_function: r => r.function === "staircase",
    forbidden: ["CENTER", "NE"],
  },
  {
    rule_id: "V-EL-003",
    applies_to_function: r => ["kitchen", "bathroom", "master_bathroom", "powder_room", "staircase", "store"].includes(r.function),
    forbidden: ["CENTER"],
  },
];

const DEFAULT_ROOM_AREA_SQFT: Partial<Record<string, number>> = {
  bedroom: 120,
  master_bedroom: 180,
  guest_bedroom: 130,
  kids_bedroom: 110,
  living: 220,
  dining: 130,
  kitchen: 100,
  bathroom: 45,
  master_bathroom: 60,
  powder_room: 30,
  walk_in_wardrobe: 50,
  walk_in_closet: 50,
  foyer: 60,
  porch: 60,
  verandah: 100,
  balcony: 50,
  corridor: 80,
  staircase: 100,
  utility: 40,
  store: 40,
  pooja: 40,
  study: 110,
  servant_quarter: 90,
  other: 80,
};

function roomAreaSqft(r: ParsedRoom): number {
  if (r.dim_width_ft != null && r.dim_depth_ft != null) {
    return r.dim_width_ft * r.dim_depth_ft;
  }
  return DEFAULT_ROOM_AREA_SQFT[r.function] ?? 100;
}

function checkAreaImpossible(c: ParsedConstraints): InfeasibilityReport | null {
  const plotArea = c.plot.total_built_up_sqft
    ?? (c.plot.width_ft != null && c.plot.depth_ft != null ? c.plot.width_ft * c.plot.depth_ft : null);
  if (plotArea == null || plotArea <= 0) return null;

  const totalRoomArea = c.rooms.reduce((s, r) => s + roomAreaSqft(r), 0);
  const ratio = totalRoomArea / plotArea;
  if (ratio > 1.2) {
    return {
      feasible: false,
      kind: "AREA_IMPOSSIBLE",
      reason: `Total room area ${totalRoomArea.toFixed(0)} sqft exceeds 120% of plot area ${plotArea.toFixed(0)} sqft (ratio ${ratio.toFixed(2)})`,
      details: { plotArea, totalRoomArea, ratio, threshold: 1.2 },
    };
  }
  return null;
}

function checkRoomTooBig(c: ParsedConstraints): InfeasibilityReport | null {
  if (c.plot.width_ft == null || c.plot.depth_ft == null) return null;
  const W = c.plot.width_ft;
  const D = c.plot.depth_ft;
  const longerPlot = Math.max(W, D);

  for (const r of c.rooms) {
    if (r.dim_width_ft == null || r.dim_depth_ft == null) continue;
    const longerRoom = Math.max(r.dim_width_ft, r.dim_depth_ft);
    if (longerRoom > longerPlot) {
      return {
        feasible: false,
        kind: "ROOM_TOO_BIG",
        reason: `Room "${r.name}" longest dim ${longerRoom}ft exceeds plot longest dim ${longerPlot}ft`,
        details: { room: r.name, room_dim: longerRoom, plot_dim: longerPlot },
      };
    }
    const shorterRoom = Math.min(r.dim_width_ft, r.dim_depth_ft);
    const shorterPlot = Math.min(W, D);
    if (shorterRoom > shorterPlot) {
      return {
        feasible: false,
        kind: "ROOM_TOO_BIG",
        reason: `Room "${r.name}" shorter dim ${shorterRoom}ft exceeds plot shorter dim ${shorterPlot}ft`,
        details: { room: r.name, room_dim: shorterRoom, plot_dim: shorterPlot },
      };
    }
  }
  return null;
}

function checkPositionConflict(c: ParsedConstraints): InfeasibilityReport | null {
  const corners = new Map<string, ParsedRoom[]>();
  for (const r of c.rooms) {
    if (r.position_type !== "corner") continue;
    if (r.position_direction == null) continue;
    const key = r.position_direction;
    if (!corners.has(key)) corners.set(key, []);
    corners.get(key)!.push(r);
  }

  for (const [dir, rooms] of corners.entries()) {
    if (rooms.length >= 2) {
      return {
        feasible: false,
        kind: "POSITION_CONFLICT",
        reason: `Two or more rooms claim the ${dir} corner: ${rooms.map(r => r.name).join(", ")}`,
        details: { direction: dir, rooms: rooms.map(r => r.name) },
      };
    }
  }
  return null;
}

function checkVastuConflict(c: ParsedConstraints): InfeasibilityReport | null {
  if (!c.vastu_required) return null;

  for (const r of c.rooms) {
    if (r.position_direction == null) continue;
    for (const rule of HARD_VASTU_RULES) {
      if (!rule.applies_to_function(r)) continue;
      if (rule.forbidden.includes(r.position_direction)) {
        return {
          feasible: false,
          kind: "VASTU_CONFLICT",
          reason: `Vastu hard rule ${rule.rule_id}: room "${r.name}" (${r.function}) cannot be placed in ${r.position_direction}`,
          details: {
            rule_id: rule.rule_id,
            room: r.name,
            function: r.function,
            requested_direction: r.position_direction,
            forbidden_directions: rule.forbidden,
          },
        };
      }
    }
  }
  return null;
}

/**
 * UNDER_FULL — the requested rooms cover much less area than the plot.
 *
 * Non-blocking. The pipeline still proceeds; the warning is surfaced through
 * the API response so the client can disclose the void problem to the user.
 * This is the exact failure mode behind the investor-demo 5BHK plan
 * (1528 ft² of rooms in a 2600 ft² plot).
 */
const UNDER_FULL_THRESHOLD = 0.65;

function checkAreaUnderfilled(c: ParsedConstraints): InfeasibilityWarning | null {
  const plotArea = c.plot.total_built_up_sqft
    ?? (c.plot.width_ft != null && c.plot.depth_ft != null ? c.plot.width_ft * c.plot.depth_ft : null);
  if (plotArea == null || plotArea <= 0) return null;

  const totalRoomArea = c.rooms.reduce((s, r) => s + roomAreaSqft(r), 0);
  if (totalRoomArea <= 0) return null;

  const ratio = totalRoomArea / plotArea;
  if (ratio < UNDER_FULL_THRESHOLD) {
    const slackSqft = Math.round(plotArea - totalRoomArea);
    return {
      kind: "UNDER_FULL",
      severity: "warning",
      message: `Room areas total ${Math.round(totalRoomArea)} sqft but plot is ${Math.round(plotArea)} sqft (${Math.round(ratio * 100)}% fill). ${slackSqft} sqft of slack will become voids unless circulation/extra rooms are added.`,
      details: {
        plotArea: Math.round(plotArea),
        totalRoomArea: Math.round(totalRoomArea),
        ratio: Math.round(ratio * 100) / 100,
        slack_sqft: slackSqft,
        threshold: UNDER_FULL_THRESHOLD,
      },
    };
  }
  return null;
}

export function detectInfeasibility(c: ParsedConstraints): InfeasibilityReport {
  // Hard checks first — any one of these returns a blocking report.
  const checks = [checkAreaImpossible, checkRoomTooBig, checkPositionConflict, checkVastuConflict];
  for (const check of checks) {
    const result = check(c);
    if (result) return result;
  }

  // Soft checks — collected even on a feasible report.
  const warnings: InfeasibilityWarning[] = [];
  const underfill = checkAreaUnderfilled(c);
  if (underfill) warnings.push(underfill);

  return warnings.length > 0
    ? { feasible: true, warnings }
    : { feasible: true };
}
