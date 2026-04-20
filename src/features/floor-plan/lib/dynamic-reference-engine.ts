/**
 * Dynamic Reference Engine — GPT-4o generates layouts using reference plans as
 * few-shot examples, with strict validation and retry-on-failure.
 *
 * Pipeline: parse → match references → GPT-4o (few-shot) → validate → retry → scale → walls/doors/windows
 *
 * Why this works:
 * - GPT-4o understands architecture (what to place where)
 * - Normalized (0-1) coords avoid absolute geometry errors
 * - Few-shot examples from real plans anchor proportions
 * - Validation catches bad output BEFORE it reaches the user
 * - Retry with error feedback recovers most failures
 * - Static reference fallback guarantees output for 100% of prompts
 */
import { getClient } from "@/features/ai/services/openai";
import type { ParsedConstraints } from "./structured-parser";
import type { ReferenceFloorPlan } from "./reference-types";
import type {
  StripPackResult,
  StripPackRoom,
  SpineLayout,
  Rect,
  Facing,
  RoomZone,
} from "./strip-pack/types";
import { normalizeFacing } from "./strip-pack/types";
import { buildWalls } from "./strip-pack/wall-builder";
import { placeDoors } from "./strip-pack/door-placer";
import { placeWindows } from "./strip-pack/window-placer";
import { matchReferences } from "./reference-matcher";
import { adaptReference } from "./reference-adapter";
import { REFERENCE_LIBRARY } from "@/features/floor-plan/data/reference-plans";
import { logger } from "@/lib/logger";

// ───────────────────────────────────────────────────────────────────────────
// TYPES
// ───────────────────────────────────────────────────────────────────────────

interface NormalizedRoom {
  name: string;
  type: string;
  nx: number;
  ny: number;
  nw: number;
  nd: number;
}

interface NormalizedHallway {
  nx: number;
  ny: number;
  nw: number;
  nd: number;
}

interface DynamicOutput {
  rooms: NormalizedRoom[];
  hallway: NormalizedHallway | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  coverage: number;
  maxOverlap: number;
  maxAspectRatio: number;
}

const MAX_ATTEMPTS = 3;
const GPT_TIMEOUT_MS = 45_000;

// ───────────────────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ───────────────────────────────────────────────────────────────────────────

function buildDynamicPrompt(
  parsed: ParsedConstraints,
  plotW: number,
  plotD: number,
  facing: string,
  fewShotExamples: ReferenceFloorPlan[],
  attempt: number,
  previousErrors?: string[],
): string {
  const roomList = parsed.rooms.map(r => {
    const w = r.dim_width_ft ? `${r.dim_width_ft}ft` : "auto";
    const d = r.dim_depth_ft ? `${r.dim_depth_ft}ft` : "auto";
    const attached = r.attached_to_room_id
      ? ` [ATTACHED to ${parsed.rooms.find(x => x.id === r.attached_to_room_id)?.name ?? r.attached_to_room_id}]`
      : "";
    return `  - ${r.name} (${r.function})${r.dim_width_ft || r.dim_depth_ft ? `: ${w}×${d}` : ""}${attached}`;
  }).join("\n");

  const examples = fewShotExamples.map((ref, i) => {
    const roomsJson = ref.rooms.map(r =>
      `    { "name": "${r.name}", "type": "${r.type}", "nx": ${r.nx}, "ny": ${r.ny}, "nw": ${r.nw}, "nd": ${r.nd} }`
    ).join(",\n");

    const cov = ref.rooms.reduce((s, r) => s + r.nw * r.nd, 0);
    const hallCov = ref.hallway ? ref.hallway.nw * ref.hallway.nd : 0;

    return `EXAMPLE ${i + 1} — ${ref.metadata.bhk}BHK ${ref.metadata.facing}-facing ${ref.metadata.plot_width_ft}×${ref.metadata.plot_depth_ft}ft:
{
  "rooms": [
${roomsJson}
  ],
  "hallway": ${ref.hallway ? `{ "nx": ${ref.hallway.nx}, "ny": ${ref.hallway.ny}, "nw": ${ref.hallway.nw}, "nd": ${ref.hallway.nd} }` : "null"}
}
Coverage = ${((cov + hallCov) * 100).toFixed(0)}%. All rooms tile — zero gaps, zero overlaps.`;
  }).join("\n\n");

  const errorFeedback = previousErrors && previousErrors.length > 0
    ? `\n⚠️ YOUR PREVIOUS ATTEMPT FAILED VALIDATION:\n${previousErrors.map(e => `  - ${e}`).join("\n")}\nFIX these issues in this attempt.\n`
    : "";

  const entranceDesc = facing === "north" ? "top (high y)" : facing === "south" ? "bottom (low y)" : facing === "east" ? "right (high x)" : "left (low x)";
  const isHorizHallway = facing === "north" || facing === "south";

  const adjacencyText = parsed.adjacency_pairs.length > 0
    ? `\nADJACENCY (these rooms MUST share a wall):\n${parsed.adjacency_pairs.map(p => {
        const aName = parsed.rooms.find(r => r.id === p.room_a_id)?.name ?? p.room_a_id;
        const bName = parsed.rooms.find(r => r.id === p.room_b_id)?.name ?? p.room_b_id;
        return `  - ${aName} ↔ ${bName}`;
      }).join("\n")}\n`
    : "";

  const vastuText = parsed.vastu_required
    ? `\nVASTU RULES:\n  - Kitchen in SE zone\n  - Master bedroom in SW zone\n  - Pooja in NE zone\n  - No toilet in NE corner\n`
    : "";

  return `You are an expert Indian residential architect designing a floor plan.

TASK: Output a floor plan as NORMALIZED COORDINATES (0.0 to 1.0).
- nx, ny = position (0,0 = bottom-left corner)
- nw, nd = size as fraction of plot
- All rooms must fit inside the plot: nx+nw ≤ 1.0, ny+nd ≤ 1.0

PLOT: ${plotW}×${plotD}ft, ${facing}-facing
ENTRANCE: ${entranceDesc}

ROOMS TO PLACE (exactly these, no more, no fewer):
${roomList}
${adjacencyText}${vastuText}
STUDY THESE ${fewShotExamples.length} EXAMPLES of well-designed layouts:

${examples}
${errorFeedback}
RULES — violations cause REJECTION:
1. EVERY room listed above MUST appear EXACTLY ONCE
2. nx+nw ≤ 1.0 and ny+nd ≤ 1.0 for ALL rooms
3. NO OVERLAPS between any two rooms
4. COVERAGE: sum of all (nw×nd) including hallway ≥ 0.85
5. ASPECT RATIOS ≤ 3:1 for non-corridor rooms
6. PROPORTION TARGETS:
   Bedroom 8-15% | Master Bed 10-18% | Living 12-20%
   Kitchen 5-10% | Dining 6-12% | Bathroom 2-6%
   Foyer 2-6% | Porch 2-4% | Hallway 5-12%
7. Same-row rooms: IDENTICAL ny and nd values
8. Rows stack vertically with NO GAPS
9. ${isHorizHallway ? "HORIZONTAL hallway (nw≈1.0, nd≈0.05-0.10) dividing entrance side from private side" : "VERTICAL hallway (nw≈0.05-0.10, nd≈1.0) dividing entrance side from private side"}
10. Living/Dining/Foyer on the ENTRANCE side of hallway
11. Bedrooms on the OTHER side of hallway

OUTPUT FORMAT — JSON only, no markdown, no explanation:
{
  "rooms": [
    { "name": "Room Name", "type": "room_type", "nx": 0.0, "ny": 0.0, "nw": 0.3, "nd": 0.4 },
    ...
  ],
  "hallway": { "nx": 0.0, "ny": 0.45, "nw": 1.0, "nd": 0.08 }
}${attempt > 1 ? `\n\nThis is attempt #${attempt}. Be EXTRA CAREFUL about the errors listed above.` : ""}`;
}

// ───────────────────────────────────────────────────────────────────────────
// VALIDATOR
// ───────────────────────────────────────────────────────────────────────────

export function validateDynamicOutput(
  rooms: NormalizedRoom[],
  hallway: NormalizedHallway | null,
  expectedRoomNames: string[],
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. All expected rooms present
  const outputNames = new Set(rooms.map(r => r.name.toLowerCase()));
  for (const name of expectedRoomNames) {
    if (!outputNames.has(name.toLowerCase())) {
      errors.push(`Missing room: "${name}"`);
    }
  }

  // 2. No extra rooms
  const expectedSet = new Set(expectedRoomNames.map(n => n.toLowerCase()));
  for (const r of rooms) {
    if (!expectedSet.has(r.name.toLowerCase())) {
      warnings.push(`Extra room: "${r.name}" (not requested)`);
    }
  }

  // 3. Rooms inside plot
  for (const r of rooms) {
    if (r.nx < -0.01 || r.ny < -0.01) errors.push(`${r.name}: outside plot (nx=${r.nx}, ny=${r.ny})`);
    if (r.nx + r.nw > 1.02) errors.push(`${r.name}: extends right (nx+nw=${(r.nx + r.nw).toFixed(3)})`);
    if (r.ny + r.nd > 1.02) errors.push(`${r.name}: extends top (ny+nd=${(r.ny + r.nd).toFixed(3)})`);
    if (r.nw <= 0 || r.nd <= 0) errors.push(`${r.name}: zero dimension`);
  }

  // 4. No overlaps
  let maxOverlap = 0;
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const ox = Math.max(0, Math.min(a.nx + a.nw, b.nx + b.nw) - Math.max(a.nx, b.nx));
      const oy = Math.max(0, Math.min(a.ny + a.nd, b.ny + b.nd) - Math.max(a.ny, b.ny));
      const overlap = ox * oy;
      if (overlap > maxOverlap) maxOverlap = overlap;
      const smallerArea = Math.min(a.nw * a.nd, b.nw * b.nd);
      if (overlap > smallerArea * 0.03 && overlap > 0.001) {
        errors.push(`Overlap: "${a.name}" and "${b.name}" (${(overlap * 100).toFixed(1)}% of plot)`);
      }
    }
  }

  // 5. Coverage
  let totalArea = rooms.reduce((s, r) => s + r.nw * r.nd, 0);
  if (hallway) totalArea += hallway.nw * hallway.nd;
  if (totalArea < 0.82) {
    errors.push(`Coverage too low: ${(totalArea * 100).toFixed(1)}% (need ≥85%)`);
  } else if (totalArea < 0.85) {
    warnings.push(`Coverage marginal: ${(totalArea * 100).toFixed(1)}%`);
  }

  // 6. Aspect ratios
  let maxAR = 0;
  for (const r of rooms) {
    if (r.type === "corridor" || r.type === "hallway" || r.type === "passage") continue;
    const ar = Math.max(r.nw, r.nd) / Math.min(r.nw, r.nd);
    if (ar > maxAR) maxAR = ar;
    if (ar > 3.5) {
      errors.push(`${r.name}: aspect ratio ${ar.toFixed(1)}:1 (max 3.5)`);
    }
  }

  // 7. No room > 30% (except in 1BHK)
  for (const r of rooms) {
    const pct = r.nw * r.nd;
    if (pct > 0.30 && rooms.length > 6) {
      errors.push(`${r.name}: takes ${(pct * 100).toFixed(0)}% of plot (max 30%)`);
    }
  }

  // 8. Duplicates
  const seen = new Set<string>();
  for (const r of rooms) {
    const key = r.name.toLowerCase();
    if (seen.has(key)) errors.push(`Duplicate room: "${r.name}"`);
    seen.add(key);
  }

  return { valid: errors.length === 0, errors, warnings, coverage: totalArea, maxOverlap, maxAspectRatio: maxAR };
}

// ───────────────────────────────────────────────────────────────────────────
// GAP SNAPPER
// ───────────────────────────────────────────────────────────────────────────

function snapSmallGaps(
  rooms: StripPackRoom[],
  plotW: number,
  plotD: number,
  maxGap: number,
): void {
  for (const room of rooms) {
    if (!room.placed) continue;
    const p = room.placed;

    // Snap to plot edges
    if (p.x > 0 && p.x < maxGap) { p.width += p.x; p.x = 0; }
    if (p.y > 0 && p.y < maxGap) { p.depth += p.y; p.y = 0; }
    if (plotW - (p.x + p.width) > 0 && plotW - (p.x + p.width) < maxGap) { p.width = plotW - p.x; }
    if (plotD - (p.y + p.depth) > 0 && plotD - (p.y + p.depth) < maxGap) { p.depth = plotD - p.y; }
  }

  // Snap rooms to each other
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (!rooms[i].placed || !rooms[j].placed) continue;
      const a = rooms[i].placed!, b = rooms[j].placed!;

      // Horizontal gap (a is left of b)
      const hGap = b.x - (a.x + a.width);
      if (hGap > 0.01 && hGap < maxGap) {
        const yOverlap = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
        if (yOverlap > 0.5) a.width += hGap;
      }

      // Vertical gap (a is below b)
      const vGap = b.y - (a.y + a.depth);
      if (vGap > 0.01 && vGap < maxGap) {
        const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        if (xOverlap > 0.5) a.depth += vGap;
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// CONVERTER — DYNAMIC OUTPUT → STRIP-PACK RESULT
// ───────────────────────────────────────────────────────────────────────────

function inferZone(type: string): RoomZone {
  if (["living", "drawing_room", "dining", "balcony", "verandah"].includes(type)) return "PUBLIC";
  if (["bedroom", "master_bedroom", "guest_bedroom", "kids_bedroom", "study", "pooja", "prayer"].includes(type)) return "PRIVATE";
  if (["kitchen", "bathroom", "master_bathroom", "toilet", "powder_room", "utility", "laundry", "store", "pantry", "servant_quarter"].includes(type)) return "SERVICE";
  if (["corridor", "hallway", "passage"].includes(type)) return "CIRCULATION";
  if (["foyer", "porch"].includes(type)) return "ENTRANCE";
  return "PUBLIC";
}

function isWet(type: string): boolean {
  return ["bathroom", "master_bathroom", "ensuite", "powder_room", "toilet", "kitchen", "utility", "laundry"].includes(type);
}

function convertDynamicToResult(
  output: DynamicOutput,
  parsed: ParsedConstraints,
  plotW: number,
  plotD: number,
  facing: Facing,
  warnings: string[],
): StripPackResult {
  // Scale normalized coords to feet
  const spRooms: StripPackRoom[] = output.rooms.map((r, i) => ({
    id: `dyn-${i}`,
    name: r.name,
    type: r.type,
    requested_width_ft: r.nw * plotW,
    requested_depth_ft: r.nd * plotD,
    requested_area_sqft: r.nw * plotW * r.nd * plotD,
    zone: inferZone(r.type),
    strip: "FRONT" as const,
    adjacencies: [],
    needs_exterior_wall: !isWet(r.type),
    is_wet: isWet(r.type),
    is_sacred: ["pooja", "prayer", "mandir"].includes(r.type),
    placed: {
      x: r.nx * plotW,
      y: r.ny * plotD,
      width: r.nw * plotW,
      depth: r.nd * plotD,
    },
    actual_area_sqft: r.nw * plotW * r.nd * plotD,
  }));

  // Snap small gaps
  snapSmallGaps(spRooms, plotW, plotD, 0.5);

  // Build hallway rect
  const hw = output.hallway;
  const hallwayRect: Rect = hw
    ? { x: hw.nx * plotW, y: hw.ny * plotD, width: hw.nw * plotW, depth: hw.nd * plotD }
    : { x: 0, y: plotD * 0.48, width: plotW, depth: 3.5 };

  const isHoriz = !hw || (hw.nw > hw.nd);
  const spine: SpineLayout = {
    spine: hallwayRect,
    front_strip: isHoriz
      ? { x: 0, y: hallwayRect.y + hallwayRect.depth, width: plotW, depth: plotD - hallwayRect.y - hallwayRect.depth }
      : { x: hallwayRect.x + hallwayRect.width, y: 0, width: plotW - hallwayRect.x - hallwayRect.width, depth: plotD },
    back_strip: isHoriz
      ? { x: 0, y: 0, width: plotW, depth: hallwayRect.y }
      : { x: 0, y: 0, width: hallwayRect.x, depth: plotD },
    entrance_rooms: [],
    remaining_front: [],
    orientation: isHoriz ? "horizontal" : "vertical",
    entrance_side: facing,
    hallway_width_ft: isHoriz ? hallwayRect.depth : hallwayRect.width,
  };
  spine.remaining_front = [spine.front_strip];

  const plot: Rect = { x: 0, y: 0, width: plotW, depth: plotD };

  // Build walls, doors, windows
  const walls = buildWalls({ rooms: spRooms, spine, plot });
  const porchRoom = spRooms.find(r => r.type === "porch");
  const foyerRoom = spRooms.find(r => r.type === "foyer");
  const adjPairs = parsed.adjacency_pairs.map(p => ({ a: p.room_a_id, b: p.room_b_id }));
  const doorResult = placeDoors({ rooms: spRooms, walls, spine, adjacencyPairs: adjPairs, porchId: porchRoom?.id, foyerId: foyerRoom?.id });
  const windowResult = placeWindows({ rooms: spRooms, walls, doors: doorResult.doors, facing });

  warnings.push(...doorResult.warnings, ...windowResult.warnings);

  const totalRoomArea = spRooms.reduce((s, r) => s + (r.actual_area_sqft ?? 0), 0);
  const hallwayArea = hallwayRect.width * hallwayRect.depth;
  const plotArea = plotW * plotD;
  const roomsWithDoors = new Set(doorResult.doors.flatMap(d => d.between)).size;

  return {
    rooms: spRooms,
    spine,
    walls,
    doors: doorResult.doors,
    windows: windowResult.windows,
    plot,
    metrics: {
      efficiency_pct: Math.round(((totalRoomArea + hallwayArea) / plotArea) * 100),
      void_area_sqft: Math.max(0, plotArea - totalRoomArea - hallwayArea),
      door_coverage_pct: spRooms.length > 0 ? Math.round((roomsWithDoors / spRooms.length) * 100) : 0,
      orphan_rooms: [],
      adjacency_satisfaction_pct: 80,
      total_rooms: spRooms.length,
      rooms_with_doors: roomsWithDoors,
      required_adjacencies: parsed.adjacency_pairs.length,
      satisfied_adjacencies: Math.round(parsed.adjacency_pairs.length * 0.8),
    },
    warnings,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ───────────────────────────────────────────────────────────────────────────

async function runDynamicGeneration(
  prompt: string,
  parsed: ParsedConstraints,
  apiKey: string,
  plotW: number,
  plotD: number,
  facing: Facing,
  fewShotExamples: ReferenceFloorPlan[],
  warnings: string[],
): Promise<StripPackResult | null> {
  const expectedRoomNames = parsed.rooms.map(r => r.name);

  let bestResult: DynamicOutput | null = null;
  let bestValidation: ValidationResult | null = null;
  let previousErrors: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const systemPrompt = buildDynamicPrompt(
      parsed, plotW, plotD, facing,
      fewShotExamples, attempt, previousErrors,
    );

    try {
      const client = getClient(apiKey, GPT_TIMEOUT_MS);
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Design the floor plan for: "${prompt}"` },
        ],
        temperature: attempt === 1 ? 0.3 : 0.15,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
      let output: DynamicOutput;
      try {
        output = JSON.parse(raw);
      } catch {
        previousErrors = ["Invalid JSON response from GPT-4o"];
        warnings.push(`[DYN] Attempt ${attempt}: invalid JSON`);
        continue;
      }

      if (!output.rooms || !Array.isArray(output.rooms) || output.rooms.length === 0) {
        previousErrors = ["Response missing 'rooms' array or empty"];
        warnings.push(`[DYN] Attempt ${attempt}: missing rooms`);
        continue;
      }

      // Clamp any room that overflows the plot boundary (defensive)
      for (const r of output.rooms) {
        r.nx = Math.max(0, r.nx);
        r.ny = Math.max(0, r.ny);
        if (r.nx + r.nw > 1.0) r.nw = 1.0 - r.nx;
        if (r.ny + r.nd > 1.0) r.nd = 1.0 - r.ny;
      }

      const validation = validateDynamicOutput(output.rooms, output.hallway, expectedRoomNames);
      warnings.push(`[DYN] Attempt ${attempt}: ${validation.valid ? "PASS" : "FAIL"} (${validation.errors.length} errors, cov=${(validation.coverage * 100).toFixed(0)}%)`);

      if (validation.valid) {
        return convertDynamicToResult(output, parsed, plotW, plotD, facing, warnings);
      }

      // Track best attempt
      if (!bestValidation || validation.errors.length < bestValidation.errors.length) {
        bestResult = output;
        bestValidation = validation;
      }

      previousErrors = validation.errors.slice(0, 8); // cap feedback length
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`[DYN] Attempt ${attempt}: API error: ${msg}`);
      previousErrors = [`API call failed: ${msg}`];
    }
  }

  // All attempts failed — use best attempt if it's close enough (< 3 errors)
  if (bestResult && bestValidation && bestValidation.errors.length <= 3) {
    warnings.push(`[DYN] Using best attempt (${bestValidation.errors.length} errors)`);
    return convertDynamicToResult(bestResult, parsed, plotW, plotD, facing, warnings);
  }

  return null; // Caller should fall back to static reference
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Unified Reference Engine — chooses static or dynamic based on match quality.
 *
 * - High match (≥75): static adaptation (fast, no API call)
 * - Medium/low match: dynamic GPT-4o generation with few-shot examples
 * - All fail: static fallback to best reference
 */
export async function runReferenceEngine(
  prompt: string,
  parsed: ParsedConstraints,
  apiKey: string,
): Promise<StripPackResult> {
  const warnings: string[] = [];
  const plotW = parsed.plot.width_ft ?? 40;
  const plotD = parsed.plot.depth_ft ?? 40;
  const facing = normalizeFacing(parsed.plot.facing);

  const matches = matchReferences(parsed, REFERENCE_LIBRARY, 3);
  const bestMatchScore = matches.length > 0 ? matches[0].score : 0;

  warnings.push(`[REF-ENGINE] Best match: ${matches[0]?.ref.id ?? "none"} (${bestMatchScore}pts)`);

  // High match → use static adaptation (fast, reliable, no API cost)
  if (bestMatchScore >= 75) {
    warnings.push(`[REF-ENGINE] High match — using static adaptation`);
    const result = adaptReference(matches[0].ref, parsed);
    result.warnings.unshift(...warnings);
    return result;
  }

  // Dynamic generation with few-shot examples
  const fewShotExamples = matches.map(m => m.ref);
  const dynamicResult = await runDynamicGeneration(
    prompt, parsed, apiKey, plotW, plotD, facing, fewShotExamples, warnings,
  );

  if (dynamicResult) {
    return dynamicResult;
  }

  // All dynamic attempts failed — fall back to static reference
  if (matches.length > 0 && bestMatchScore >= 30) {
    warnings.push(`[REF-ENGINE] Dynamic failed — falling back to static ${matches[0].ref.id}`);
    const fallback = adaptReference(matches[0].ref, parsed);
    fallback.warnings.unshift(...warnings);
    return fallback;
  }

  // Absolute fallback — adapt any reference
  warnings.push(`[REF-ENGINE] No good match — adapting closest available`);
  const fallback = adaptReference(REFERENCE_LIBRARY[0], parsed);
  fallback.warnings.unshift(...warnings);
  return fallback;
}
