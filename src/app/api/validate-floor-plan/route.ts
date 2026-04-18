/**
 * POST /api/validate-floor-plan
 *
 * Pre-generation validation. Takes a user prompt, parses it, validates the
 * room program, and returns a structured result showing:
 *   - What we understood from the prompt
 *   - Issues (over-area, missing essentials, impossible dims)
 *   - Adjustments we'd make (with reasons)
 *   - Optional rooms the user might want to add
 *
 * This runs BEFORE generation so the user can review and approve.
 */

export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { parseConstraints, type ParsedConstraints, type ParsedRoom } from "@/features/floor-plan/lib/structured-parser";

// ── Types ────────────────────────────────────────────────────────────────────

interface ValidatedRoom {
  name: string;
  type: string;
  requested_sqft: number | null;
  adjusted_sqft: number;
  width_ft: number;
  depth_ft: number;
  source: "user" | "inferred" | "added";
  adjustment_reason: string | null;
}

interface ValidationIssue {
  type: "OVER_AREA" | "UNDER_AREA" | "MISSING_ESSENTIAL" | "IMPOSSIBLE_DIMS" | "NO_PLOT_SIZE" | "ROOM_TOO_SMALL" | "ROOM_TOO_LARGE";
  message: string;
  severity: "error" | "warning" | "info";
}

interface Adjustment {
  room_name: string;
  original_sqft: number | null;
  adjusted_sqft: number;
  reason: string;
  type: "shrunk" | "expanded" | "added" | "unchanged";
  user_can_undo: boolean;
}

interface OptionalRoom {
  name: string;
  type: string;
  default_sqft: number;
  default_width: number;
  default_depth: number;
  description: string;
  checked_by_default: boolean;
}

interface ValidationResult {
  understood: {
    plot: {
      width_ft: number;
      depth_ft: number;
      total_sqft: number;
      facing: string | null;
      plot_source: "explicit" | "inferred";
    };
    rooms: ValidatedRoom[];
    total_requested_sqft: number;
  };
  issues: ValidationIssue[];
  adjustments: Adjustment[];
  optional_rooms: OptionalRoom[];
  adjusted_program: {
    rooms: ValidatedRoom[];
    total_sqft: number;
    fits_plot: boolean;
    hallway_sqft: number;
    wall_overhead_sqft: number;
  };
  parser_model: string;
}

// ── Default dimensions ───────────────────────────────────────────────────────

const DEFAULT_DIMS: Record<string, [number, number]> = {
  bedroom: [12, 11], master_bedroom: [14, 13], guest_bedroom: [12, 11],
  kids_bedroom: [11, 10], living: [16, 13], dining: [12, 11],
  kitchen: [10, 9], bathroom: [7, 5], master_bathroom: [9, 6],
  powder_room: [5, 4], walk_in_wardrobe: [7, 5], walk_in_closet: [7, 5],
  foyer: [8, 7], porch: [8, 5], verandah: [12, 8], balcony: [10, 4],
  corridor: [12, 4], utility: [6, 5], store: [6, 5], laundry: [6, 5],
  pantry: [6, 5], pooja: [5, 4], study: [10, 9], servant_quarter: [9, 8],
  other: [10, 8],
};

const MIN_AREA: Record<string, number> = {
  bedroom: 80, master_bedroom: 120, guest_bedroom: 80, kids_bedroom: 70,
  living: 100, dining: 80, kitchen: 50, bathroom: 25, master_bathroom: 35,
  powder_room: 15, utility: 20, store: 15, pooja: 16, study: 60,
  foyer: 25, porch: 20, balcony: 20, pantry: 15,
};

// BHK → inferred plot size (sqft) when no plot dimensions given
const BHK_PLOT_DEFAULTS: Record<number, { sqft: number; w: number; d: number }> = {
  0: { sqft: 350, w: 20, d: 18 },   // 1RK / studio
  1: { sqft: 550, w: 25, d: 22 },
  2: { sqft: 800, w: 30, d: 27 },
  3: { sqft: 1200, w: 35, d: 35 },
  4: { sqft: 1800, w: 40, d: 45 },
  5: { sqft: 2500, w: 45, d: 55 },
  6: { sqft: 3200, w: 50, d: 65 },
};

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    const body = await req.json();
    const prompt = body.prompt as string;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "NO_API_KEY" }, { status: 503 });
    }

    // Parse the prompt
    const parseResult = await parseConstraints(prompt, apiKey);
    const parsed = parseResult.constraints;

    // Build the validation result
    const result = buildValidation(parsed, prompt);

    return NextResponse.json({
      ...result,
      parser_model: parseResult.parser_model,
    });
  } catch (err) {
    console.error("[validate-floor-plan] Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Validation Logic ─────────────────────────────────────────────────────────

function buildValidation(parsed: ParsedConstraints, prompt: string): Omit<ValidationResult, "parser_model"> {
  const issues: ValidationIssue[] = [];
  const adjustments: Adjustment[] = [];

  // ── Resolve plot dimensions ──
  let plotW = parsed.plot.width_ft;
  let plotD = parsed.plot.depth_ft;
  let plotSqft = parsed.plot.total_built_up_sqft;
  let plotSource: "explicit" | "inferred" = "explicit";

  if (!plotW || !plotD) {
    if (plotSqft && plotSqft > 0) {
      // Have total area but not dimensions — estimate assuming ~1.2 aspect ratio
      plotW = Math.round(Math.sqrt(plotSqft / 1.2));
      plotD = Math.round(plotSqft / plotW);
      plotSource = "inferred";
    } else {
      // No plot info at all — infer from BHK count
      const bhkCount = countBedrooms(parsed.rooms);
      const defaults = BHK_PLOT_DEFAULTS[Math.min(bhkCount, 6)] ?? BHK_PLOT_DEFAULTS[3];
      plotW = defaults.w;
      plotD = defaults.d;
      plotSqft = defaults.sqft;
      plotSource = "inferred";
      issues.push({
        type: "NO_PLOT_SIZE",
        message: `No plot size specified. We assumed ${plotW}ft x ${plotD}ft (${plotW * plotD} sqft) based on your ${bhkCount}BHK requirement.`,
        severity: "info",
      });
    }
  }

  if (!plotSqft) plotSqft = plotW * plotD;
  const plotArea = plotW * plotD;

  // ── Build room list with areas ──
  const rooms: ValidatedRoom[] = [];
  for (const pr of parsed.rooms) {
    if (pr.is_circulation) continue; // hallway handled separately
    const [defW, defD] = DEFAULT_DIMS[pr.function] ?? DEFAULT_DIMS.other;
    const w = pr.dim_width_ft ?? defW;
    const d = pr.dim_depth_ft ?? defD;
    const reqSqft = (pr.dim_width_ft && pr.dim_depth_ft) ? pr.dim_width_ft * pr.dim_depth_ft : null;
    rooms.push({
      name: pr.name,
      type: pr.function,
      requested_sqft: reqSqft,
      adjusted_sqft: w * d,
      width_ft: w,
      depth_ft: d,
      source: (pr.dim_width_ft && pr.dim_depth_ft) ? "user" : "inferred",
      adjustment_reason: null,
    });
  }

  // ── Check A: Missing essentials ──
  const hasKitchen = rooms.some(r => r.type === "kitchen");
  const hasBathroom = rooms.some(r => r.type === "bathroom" || r.type === "master_bathroom" || r.type === "powder_room");

  if (!hasKitchen) {
    const [kw, kd] = DEFAULT_DIMS.kitchen;
    rooms.push({
      name: "Kitchen", type: "kitchen",
      requested_sqft: null, adjusted_sqft: kw * kd,
      width_ft: kw, depth_ft: kd,
      source: "added", adjustment_reason: "Every home needs a kitchen",
    });
    adjustments.push({
      room_name: "Kitchen", original_sqft: null, adjusted_sqft: kw * kd,
      reason: "Every home needs a kitchen", type: "added", user_can_undo: true,
    });
    issues.push({
      type: "MISSING_ESSENTIAL",
      message: "No kitchen found in your description. We added one (90 sqft).",
      severity: "warning",
    });
  }

  if (!hasBathroom) {
    const [bw, bd] = DEFAULT_DIMS.bathroom;
    rooms.push({
      name: "Bathroom", type: "bathroom",
      requested_sqft: null, adjusted_sqft: bw * bd,
      width_ft: bw, depth_ft: bd,
      source: "added", adjustment_reason: "Every home needs a bathroom",
    });
    adjustments.push({
      room_name: "Bathroom", original_sqft: null, adjusted_sqft: bw * bd,
      reason: "Every home needs a bathroom", type: "added", user_can_undo: true,
    });
    issues.push({
      type: "MISSING_ESSENTIAL",
      message: "No bathroom found in your description. We added one (35 sqft).",
      severity: "warning",
    });
  }

  // ── Check B: Area math ──
  const hallwayArea = 4 * Math.max(plotW, plotD); // 4ft wide hallway
  const wallOverhead = plotArea * 0.08; // ~8% for walls
  const usableArea = plotArea - hallwayArea - wallOverhead;
  let totalRoomArea = rooms.reduce((s, r) => s + r.adjusted_sqft, 0);

  if (totalRoomArea > usableArea * 1.1) {
    issues.push({
      type: "OVER_AREA",
      message: `Your rooms total ${Math.round(totalRoomArea)} sqft but the usable plot area is ~${Math.round(usableArea)} sqft (after hallway and walls). We'll proportionally adjust room sizes to fit.`,
      severity: "warning",
    });

    // Proportionally scale down
    const scaleFactor = usableArea / totalRoomArea;
    for (const room of rooms) {
      if (room.source === "added") continue; // don't shrink essentials we just added
      const origSqft = room.adjusted_sqft;
      const minArea = MIN_AREA[room.type] ?? 15;
      const newArea = Math.max(minArea, Math.round(origSqft * scaleFactor));
      if (newArea < origSqft) {
        const ratio = Math.sqrt(newArea / origSqft);
        room.width_ft = Math.max(4, Math.round(room.width_ft * ratio));
        room.depth_ft = Math.max(4, Math.round(room.depth_ft * ratio));
        room.adjusted_sqft = room.width_ft * room.depth_ft;
        room.adjustment_reason = `Reduced from ${origSqft} to ${room.adjusted_sqft} sqft to fit plot`;
        adjustments.push({
          room_name: room.name, original_sqft: origSqft, adjusted_sqft: room.adjusted_sqft,
          reason: `Shrunk to fit plot (${Math.round((1 - room.adjusted_sqft / origSqft) * 100)}% reduction)`,
          type: "shrunk", user_can_undo: true,
        });
      }
    }
    totalRoomArea = rooms.reduce((s, r) => s + r.adjusted_sqft, 0);
  }

  if (totalRoomArea < usableArea * 0.4 && rooms.length > 0) {
    issues.push({
      type: "UNDER_AREA",
      message: `Your rooms only use ${Math.round(totalRoomArea / usableArea * 100)}% of the available space. Consider adding more rooms or larger sizes.`,
      severity: "info",
    });
  }

  // ── Check C: Individual room checks ──
  for (const room of rooms) {
    if (room.adjusted_sqft < 15) {
      issues.push({
        type: "ROOM_TOO_SMALL",
        message: `${room.name} (${room.adjusted_sqft} sqft) is very small — minimum recommended is ${MIN_AREA[room.type] ?? 15} sqft.`,
        severity: "warning",
      });
    }
    if (room.width_ft > plotW || room.depth_ft > plotD) {
      issues.push({
        type: "IMPOSSIBLE_DIMS",
        message: `${room.name} (${room.width_ft}x${room.depth_ft}ft) is larger than the plot (${plotW}x${plotD}ft).`,
        severity: "error",
      });
    }
  }

  // ── Optional rooms ──
  const optionalRooms: OptionalRoom[] = [];
  const existingTypes = new Set(rooms.map(r => r.type));

  if (!existingTypes.has("pooja") && plotArea >= 1000) {
    optionalRooms.push({
      name: "Pooja Room", type: "pooja", default_sqft: 20, default_width: 5, default_depth: 4,
      description: "Prayer/worship room", checked_by_default: false,
    });
  }
  if (!existingTypes.has("utility") && plotArea >= 700) {
    optionalRooms.push({
      name: "Utility Room", type: "utility", default_sqft: 30, default_width: 6, default_depth: 5,
      description: "Washing machine, ironing, storage", checked_by_default: false,
    });
  }
  if (!existingTypes.has("balcony") && !existingTypes.has("sit_out") && plotArea >= 900) {
    optionalRooms.push({
      name: "Balcony", type: "balcony", default_sqft: 40, default_width: 10, default_depth: 4,
      description: "Open-air sitting area", checked_by_default: false,
    });
  }
  if (!existingTypes.has("store") && plotArea >= 1500) {
    optionalRooms.push({
      name: "Store Room", type: "store", default_sqft: 25, default_width: 5, default_depth: 5,
      description: "General storage", checked_by_default: false,
    });
  }
  if (!existingTypes.has("study") && countBedrooms(parsed.rooms) >= 4) {
    optionalRooms.push({
      name: "Study", type: "study", default_sqft: 80, default_width: 10, default_depth: 8,
      description: "Home office / study room", checked_by_default: false,
    });
  }

  // Mark unchanged rooms
  for (const room of rooms) {
    if (!adjustments.some(a => a.room_name === room.name)) {
      adjustments.push({
        room_name: room.name, original_sqft: room.requested_sqft, adjusted_sqft: room.adjusted_sqft,
        reason: room.source === "inferred" ? "Size inferred from room type" : "Matches your specification",
        type: "unchanged", user_can_undo: false,
      });
    }
  }

  return {
    understood: {
      plot: {
        width_ft: plotW,
        depth_ft: plotD,
        total_sqft: plotArea,
        facing: parsed.plot.facing,
        plot_source: plotSource,
      },
      rooms,
      total_requested_sqft: totalRoomArea,
    },
    issues,
    adjustments,
    optional_rooms: optionalRooms,
    adjusted_program: {
      rooms,
      total_sqft: totalRoomArea,
      fits_plot: totalRoomArea <= usableArea * 1.05,
      hallway_sqft: Math.round(hallwayArea),
      wall_overhead_sqft: Math.round(wallOverhead),
    },
  };
}

function countBedrooms(rooms: ParsedRoom[]): number {
  return rooms.filter(r =>
    r.function === "bedroom" || r.function === "master_bedroom" ||
    r.function === "guest_bedroom" || r.function === "kids_bedroom",
  ).length;
}
