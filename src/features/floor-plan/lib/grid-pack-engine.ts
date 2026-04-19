/**
 * Grid-Pack Layout Engine — v1.0
 *
 * A COMPLETELY NEW approach to floor plan layout:
 *
 *   Part 1 (LLM): GPT-4o decides which rooms go in which ROW and in
 *     what ORDER. It outputs a ROW ASSIGNMENT (not coordinates).
 *
 *   Part 2 (Algorithm): A deterministic packer computes EXACT coordinates
 *     with MATHEMATICALLY GUARANTEED zero gaps, zero overlaps, zero
 *     floating rooms. Every room fills its cell; every row fills the
 *     full strip width; every strip fills from hallway to plot edge.
 *
 * The algorithm is ~200 lines of simple math:
 *   x_i = x_{i-1} + width_{i-1}
 *   width_last = strip_width - sum(width_0..n-1)
 *
 * Coordinate system: feet, Y-UP, origin (0,0) at SW corner.
 * Output: StripPackResult — plugs directly into existing wall-builder,
 *   door-placer, window-placer, and converter.
 */

import { getClient } from "@/features/ai/services/openai";
import type { ParsedConstraints, ParsedRoom } from "./structured-parser";
import type {
  Facing, Rect, StripPackResult, StripPackRoom,
  StripPackMetrics, SpineLayout, RoomZone, StripAssignment,
} from "./strip-pack/types";
import { normalizeFacing, rectArea } from "./strip-pack/types";
import { buildWalls } from "./strip-pack/wall-builder";
import { placeDoors } from "./strip-pack/door-placer";
import { placeWindows } from "./strip-pack/window-placer";

// ───────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ───────────────────────────────────────────────────────────────────────────

const GPT_MODEL = "gpt-4o";
const GPT_TEMPERATURE = 0.2;
const GPT_MAX_TOKENS = 2048;
const GPT_TIMEOUT_MS = 30_000;

/** Standard hallway width in feet. */
const DEFAULT_HALLWAY_WIDTH_FT = 4;
const NARROW_HALLWAY_WIDTH_FT = 3;

/** Min room dimension after scaling — prevents slivers. */
const MIN_ROOM_DIM_FT = 4;
/** Max aspect ratio — prevents extreme rectangles. */
const MAX_ASPECT_RATIO = 3.0;

const ZONE_MAP: Record<string, RoomZone> = {
  master_bedroom: "PRIVATE", bedroom: "PRIVATE", guest_bedroom: "PRIVATE",
  kids_bedroom: "PRIVATE", study: "PRIVATE",
  living: "PUBLIC", dining: "PUBLIC", drawing_room: "PUBLIC",
  foyer: "ENTRANCE", porch: "ENTRANCE", verandah: "ENTRANCE",
  kitchen: "SERVICE", pantry: "SERVICE", store: "SERVICE",
  utility: "SERVICE", laundry: "SERVICE", servant_quarter: "SERVICE",
  bathroom: "WET", master_bathroom: "WET", powder_room: "WET",
  ensuite: "WET", toilet: "WET",
  pooja: "WORSHIP", prayer: "WORSHIP", mandir: "WORSHIP",
  corridor: "CIRCULATION", hallway: "CIRCULATION", passage: "CIRCULATION",
  balcony: "OUTDOOR", sit_out: "OUTDOOR",
  walk_in_wardrobe: "PRIVATE", walk_in_closet: "PRIVATE",
  staircase: "SERVICE", other: "PRIVATE",
};

const DEFAULT_DIMS: Record<string, [number, number]> = {
  bedroom: [12, 11], master_bedroom: [14, 13], guest_bedroom: [12, 11],
  kids_bedroom: [11, 10], living: [16, 13], dining: [12, 11],
  drawing_room: [12, 10], kitchen: [10, 9], bathroom: [7, 5],
  master_bathroom: [9, 6], ensuite: [8, 5], powder_room: [5, 4],
  toilet: [5, 4], walk_in_wardrobe: [7, 5], walk_in_closet: [7, 5],
  foyer: [8, 7], porch: [9, 6], verandah: [12, 8], balcony: [10, 4],
  corridor: [12, 4], hallway: [12, 4], staircase: [10, 8],
  utility: [6, 5], store: [6, 5], laundry: [6, 5], pantry: [6, 5],
  pooja: [5, 4], prayer: [5, 4], mandir: [5, 4], study: [10, 9],
  servant_quarter: [9, 8], sit_out: [10, 4], other: [10, 8],
};

// ───────────────────────────────────────────────────────────────────────────
// TYPES
// ───────────────────────────────────────────────────────────────────────────

/** The simplified output we ask GPT-4o for — NO coordinates, just grouping. */
export interface RowAssignment {
  hallway_position_pct: number;
  front_rows: string[][];
  back_rows: string[][];
  entrance_rooms?: string[];
}

interface RoomDims {
  w: number;
  d: number;
  type: string;
  zone: RoomZone;
  is_wet: boolean;
  is_sacred: boolean;
  needs_exterior_wall: boolean;
  adjacencies: string[];
  is_attached_to?: string;
  parsedId: string;
}

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────────

export async function runGridPackEngine(
  prompt: string,
  parsed: ParsedConstraints,
  apiKey: string,
  options?: { temperature?: number; variant?: number; rowAssignment?: RowAssignment },
): Promise<StripPackResult> {
  const warnings: string[] = [];
  const facing = normalizeFacing(parsed.plot.facing);
  const plotW = parsed.plot.width_ft ?? 40;
  const plotD = parsed.plot.depth_ft ?? 50;
  const plot: Rect = { x: 0, y: 0, width: plotW, depth: plotD };

  // Preprocess (same fixes as LLM engine: flip inverted attachments, synth porch)
  const fixedParsed = preprocessParsed(parsed, prompt, warnings);

  // Build room dimension map from parsed constraints
  const dimMap = buildDimMap(fixedParsed);

  // Determine hallway width
  const nonCircRooms = fixedParsed.rooms.filter(r => !r.is_circulation).length;
  const plotArea = plotW * plotD;
  const hallwayW = nonCircRooms <= 3 || plotArea < 600
    ? 0
    : (nonCircRooms <= 5 || plotArea < 1000 ? NARROW_HALLWAY_WIDTH_FT : DEFAULT_HALLWAY_WIDTH_FT);

  const isHorizontal = facing === "north" || facing === "south";
  const noHallway = hallwayW === 0;

  // Step 1: Get row assignment (provided, GPT-4o, or fallback)
  const temperature = options?.temperature ?? GPT_TEMPERATURE;
  const allRoomNames = [...dimMap.keys()].filter(n => {
    const d = dimMap.get(n)!;
    return d.zone !== "CIRCULATION"; // don't include hallway/corridor in assignment
  });

  let assignment: RowAssignment;
  if (options?.rowAssignment) {
    assignment = options.rowAssignment;
    warnings.push("Using provided row assignment (bypass GPT-4o)");
  } else {
    const llmStart = Date.now();
    try {
      assignment = await callGPT4oForRowAssignment(
        fixedParsed, allRoomNames, dimMap, plotW, plotD, facing,
        hallwayW, apiKey, temperature, warnings,
      );
    } catch (err) {
      warnings.push(`GPT-4o row assignment failed: ${err instanceof Error ? err.message : String(err)} — using fallback`);
      assignment = buildFallbackAssignment(fixedParsed, dimMap, facing);
    }
    warnings.push(`Row assignment: ${Date.now() - llmStart}ms`);
  }

  // Step 2: Validate assignment — every room present, no duplicates
  assignment = validateAssignment(assignment, allRoomNames, dimMap, warnings);

  // Step 2b: Merge rows that would create extreme aspect ratios
  assignment = mergeSmallRows(assignment, dimMap, plotW, plotD, isHorizontal, hallwayW, warnings);

  // Step 3: Deterministic grid pack
  const packResult = gridPack(assignment, dimMap, plotW, plotD, facing, hallwayW, isHorizontal, noHallway, warnings);

  // Step 4: Build walls, doors, windows using existing pipeline
  const walls = buildWalls({ rooms: packResult.rooms, spine: packResult.spine, plot });
  wireWallIds(packResult.rooms, walls);

  const adjPairs = fixedParsed.adjacency_pairs.map(p => ({ a: p.room_a_id, b: p.room_b_id }));
  const porchRoom = packResult.rooms.find(r => r.type === "porch" || r.type === "verandah");
  const foyerRoom = packResult.rooms.find(r => r.type === "foyer");

  const doorOut = placeDoors({
    rooms: packResult.rooms, walls, spine: packResult.spine,
    adjacencyPairs: adjPairs, porchId: porchRoom?.id, foyerId: foyerRoom?.id,
  });
  warnings.push(...doorOut.warnings);

  const winOut = placeWindows({
    rooms: packResult.rooms, walls, doors: doorOut.doors, facing,
  });
  warnings.push(...winOut.warnings);

  // Step 5: Metrics
  const metrics = computeMetrics(
    packResult.rooms, packResult.spine, plot,
    adjPairs.length, doorOut.doors,
  );

  return {
    rooms: packResult.rooms,
    spine: packResult.spine,
    walls,
    doors: doorOut.doors,
    windows: winOut.windows,
    plot,
    metrics,
    warnings,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// GPT-4o ROW ASSIGNMENT CALL
// ───────────────────────────────────────────────────────────────────────────

async function callGPT4oForRowAssignment(
  parsed: ParsedConstraints,
  roomNames: string[],
  dimMap: Map<string, RoomDims>,
  plotW: number,
  plotD: number,
  facing: Facing,
  hallwayW: number,
  apiKey: string,
  temperature: number,
  warnings: string[],
): Promise<RowAssignment> {
  const entranceSide = {
    north: "north (top, high Y)", south: "south (bottom, low Y)",
    east: "east (right, high X)", west: "west (left, low X)",
  }[facing];

  const roomListStr = roomNames.map(name => {
    const d = dimMap.get(name)!;
    return `  - ${name}: ${d.w}ft × ${d.d}ft (${d.type}, ${d.zone})`;
  }).join("\n");

  // Build adjacency hints
  const adjHints = parsed.adjacency_pairs
    .filter(p => {
      const a = parsed.rooms.find(r => r.id === p.room_a_id);
      const b = parsed.rooms.find(r => r.id === p.room_b_id);
      return a && b;
    })
    .map(p => {
      const a = parsed.rooms.find(r => r.id === p.room_a_id)!;
      const b = parsed.rooms.find(r => r.id === p.room_b_id)!;
      return `${a.name} ↔ ${b.name}`;
    });

  // Build attachment hints (ensuite/wardrobe → parent bedroom)
  const attachHints: string[] = [];
  for (const [name, dims] of dimMap) {
    if (dims.is_attached_to) {
      attachHints.push(`${name} MUST be in the same row as ${dims.is_attached_to}`);
    }
  }

  // Build small-room list for the prompt
  const smallRooms = roomNames.filter(name => {
    const d = dimMap.get(name)!;
    return d.w * d.d < 50;
  });

  const systemPrompt = `You are an expert residential architect. Given a room list and plot dimensions, output a ROW ASSIGNMENT — which rooms go in which row, on which side of the hallway.

PLOT: ${plotW}ft wide × ${plotD}ft deep, ${facing}-facing
ENTRANCE: on the ${entranceSide} side
${hallwayW > 0 ? `HALLWAY: ${hallwayW}ft wide, runs ${facing === "north" || facing === "south" ? "east-west (horizontal)" : "north-south (vertical)"}, divides plot into entrance side and back side` : "NO HALLWAY (small layout)"}

ROOMS:
${roomListStr}

${adjHints.length > 0 ? `ADJACENCY (these rooms MUST be in the SAME ROW):\n${adjHints.map(h => `  - ${h}`).join("\n")}` : ""}
${attachHints.length > 0 ? `\nATTACHED ROOMS (MUST be in the SAME ROW as parent — NON-NEGOTIABLE):\n${attachHints.map(h => `  - ${h}`).join("\n")}` : ""}
${smallRooms.length > 0 ? `\nSMALL ROOMS (under 50 sqft — NEVER put these alone in a row, always merge with larger rooms):\n  ${smallRooms.join(", ")}` : ""}

OUTPUT FORMAT (JSON only, no markdown fences):
{
  "hallway_position_pct": <number 35-50>,
  "front_rows": [
    ["Room1", "Room2", "Room3"],
    ["Room4", "Room5"]
  ],
  "back_rows": [
    ["Room6", "Room7", "Room8"],
    ["Room9", "Room10"]
  ]
}

GROUPING RULES (follow STRICTLY — violations will be rejected):

1. ATTACHED ROOMS IN SAME ROW (NON-NEGOTIABLE):
   - Master Bedroom + Ensuite Bathroom + Walk-in Wardrobe = ONE ROW
   - Bedroom + Attached Bathroom = ONE ROW
   - NEVER separate an attached room from its parent bedroom

2. ADJACENT ROOMS IN SAME ROW:
   - Kitchen + Dining Room = same row (they share a serving wall)
   - Living Room + Dining Room = same row (open plan flow)
   - If the user says rooms are "adjacent" or "flowing into" each other → same row

3. SMALL ROOMS MUST MERGE WITH LARGER ROOMS:
   - Rooms under 50 sqft (pooja, store, utility, pantry, powder room, walk-in wardrobe) must NEVER be alone in a row
   - Add small rooms to the END of a row with a large room
   - Example: ["Master Bedroom", "Ensuite Bathroom", "Walk-in Wardrobe", "Pooja Room"]
   - Example: ["Bedroom 2", "Attached Bathroom", "Store Room"]

4. ROW COUNT — MAXIMUM 3 ROWS PER SIDE:
   - Front side: 1-2 rows (public/entrance rooms)
   - Back side: 2-3 rows (private/service rooms)
   - Too many rows creates thin strips — aim for FEWER, FULLER rows

5. ROW SIZING:
   - Each row should have 2-5 rooms
   - Total requested width of rooms in a row should be roughly ${Math.round(plotW * 0.7)}-${plotW}ft (near plot width)
   - If one room is very large (16ft+), pair it with 1-2 small rooms only
   - If all rooms are small (5-8ft), pack 4-5 in a row

6. ENTRANCE ROOMS:
   - Porch + Foyer go in the LAST front_row with other public rooms (Drawing Room, Common Bathroom)
   - Do NOT put Porch/Foyer in their own row — always combine with other rooms

7. SIDE ASSIGNMENT:
   - FRONT (entrance side): Living, Dining, Foyer, Porch, Drawing Room, guest areas
   - BACK (far side): Bedrooms, Kitchen, Utility, Bathrooms, private areas

8. Every room from the ROOMS list must appear in exactly one row. Do NOT omit any room.

DO NOT output coordinates. Only output the row assignment as JSON.`;

  const client = getClient(apiKey, GPT_TIMEOUT_MS);
  const resp = await client.chat.completions.create({
    model: GPT_MODEL,
    temperature,
    max_tokens: GPT_MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Design the row layout for this house:\n\n${parsed.extraction_notes || "Standard residential layout"}` },
    ],
  });

  const raw = resp.choices[0]?.message?.content;
  if (!raw) throw new Error("GPT-4o returned empty content");
  const data = JSON.parse(raw.replace(/```json\s*|```\s*/g, "").trim()) as RowAssignment;

  if (!Array.isArray(data.front_rows) || !Array.isArray(data.back_rows)) {
    throw new Error("GPT-4o response missing front_rows or back_rows arrays");
  }

  warnings.push(`GPT-4o row assignment: front=${data.front_rows.length} rows, back=${data.back_rows.length} rows, hallway=${data.hallway_position_pct}%`);
  return data;
}

// ───────────────────────────────────────────────────────────────────────────
// FALLBACK ASSIGNMENT (when GPT-4o fails)
// ───────────────────────────────────────────────────────────────────────────

function buildFallbackAssignment(
  parsed: ParsedConstraints,
  dimMap: Map<string, RoomDims>,
  facing: Facing,
): RowAssignment {
  const frontRooms: string[] = [];
  const backRooms: string[] = [];
  const entranceRooms: string[] = [];

  for (const [name, dims] of dimMap) {
    if (dims.zone === "CIRCULATION") continue;
    if (dims.zone === "ENTRANCE") { entranceRooms.push(name); continue; }
    if (dims.zone === "PUBLIC") { frontRooms.push(name); continue; }
    backRooms.push(name);
  }

  // Chunk into rows of 2-3 rooms
  const chunkRows = (rooms: string[], maxPerRow = 3): string[][] => {
    const rows: string[][] = [];
    for (let i = 0; i < rooms.length; i += maxPerRow) {
      rows.push(rooms.slice(i, i + maxPerRow));
    }
    return rows.length > 0 ? rows : [];
  };

  return {
    hallway_position_pct: 42,
    front_rows: chunkRows(frontRooms),
    back_rows: chunkRows(backRooms),
    entrance_rooms: entranceRooms,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// VALIDATE ASSIGNMENT
// ───────────────────────────────────────────────────────────────────────────

function validateAssignment(
  raw: RowAssignment,
  allNames: string[],
  dimMap: Map<string, RoomDims>,
  warnings: string[],
): RowAssignment {
  const result: RowAssignment = {
    hallway_position_pct: Math.max(25, Math.min(60, raw.hallway_position_pct || 42)),
    front_rows: (raw.front_rows || []).map(row => [...row]),
    back_rows: (raw.back_rows || []).map(row => [...row]),
    entrance_rooms: [...(raw.entrance_rooms || [])],
  };

  // Build a name→canonical lookup (case-insensitive fuzzy match)
  const canonicalNames = new Map<string, string>();
  for (const name of allNames) canonicalNames.set(name.toLowerCase(), name);

  // Resolve all names in the assignment to canonical names
  const resolveRow = (row: string[]): string[] =>
    row.map(n => canonicalNames.get(n.toLowerCase()) ?? n)
       .filter(n => dimMap.has(n));

  result.front_rows = result.front_rows.map(resolveRow).filter(r => r.length > 0);
  result.back_rows = result.back_rows.map(resolveRow).filter(r => r.length > 0);
  result.entrance_rooms = (result.entrance_rooms || [])
    .map(n => canonicalNames.get(n.toLowerCase()) ?? n)
    .filter(n => dimMap.has(n));

  // Collect all assigned room names
  const assigned = new Set<string>();
  const markAssigned = (name: string) => {
    if (assigned.has(name)) {
      warnings.push(`Duplicate room in assignment: ${name} — removing duplicate`);
      return false;
    }
    assigned.add(name);
    return true;
  };

  // Deduplicate
  result.entrance_rooms = result.entrance_rooms!.filter(markAssigned);
  result.front_rows = result.front_rows.map(row => row.filter(markAssigned)).filter(r => r.length > 0);
  result.back_rows = result.back_rows.map(row => row.filter(markAssigned)).filter(r => r.length > 0);

  // Merge entrance rooms into the last front row (not a separate row).
  // A single small porch in its own row gets stretched to full plot width
  // creating extreme aspect ratios. Merging into an existing row avoids this.
  if (result.entrance_rooms!.length > 0) {
    if (result.front_rows.length > 0) {
      // Add to the last front row (closest to entrance wall)
      const lastRow = result.front_rows[result.front_rows.length - 1];
      for (const name of result.entrance_rooms!) {
        if (!lastRow.includes(name)) lastRow.push(name);
      }
    } else {
      result.front_rows.push([...result.entrance_rooms!]);
    }
  }

  // Find missing rooms — add them to the appropriate side
  for (const name of allNames) {
    if (assigned.has(name)) continue;
    const dims = dimMap.get(name)!;
    warnings.push(`Room "${name}" missing from LLM assignment — adding to ${dims.zone === "PUBLIC" || dims.zone === "ENTRANCE" ? "front" : "back"}`);

    if (dims.zone === "PUBLIC" || dims.zone === "ENTRANCE") {
      if (result.front_rows.length > 0) {
        result.front_rows[0].push(name);
      } else {
        result.front_rows.push([name]);
      }
    } else {
      if (result.back_rows.length > 0) {
        result.back_rows[0].push(name);
      } else {
        result.back_rows.push([name]);
      }
    }
    assigned.add(name);
  }

  // ── Post-validation: force attached rooms into parent's row ──────────
  coerceAttachedRooms(result, dimMap, warnings);

  // ── Post-validation: coerce adjacent rooms into same row ─────────────
  coerceAdjacentRooms(result, dimMap, warnings);

  // Ensure at least one row on each side
  if (result.front_rows.length === 0) result.front_rows.push([]);
  if (result.back_rows.length === 0) result.back_rows.push([]);

  // Remove empty rows
  result.front_rows = result.front_rows.filter(r => r.length > 0);
  result.back_rows = result.back_rows.filter(r => r.length > 0);

  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// POST-VALIDATION COERCIONS
// ───────────────────────────────────────────────────────────────────────────

/** Find which row (across front + back) contains a room name. Returns the row array or null. */
function findRowContaining(assignment: RowAssignment, name: string): string[] | null {
  for (const row of assignment.front_rows) {
    if (row.includes(name)) return row;
  }
  for (const row of assignment.back_rows) {
    if (row.includes(name)) return row;
  }
  return null;
}

/** Remove a room name from whichever row it's in. */
function removeFromRows(assignment: RowAssignment, name: string): void {
  for (const row of assignment.front_rows) {
    const idx = row.indexOf(name);
    if (idx >= 0) { row.splice(idx, 1); return; }
  }
  for (const row of assignment.back_rows) {
    const idx = row.indexOf(name);
    if (idx >= 0) { row.splice(idx, 1); return; }
  }
}

/**
 * Force attached rooms (ensuite, wardrobe) into the same row as their parent.
 * If they're in different rows, move the child to the parent's row.
 */
function coerceAttachedRooms(
  assignment: RowAssignment,
  dimMap: Map<string, RoomDims>,
  warnings: string[],
): void {
  for (const [childName, dims] of dimMap) {
    if (!dims.is_attached_to) continue;
    const parentName = dims.is_attached_to;
    if (!dimMap.has(parentName)) continue;

    const childRow = findRowContaining(assignment, childName);
    const parentRow = findRowContaining(assignment, parentName);

    if (!childRow || !parentRow || childRow === parentRow) continue;

    // Move child to parent's row (place it right after the parent)
    removeFromRows(assignment, childName);
    const parentIdx = parentRow.indexOf(parentName);
    parentRow.splice(parentIdx + 1, 0, childName);
    warnings.push(`Coerced "${childName}" into same row as "${parentName}" (attached room)`);
  }

  // Clean up empty rows
  assignment.front_rows = assignment.front_rows.filter(r => r.length > 0);
  assignment.back_rows = assignment.back_rows.filter(r => r.length > 0);
}

/**
 * Coerce adjacent rooms into the same row. If two rooms are marked adjacent
 * (e.g. Kitchen ↔ Dining) but in different rows, move the smaller one to
 * the larger one's row.
 */
function coerceAdjacentRooms(
  assignment: RowAssignment,
  dimMap: Map<string, RoomDims>,
  warnings: string[],
): void {
  for (const [name, dims] of dimMap) {
    for (const adjName of dims.adjacencies) {
      if (!dimMap.has(adjName)) continue;

      const rowA = findRowContaining(assignment, name);
      const rowB = findRowContaining(assignment, adjName);

      if (!rowA || !rowB || rowA === rowB) continue;

      // Move the smaller room to the larger room's row
      const areaA = dims.w * dims.d;
      const adjDims = dimMap.get(adjName)!;
      const areaB = adjDims.w * adjDims.d;

      if (areaA <= areaB) {
        removeFromRows(assignment, name);
        // Place adjacent to the partner
        const partnerIdx = rowB.indexOf(adjName);
        rowB.splice(partnerIdx + 1, 0, name);
        warnings.push(`Coerced "${name}" into same row as "${adjName}" (adjacent rooms)`);
      } else {
        removeFromRows(assignment, adjName);
        const partnerIdx = rowA.indexOf(name);
        rowA.splice(partnerIdx + 1, 0, adjName);
        warnings.push(`Coerced "${adjName}" into same row as "${name}" (adjacent rooms)`);
      }
    }
  }

  assignment.front_rows = assignment.front_rows.filter(r => r.length > 0);
  assignment.back_rows = assignment.back_rows.filter(r => r.length > 0);
}

// ───────────────────────────────────────────────────────────────────────────
// MERGE SMALL ROWS (prevent extreme aspect ratios)
// ───────────────────────────────────────────────────────────────────────────

/**
 * After validation, check if any rows would produce rooms with extreme
 * aspect ratios. If a row has only 1 room that would be wider than
 * MAX_ASPECT_RATIO × its depth, merge it into the adjacent row.
 * Also merge rows when the strip has too many rows for its depth.
 */
function mergeSmallRows(
  assignment: RowAssignment,
  dimMap: Map<string, RoomDims>,
  plotW: number,
  plotD: number,
  isHorizontal: boolean,
  hallwayW: number,
  warnings: string[],
): RowAssignment {
  const result = {
    ...assignment,
    front_rows: assignment.front_rows.map(r => [...r]),
    back_rows: assignment.back_rows.map(r => [...r]),
  };

  // Compute approximate strip depths
  const pct = assignment.hallway_position_pct / 100;
  const totalDim = isHorizontal ? plotD : plotW;
  const frontDepth = Math.round(totalDim * pct * 2) / 2;
  const backDepth = totalDim - frontDepth - hallwayW;

  result.front_rows = mergeRowsForStrip(result.front_rows, dimMap, frontDepth, isHorizontal, warnings);
  result.back_rows = mergeRowsForStrip(result.back_rows, dimMap, backDepth, isHorizontal, warnings);

  return result;
}

function mergeRowsForStrip(
  rows: string[][],
  dimMap: Map<string, RoomDims>,
  stripDepth: number,
  isHorizontal: boolean,
  warnings: string[],
): string[][] {
  if (rows.length <= 1) return rows;

  const merged = rows.map(r => [...r]);

  /** Pick best adjacent row to merge into (fewest rooms, preferring previous). */
  const pickTarget = (idx: number, arr: string[][]): number => {
    if (idx > 0 && idx < arr.length - 1) {
      return arr[idx - 1].length <= arr[idx + 1].length ? idx - 1 : idx + 1;
    }
    return idx > 0 ? idx - 1 : 1;
  };

  /** Compute the raw (pre-scale) depth of a row. */
  const rawDepth = (row: string[]): number =>
    Math.max(MIN_ROOM_DIM_FT, ...row.map(name => {
      const d = dimMap.get(name);
      return d ? (isHorizontal ? d.d : d.w) : 10;
    }));

  /** Compute room area from dimMap. */
  const roomArea = (name: string): number => {
    const d = dimMap.get(name);
    return d ? d.w * d.d : 100;
  };

  // Pass 1: Merge rows where ALL rooms are tiny (<50 sqft) AND the row
  // would be too thin after scaling. Only triggers when there are 3+ rows
  // (so the tiny row is getting squeezed).
  let changed = true;
  while (changed && merged.length > 2) {
    changed = false;
    const depths = merged.map(rawDepth);
    const totalD = depths.reduce((s, d) => s + d, 0);
    const sc = stripDepth / totalD;

    for (let i = 0; i < merged.length; i++) {
      const allTiny = merged[i].every(name => roomArea(name) < 50);
      const scaledD = depths[i] * sc;
      if (allTiny && merged[i].length <= 3 && scaledD < 6) {
        const target = pickTarget(i, merged);
        warnings.push(`Merging all-tiny row [${merged[i].join(", ")}] into [${merged[target].join(", ")}]`);
        merged[target].push(...merged[i]);
        merged.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  // Pass 2: Merge single-room rows where the room is small (<150 sqft).
  // Large single-room rows (e.g. Living Room 16×13 = 208 sqft) are fine.
  changed = true;
  while (changed && merged.length > 1) {
    changed = false;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i].length === 1 && roomArea(merged[i][0]) < 150) {
        const target = pickTarget(i, merged);
        warnings.push(`Merging single-room row [${merged[i][0]}] into [${merged[target].join(", ")}]`);
        merged[target].push(...merged[i]);
        merged.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  // Pass 3: Merge rows that would be too thin after proportional depth scaling.
  changed = true;
  while (changed && merged.length > 1) {
    changed = false;
    const depths = merged.map(rawDepth);
    const totalD = depths.reduce((s, d) => s + d, 0);
    const sc = stripDepth / totalD;

    for (let i = 0; i < merged.length; i++) {
      const scaledDepth = depths[i] * sc;

      // Merge if row depth after scaling < MIN_ROOM_DIM_FT
      if (scaledDepth < MIN_ROOM_DIM_FT) {
        const target = pickTarget(i, merged);
        warnings.push(`Merging thin row [${merged[i].join(", ")}] (${scaledDepth.toFixed(1)}ft) into [${merged[target].join(", ")}]`);
        merged[target].push(...merged[i]);
        merged.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return merged;
}

// ───────────────────────────────────────────────────────────────────────────
// DETERMINISTIC GRID PACKER
// ───────────────────────────────────────────────────────────────────────────

interface PackOutput {
  rooms: StripPackRoom[];
  spine: SpineLayout;
}

function gridPack(
  assignment: RowAssignment,
  dimMap: Map<string, RoomDims>,
  plotW: number,
  plotD: number,
  facing: Facing,
  hallwayW: number,
  isHorizontal: boolean,
  noHallway: boolean,
  warnings: string[],
): PackOutput {
  // For horizontal spine (N/S facing): hallway runs east-west
  // For vertical spine (E/W facing): hallway runs north-south
  // We compute in the horizontal case, then adjust for vertical at the end.

  // Step 1: Compute hallway position
  let hallwayY: number;
  let frontDepth: number;
  let backDepth: number;
  const hallway: Rect = { x: 0, y: 0, width: 0, depth: 0 };

  if (noHallway) {
    // No hallway — everything is one strip
    hallwayY = 0;
    frontDepth = isHorizontal ? plotD : plotW;
    backDepth = 0;
  } else if (isHorizontal) {
    // Hallway runs east-west at some Y position
    // For south-facing: entrance at low Y, hallway_position_pct from bottom
    // For north-facing: entrance at high Y, hallway_position_pct from top
    const pct = assignment.hallway_position_pct / 100;
    if (facing === "south") {
      // Entrance at y=0 (south). Front strip = y=0 to hallway. Back strip = hallway to plotD.
      frontDepth = Math.round(plotD * pct * 2) / 2;
      hallwayY = frontDepth;
      backDepth = plotD - frontDepth - hallwayW;
    } else {
      // Entrance at y=plotD (north). Front strip = hallway to plotD. Back strip = 0 to hallway.
      backDepth = Math.round(plotD * pct * 2) / 2;
      hallwayY = backDepth;
      frontDepth = plotD - backDepth - hallwayW;
    }
    hallway.x = 0;
    hallway.y = hallwayY;
    hallway.width = plotW;
    hallway.depth = hallwayW;
  } else {
    // Vertical spine: hallway runs north-south
    const pct = assignment.hallway_position_pct / 100;
    if (facing === "west") {
      frontDepth = Math.round(plotW * pct * 2) / 2;
      hallwayY = frontDepth; // actually hallwayX in plot coords
      backDepth = plotW - frontDepth - hallwayW;
    } else {
      backDepth = Math.round(plotW * pct * 2) / 2;
      hallwayY = backDepth;
      frontDepth = plotW - backDepth - hallwayW;
    }
    hallway.x = hallwayY; // for vertical, x position
    hallway.y = 0;
    hallway.width = hallwayW;
    hallway.depth = plotD;
  }

  // Ensure minimum strip depths
  frontDepth = Math.max(frontDepth, MIN_ROOM_DIM_FT);
  backDepth = Math.max(backDepth, noHallway ? 0 : MIN_ROOM_DIM_FT);

  // Step 2: Compute front and back strip rects
  let frontStrip: Rect;
  let backStrip: Rect;

  if (isHorizontal) {
    if (facing === "south") {
      frontStrip = { x: 0, y: 0, width: plotW, depth: frontDepth };
      backStrip = { x: 0, y: hallwayY + hallwayW, width: plotW, depth: backDepth };
    } else {
      // north-facing: front is at top (high Y)
      backStrip = { x: 0, y: 0, width: plotW, depth: backDepth };
      frontStrip = { x: 0, y: hallwayY + hallwayW, width: plotW, depth: frontDepth };
    }
  } else {
    if (facing === "west") {
      frontStrip = { x: 0, y: 0, width: frontDepth, depth: plotD };
      backStrip = { x: hallwayY + hallwayW, y: 0, width: backDepth, depth: plotD };
    } else {
      // east-facing: front is at right (high X)
      backStrip = { x: 0, y: 0, width: backDepth, depth: plotD };
      frontStrip = { x: hallwayY + hallwayW, y: 0, width: frontDepth, depth: plotD };
    }
  }

  // Step 3: Pack rows into strips
  const frontRooms = noHallway
    ? packRowsIntoStrip(
        [...assignment.front_rows, ...assignment.back_rows],
        dimMap, frontStrip, "FRONT", isHorizontal, warnings,
      )
    : packRowsIntoStrip(assignment.front_rows, dimMap, frontStrip, "FRONT", isHorizontal, warnings);

  const backRooms = noHallway
    ? []
    : packRowsIntoStrip(assignment.back_rows, dimMap, backStrip, "BACK", isHorizontal, warnings);

  // Step 4: Build hallway room
  const hallwayRoom: StripPackRoom = {
    id: "gp_hallway",
    name: "Hallway",
    type: "corridor",
    requested_width_ft: isHorizontal ? plotW : hallwayW,
    requested_depth_ft: isHorizontal ? hallwayW : plotD,
    requested_area_sqft: noHallway ? 0 : (isHorizontal ? plotW * hallwayW : hallwayW * plotD),
    zone: "CIRCULATION",
    strip: "SPINE",
    adjacencies: [],
    needs_exterior_wall: false,
    is_wet: false,
    is_sacred: false,
    placed: noHallway ? undefined : { ...hallway },
    actual_area_sqft: noHallway ? 0 : rectArea(hallway),
  };

  const allRooms = [...frontRooms, ...backRooms];
  if (!noHallway) allRooms.push(hallwayRoom);

  // Step 5: Build spine layout
  const spine: SpineLayout = {
    spine: { ...hallway },
    front_strip: { ...frontStrip },
    back_strip: noHallway ? { x: 0, y: 0, width: 0, depth: 0 } : { ...backStrip },
    entrance_rooms: [],
    remaining_front: [{ ...frontStrip }],
    orientation: isHorizontal ? "horizontal" : "vertical",
    entrance_side: facing,
    hallway_width_ft: hallwayW,
  };

  return { rooms: allRooms, spine };
}

// ───────────────────────────────────────────────────────────────────────────
// PACK ROWS INTO A STRIP
// ───────────────────────────────────────────────────────────────────────────

/**
 * Given rows of room names and a strip rect, place every room with
 * MATHEMATICALLY GUARANTEED zero gaps and zero overlaps.
 *
 * Algorithm:
 *   1. Compute row depths proportional to the tallest room in each row.
 *   2. Within each row, compute room widths proportional to requested width.
 *   3. Last room's width = strip_width - sum(previous widths).  ← zero gap
 *   4. Last row's depth = strip_depth - sum(previous depths).  ← zero gap
 */
function packRowsIntoStrip(
  rows: string[][],
  dimMap: Map<string, RoomDims>,
  strip: Rect,
  stripAssignment: "FRONT" | "BACK",
  isHorizontal: boolean,
  warnings: string[],
): StripPackRoom[] {
  if (rows.length === 0) return [];

  const result: StripPackRoom[] = [];

  // The "width" of the strip is the dimension rooms pack along (left-to-right)
  // The "depth" of the strip is the dimension rows stack along
  const stripW = isHorizontal ? strip.width : strip.depth;
  const stripD = isHorizontal ? strip.depth : strip.width;

  // Compute row depths: proportional to tallest room in each row
  const rowMaxDepths = rows.map(row => {
    if (row.length === 0) return MIN_ROOM_DIM_FT;
    return Math.max(
      MIN_ROOM_DIM_FT,
      ...row.map(name => {
        const d = dimMap.get(name);
        // Use depth for horizontal, width for vertical
        return d ? (isHorizontal ? d.d : d.w) : 10;
      }),
    );
  });

  const totalRequestedDepth = rowMaxDepths.reduce((s, d) => s + d, 0);
  const depthScale = stripD / totalRequestedDepth;
  const scaledRowDepths = rowMaxDepths.map(d => d * depthScale);

  // Ensure last row fills exactly to edge (float-safe)
  const sumBeforeLastRow = scaledRowDepths.slice(0, -1).reduce((s, d) => s + d, 0);
  scaledRowDepths[scaledRowDepths.length - 1] = stripD - sumBeforeLastRow;

  // Place each row
  let currentDepthOffset = 0;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    if (row.length === 0) continue;

    const rowDepth = scaledRowDepths[rowIdx];

    // Compute room widths: proportional to requested width, scaled to fill strip
    const rawWidths = row.map(name => {
      const d = dimMap.get(name);
      return d ? (isHorizontal ? d.w : d.d) : 10;
    });
    const totalRequestedWidth = rawWidths.reduce((s, w) => s + w, 0);
    const widthScale = stripW / totalRequestedWidth;
    const scaledWidths = rawWidths.map(w => w * widthScale);

    // Last room fills to edge (eliminates floating-point gap)
    const sumBeforeLast = scaledWidths.slice(0, -1).reduce((s, w) => s + w, 0);
    scaledWidths[scaledWidths.length - 1] = stripW - sumBeforeLast;

    // Check aspect ratios — warn but don't fail
    for (let i = 0; i < row.length; i++) {
      const w = scaledWidths[i];
      const d = rowDepth;
      const ar = Math.max(w, d) / Math.min(w, d);
      if (ar > MAX_ASPECT_RATIO) {
        warnings.push(`Room "${row[i]}" has aspect ratio ${ar.toFixed(1)} (${w.toFixed(1)}×${d.toFixed(1)}ft) — may look stretched`);
      }
    }

    // Place rooms left-to-right
    let currentWidthOffset = 0;
    for (let i = 0; i < row.length; i++) {
      const name = row[i];
      const dims = dimMap.get(name);
      const roomW = scaledWidths[i];
      const roomD = rowDepth;

      // Compute actual position in plot coordinates
      let px: number, py: number, pw: number, pd: number;
      if (isHorizontal) {
        px = strip.x + currentWidthOffset;
        py = strip.y + currentDepthOffset;
        pw = roomW;
        pd = roomD;
      } else {
        // Vertical spine: swap width/depth mapping
        px = strip.x + currentDepthOffset;
        py = strip.y + currentWidthOffset;
        pw = roomD;
        pd = roomW;
      }

      const placed: Rect = { x: px, y: py, width: pw, depth: pd };

      result.push({
        id: `gp_${(dims?.parsedId ?? name).toLowerCase().replace(/[\s]+/g, "_").replace(/[^a-z0-9_]/g, "")}`,
        name,
        type: dims?.type ?? "other",
        requested_width_ft: dims?.w ?? roomW,
        requested_depth_ft: dims?.d ?? roomD,
        requested_area_sqft: (dims?.w ?? roomW) * (dims?.d ?? roomD),
        zone: dims?.zone ?? "PRIVATE",
        strip: stripAssignment,
        adjacencies: dims?.adjacencies ?? [],
        is_attached_to: dims?.is_attached_to,
        needs_exterior_wall: dims?.needs_exterior_wall ?? false,
        is_wet: dims?.is_wet ?? false,
        is_sacred: dims?.is_sacred ?? false,
        placed,
        actual_area_sqft: pw * pd,
      });

      currentWidthOffset += roomW;
    }

    currentDepthOffset += rowDepth;
  }

  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────────────────

function buildDimMap(parsed: ParsedConstraints): Map<string, RoomDims> {
  const map = new Map<string, RoomDims>();

  // Build adjacency lookup
  const adjByRoom = new Map<string, string[]>();
  for (const adj of parsed.adjacency_pairs) {
    const a = parsed.rooms.find(r => r.id === adj.room_a_id);
    const b = parsed.rooms.find(r => r.id === adj.room_b_id);
    if (a && b) {
      if (!adjByRoom.has(a.name)) adjByRoom.set(a.name, []);
      if (!adjByRoom.has(b.name)) adjByRoom.set(b.name, []);
      adjByRoom.get(a.name)!.push(b.name);
      adjByRoom.get(b.name)!.push(a.name);
    }
  }

  for (const r of parsed.rooms) {
    const fn = r.function;
    const [defW, defD] = DEFAULT_DIMS[fn] ?? DEFAULT_DIMS.other;
    const w = r.dim_width_ft ?? defW;
    const d = r.dim_depth_ft ?? defD;

    // Resolve attached parent name
    let attachedName: string | undefined;
    if (r.attached_to_room_id) {
      const parent = parsed.rooms.find(p => p.id === r.attached_to_room_id);
      attachedName = parent?.name;
    }

    map.set(r.name, {
      w, d, type: fn,
      zone: ZONE_MAP[fn] ?? "PRIVATE",
      is_wet: r.is_wet,
      is_sacred: r.is_sacred,
      needs_exterior_wall: r.must_have_window_on != null ||
        ZONE_MAP[fn] === "PUBLIC" || fn.includes("bedroom"),
      adjacencies: adjByRoom.get(r.name) ?? [],
      is_attached_to: attachedName,
      parsedId: r.id,
    });
  }

  return map;
}

function wireWallIds(rooms: StripPackRoom[], walls: import("./strip-pack/types").WallSegment[]) {
  const m = new Map<string, string[]>();
  for (const w of walls) {
    for (const id of w.room_ids) {
      if (!m.has(id)) m.set(id, []);
      m.get(id)!.push(w.id);
    }
  }
  for (const r of rooms) r.wall_ids = m.get(r.id) ?? [];
}

function computeMetrics(
  rooms: StripPackRoom[],
  spine: SpineLayout,
  plot: Rect,
  reqAdj: number,
  doors: import("./strip-pack/types").DoorPlacement[],
): StripPackMetrics {
  let occupied = spine.spine.width * spine.spine.depth;
  for (const r of rooms) if (r.placed) occupied += rectArea(r.placed);
  const pa = rectArea(plot);

  // Count rooms with doors
  const roomsWithDoors = new Set<string>();
  for (const d of doors) {
    roomsWithDoors.add(d.between[0]);
    roomsWithDoors.add(d.between[1]);
  }
  const placedRooms = rooms.filter(r => r.placed && r.zone !== "CIRCULATION");
  const rwdCount = placedRooms.filter(r => roomsWithDoors.has(r.name) || roomsWithDoors.has(r.id)).length;

  // Count orphan rooms (no doors)
  const orphans = placedRooms
    .filter(r => !roomsWithDoors.has(r.name) && !roomsWithDoors.has(r.id))
    .map(r => r.name);

  return {
    efficiency_pct: Math.round(Math.min(100, (occupied / pa) * 100) * 10) / 10,
    void_area_sqft: Math.round(Math.max(0, pa - occupied)),
    door_coverage_pct: placedRooms.length > 0 ? Math.round((rwdCount / placedRooms.length) * 100) : 0,
    orphan_rooms: orphans,
    adjacency_satisfaction_pct: 0,
    total_rooms: rooms.length,
    rooms_with_doors: rwdCount,
    required_adjacencies: reqAdj,
    satisfied_adjacencies: 0,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// PREPROCESSOR (same as LLM engine — fix known parser bugs)
// ───────────────────────────────────────────────────────────────────────────

function preprocessParsed(
  raw: ParsedConstraints,
  prompt: string | undefined,
  warnings: string[],
): ParsedConstraints {
  const parsed: ParsedConstraints = {
    ...raw, plot: { ...raw.plot },
    rooms: raw.rooms.map(r => ({
      ...r,
      doors: r.doors.map(d => ({ ...d })),
      windows: r.windows.map(w => ({ ...w })),
    })),
    adjacency_pairs: raw.adjacency_pairs.map(a => ({ ...a })),
    connects_all_groups: raw.connects_all_groups.map(g => ({
      ...g, connected_room_ids: [...g.connected_room_ids],
    })),
    special_features: raw.special_features.map(f => ({ ...f })),
    constraint_budget: { ...raw.constraint_budget },
  };

  // Flip inverted attachments
  const PARENTS = new Set(["master_bedroom", "bedroom", "guest_bedroom", "kids_bedroom"]);
  const CHILDREN = new Set(["bathroom", "master_bathroom", "powder_room", "walk_in_wardrobe", "walk_in_closet"]);
  const byId = new Map(parsed.rooms.map(r => [r.id, r]));
  for (const r of parsed.rooms) {
    if (!r.attached_to_room_id) continue;
    const t = byId.get(r.attached_to_room_id);
    if (t && PARENTS.has(r.function) && CHILDREN.has(t.function)) {
      r.attached_to_room_id = null;
      if (!t.attached_to_room_id) t.attached_to_room_id = r.id;
      warnings.push(`Flipped inverted attachment: ${r.name} → ${t.name}`);
    }
  }

  // Synthesize missing porch
  if (!parsed.rooms.some(r => r.function === "porch" || r.function === "verandah")) {
    const hasFeat = parsed.special_features.some(
      f => (f.feature === "porch" || f.feature === "verandah") && f.mentioned_verbatim,
    );
    if (hasFeat || (prompt && /porch/i.test(prompt))) {
      let w = 6, d = 5;
      if (prompt) {
        const m = prompt.match(/(\d+)\s*(?:ft)?\s*[x×]\s*(\d+)\s*(?:ft)?\s+(?:porch|verandah)/i);
        if (m) { w = +m[1] || 6; d = +m[2] || 5; }
      }
      parsed.rooms.push({
        id: "__synth_porch", name: "Porch", function: "porch",
        dim_width_ft: w, dim_depth_ft: d, position_type: "wall_centered",
        position_direction: parsed.plot.facing, attached_to_room_id: null,
        must_have_window_on: null, external_walls_ft: null, internal_walls_ft: null,
        doors: [], windows: [], is_wet: false, is_sacred: false, is_circulation: false,
        user_explicit_dims: true, user_explicit_position: true,
      });
      warnings.push(`Synthesized porch (${w}×${d}ft)`);
    }
  }

  return parsed;
}
