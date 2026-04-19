/**
 * LLM-driven floor plan layout engine (v2).
 *
 * Asks GPT-4o to place rooms on the plot as JSON coordinates, then feeds
 * those coordinates through the existing wall-builder → door-placer →
 * window-placer pipeline. Includes validate-and-repair to fix the LLM's
 * typical errors (small gaps, overlaps, rooms outside plot) and retry-with-
 * feedback when connectivity is poor.
 */

import { getClient } from "@/features/ai/services/openai";
import type { ParsedConstraints, ParsedRoom } from "./structured-parser";
import type {
  Facing, Rect, StripPackResult, StripPackRoom,
  StripPackMetrics, SpineLayout, RoomZone, StripAssignment,
} from "./strip-pack/types";
import { normalizeFacing, rectArea, rectOverlap } from "./strip-pack/types";
import { buildWalls } from "./strip-pack/wall-builder";
import { placeDoors } from "./strip-pack/door-placer";
import { placeWindows } from "./strip-pack/window-placer";

// ───────────────────────────────────────────────────────────────────────────
// TYPES
// ───────────────────────────────────────────────────────────────────────────

interface LLMRoom {
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  depth: number;
}

interface LLMLayoutResponse {
  rooms: LLMRoom[];
}

// ───────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ───────────────────────────────────────────────────────────────────────────

const LLM_MODEL = "gpt-4o";
const LLM_TEMPERATURE = 0.3;
const LLM_MAX_TOKENS = 4096;
const LLM_TIMEOUT_MS = 45_000;
const SNAP_THRESHOLD = 0.5;

const ZONE_MAP: Record<string, RoomZone> = {
  master_bedroom: "PRIVATE", bedroom: "PRIVATE", guest_bedroom: "PRIVATE",
  kids_bedroom: "PRIVATE", study: "PRIVATE",
  living: "PUBLIC", dining: "PUBLIC", drawing_room: "PUBLIC",
  foyer: "ENTRANCE", porch: "ENTRANCE", verandah: "ENTRANCE",
  kitchen: "SERVICE", pantry: "SERVICE", store: "SERVICE",
  utility: "SERVICE", laundry: "SERVICE", servant_quarter: "SERVICE",
  bathroom: "WET", master_bathroom: "WET", powder_room: "WET",
  pooja: "WORSHIP", prayer: "WORSHIP",
  corridor: "CIRCULATION", hallway: "CIRCULATION", passage: "CIRCULATION",
  balcony: "OUTDOOR", sit_out: "OUTDOOR",
  walk_in_wardrobe: "PRIVATE", walk_in_closet: "PRIVATE",
  staircase: "SERVICE", other: "PRIVATE",
};

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────────

export async function runLLMLayoutEngine(
  prompt: string,
  parsed: ParsedConstraints,
  apiKey: string,
  options?: { temperature?: number },
): Promise<StripPackResult> {
  const warnings: string[] = [];
  const facing = normalizeFacing(parsed.plot.facing);
  const plotW = parsed.plot.width_ft ?? 40;
  const plotD = parsed.plot.depth_ft ?? 50;
  const plot: Rect = { x: 0, y: 0, width: plotW, depth: plotD };

  // Preprocess: fix known parser bugs (inverted attachments, missing porch)
  const fixedParsed = preprocessParsed(parsed, prompt, warnings);

  // Step 1: Build prompt + call GPT-4o
  const hallway = computeHallwayRect(plotW, plotD, facing, fixedParsed);
  const noHallway = hallway.width === 0 && hallway.depth === 0;
  if (noHallway) warnings.push("Small layout — no hallway (rooms connect directly)");
  const systemPrompt = buildSystemPrompt(fixedParsed, plotW, plotD, facing, hallway);
  const roomList = formatRoomList(fixedParsed);

  const temperature = options?.temperature ?? LLM_TEMPERATURE;

  const llmStart = Date.now();
  let llmRooms = await callGPT4o(systemPrompt, prompt, roomList, apiKey, temperature);
  warnings.push(`LLM call: ${Date.now() - llmStart}ms, ${llmRooms.length} rooms, temp=${temperature}`);

  // Step 2: Validate + repair
  llmRooms = repair(llmRooms, plot, hallway, facing, fixedParsed, warnings);

  // Step 3: Check connectivity — retry with feedback if too many orphans
  let { rooms, spine } = toStripPack(llmRooms, hallway, fixedParsed, facing, plot);
  let walls = buildWalls({ rooms, spine, plot });
  wireWallIds(rooms, walls);

  const adjPairs = fixedParsed.adjacency_pairs.map(p => ({ a: p.room_a_id, b: p.room_b_id }));
  const porchRoom = rooms.find(r => r.type === "porch" || r.type === "verandah");
  const foyerRoom = rooms.find(r => r.type === "foyer");

  let doorOut = placeDoors({
    rooms, walls, spine, adjacencyPairs: adjPairs,
    porchId: porchRoom?.id, foyerId: foyerRoom?.id,
  });
  warnings.push(...doorOut.warnings);

  // Check quality triggers for retry: orphans, compactness, hallway span
  // With multi-option generation (3 parallel calls), each option retries
  // independently — the outer loop picks the best scored result.
  const orphanCount = countOrphans(rooms, doorOut.doors);
  const compactness = measureCompactness(llmRooms);
  const hwSpan = noHallway ? 1 : measureHallwaySpan(hallway, plot);
  const needsRetry = orphanCount > 2 || compactness < 0.75 || (!noHallway && hwSpan < 0.85);

  if (needsRetry) {
    const feedbackParts: string[] = [];
    if (orphanCount > 3) feedbackParts.push(`${orphanCount} rooms are disconnected from the hallway.`);
    if (compactness < 0.75) feedbackParts.push(`Building is L-shaped — rooms only cover ${Math.round(compactness * 100)}% of bounding box. Place ALL rooms so they form ONE rectangle: both sides of the hallway must span y=0 to y=${plot.depth} (or x=0 to x=${plot.width}).`);
    if (hwSpan < 0.8) feedbackParts.push(`Hallway only spans ${Math.round(hwSpan * 100)}% of the building. Extend it wall-to-wall.`);
    warnings.push(`First attempt issues: ${feedbackParts.join(" ")} — retrying`);

    const feedbackMsg = `PREVIOUS ATTEMPT FAILED:\n${feedbackParts.join("\n")}\nFix these issues. Ensure ONE compact rectangle, hallway spanning full ${hallway.width > hallway.depth ? "width" : "depth"}, zero gaps.`;
    const retryStart = Date.now();
    let retryRooms = await callGPT4o(systemPrompt, prompt + "\n\n" + feedbackMsg, roomList, apiKey, temperature);
    warnings.push(`Retry call: ${Date.now() - retryStart}ms, ${retryRooms.length} rooms`);
    retryRooms = repair(retryRooms, plot, hallway, facing, fixedParsed, warnings);

    const retry = toStripPack(retryRooms, hallway, fixedParsed, facing, plot);
    const retryWalls = buildWalls({ rooms: retry.rooms, spine: retry.spine, plot });
    wireWallIds(retry.rooms, retryWalls);
    const retryDoors = placeDoors({
      rooms: retry.rooms, walls: retryWalls, spine: retry.spine,
      adjacencyPairs: adjPairs, porchId: porchRoom?.id, foyerId: foyerRoom?.id,
    });

    const retryOrphans = countOrphans(retry.rooms, retryDoors.doors);
    const retryCompact = measureCompactness(retryRooms);
    // Accept retry if it improves on ANY metric
    if (retryOrphans <= orphanCount && retryCompact >= compactness) {
      rooms = retry.rooms;
      spine = retry.spine;
      walls = retryWalls;
      doorOut = retryDoors;
      warnings.push(`Retry improved: orphans ${orphanCount}→${retryOrphans}, compactness ${Math.round(compactness * 100)}→${Math.round(retryCompact * 100)}%`);
    } else {
      warnings.push(`Retry didn't improve — keeping first attempt`);
    }
    warnings.push(...retryDoors.warnings);
  }

  // Step 4: Windows
  const winOut = placeWindows({ rooms, walls, doors: doorOut.doors, facing });
  warnings.push(...winOut.warnings);

  // Step 5: Metrics
  const metrics = computeMetrics(rooms, spine, plot, adjPairs.length);

  return { rooms, spine, walls, doors: doorOut.doors, windows: winOut.windows, plot, metrics, warnings };
}

// ───────────────────────────────────────────────────────────────────────────
// HALLWAY COMPUTATION
// ───────────────────────────────────────────────────────────────────────────

/** Compute hallway width: skip for tiny layouts, narrow for small, standard for normal. */
function computeHallwayWidth(totalNonCircRooms: number, plotArea: number): number {
  if (totalNonCircRooms <= 3 || plotArea < 600) return 0; // no hallway
  if (totalNonCircRooms <= 5 || plotArea < 1000) return 3; // narrow
  return 4; // standard
}

function computeHallwayRect(
  plotW: number, plotD: number, facing: Facing,
  parsed?: ParsedConstraints,
): Rect {
  const totalRooms = parsed
    ? parsed.rooms.filter(r => !r.is_circulation).length
    : 99; // default to standard
  const plotArea = plotW * plotD;
  const hw = computeHallwayWidth(totalRooms, plotArea);

  // No hallway needed for tiny layouts — return zero-area sentinel
  if (hw === 0) return { x: 0, y: 0, width: 0, depth: 0 };

  const isHorizontal = facing === "north" || facing === "south";
  if (isHorizontal) {
    const spineY = facing === "north"
      ? Math.round(plotD * 0.55)
      : Math.round(plotD * 0.45);
    return { x: 0, y: spineY, width: plotW, depth: hw };
  }
  const spineX = facing === "east"
    ? Math.round(plotW * 0.55)
    : Math.round(plotW * 0.45);
  return { x: spineX, y: 0, width: hw, depth: plotD };
}

// ───────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ───────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(
  parsed: ParsedConstraints,
  plotW: number, plotD: number,
  facing: Facing, hallway: Rect,
): string {
  const noHallway = hallway.width === 0 && hallway.depth === 0;
  const entranceSide = { north: "top (high Y)", south: "bottom (low Y)", east: "right (high X)", west: "left (low X)" }[facing];
  const backSide = { north: "bottom (low Y)", south: "top (high Y)", east: "left (low X)", west: "right (high X)" }[facing];

  // ── Small-layout prompt (no hallway) ──────────────────────────────────
  if (noHallway) {
    return `You are an expert residential architect. Place rooms on a rectangular plot as JSON.

PLOT: ${plotW}ft wide (X) × ${plotD}ft deep (Y). Origin (0,0) = SW corner. X→EAST, Y→NORTH.
FACING: ${facing} — entrance on ${entranceSide}

NO HALLWAY — this is a small layout. Rooms connect directly via shared walls.

RULES:
1. COMPACT RECTANGLE: all rooms fill the plot from (0,0) to (${plotW},${plotD}). No gaps, no L-shapes.
2. EDGE-TO-EDGE: rooms share exact edge coordinates. No gaps > 0.
3. ALL rooms INSIDE plot. No overlaps. Rooms cover ≥90% of plot area.
4. Entrance room (porch/foyer/living) touches the ${entranceSide} edge.
5. Bathroom/kitchen share a wall with at least one other room.

OUTPUT — ONLY valid JSON, no markdown:
{ "rooms": [ { "name": "...", "type": "...", "x": ..., "y": ..., "width": ..., "depth": ... }, ... ] }

BEFORE YOU OUTPUT, CHECK:
1. Every room inside plot? (0 ≤ x, 0 ≤ y, x+width ≤ ${plotW}, y+depth ≤ ${plotD})
2. Total room area ≥ ${Math.round(plotW * plotD * 0.9)} sqft?
3. No gaps between rooms? All edges shared exactly?
Fix before outputting.`;
  }

  // ── Standard prompt (with hallway) ────────────────────────────────────
  const isH = hallway.width > hallway.depth;
  const hwL = hallway.x;
  const hwR = hallway.x + hallway.width;
  const hwB = hallway.y;
  const hwT = hallway.y + hallway.depth;

  // Build concrete few-shot example with exact coordinates for this facing
  const example = isH ? buildHorizontalExample(plotW, plotD, facing, hwB, hwT) : buildVerticalExample(plotW, plotD, facing, hwL, hwR);

  return `You are an expert residential architect. Place rooms on a rectangular plot as JSON.

PLOT: ${plotW}ft wide (X) × ${plotD}ft deep (Y). Origin (0,0) = SW corner. X→EAST, Y→NORTH.
FACING: ${facing} — entrance on ${entranceSide}

HALLWAY (use EXACT coordinates):
{ "name": "Hallway", "type": "corridor", "x": ${hallway.x}, "y": ${hallway.y}, "width": ${hallway.width}, "depth": ${hallway.depth} }
${isH ? `Runs EAST-WEST, full width x=0..${plotW}.` : `Runs NORTH-SOUTH, full depth y=0..${plotD}.`}

ZONES:
- Entrance side (${entranceSide}): porch, foyer, living, dining, pooja
- Back side (${backSide}): bedrooms, kitchen, bathrooms, utility

═══════════════════════════════════════════
RULES — READ ALL BEFORE GENERATING
═══════════════════════════════════════════

RULE 1 — COMPACT RECTANGLE (MOST CRITICAL):
The building MUST be a SINGLE COMPACT RECTANGLE. NO L-shapes, T-shapes, or staircases.
${isH
  ? `Every room: x between 0 and ${plotW}. Rooms ABOVE hallway: top edges at y=${plotD}. Rooms BELOW hallway: bottom edges at y=0.`
  : `Every room: y between 0 and ${plotD}. Rooms LEFT of hallway: left edges at x=0. Rooms RIGHT of hallway: right edges at x=${plotW}.
CRITICAL for ${facing}-facing: rooms on BOTH sides must span y=0 to y=${plotD}. If the left side has rooms from y=5 to y=40 but the right side has rooms from y=0 to y=35, that creates an L-shape. WRONG. Both sides: y=0 to y=${plotD}.`}

RULE 2 — HALLWAY SPANS FULL ${isH ? "WIDTH" : "DEPTH"}:
${isH ? `x=0 to x=${plotW}, width=${plotW}ft.` : `y=0 to y=${plotD}, depth=${plotD}ft.`}

RULE 3 — EDGE ALIGNMENT (zero gaps):
Adjacent rooms share EXACT edge coordinates. Room A ends at x=14 → Room B starts at x=14. NOT 14.1, NOT 13.9.

RULE 4 — ROW PACKING:
${isH
  ? `ABOVE hallway: pack rooms LEFT to RIGHT in rows. Row 1 starts at y=${hwT}, rooms fill to y=${plotD}. Each room in a row has the same y and depth. Next row stacks on top.
BELOW hallway: pack rooms LEFT to RIGHT. Row 1 starts at y=0 with depth filling up to y=${hwB}.`
  : `RIGHT of hallway: pack rooms BOTTOM to TOP. First room at y=0, next room at y=firstRoom.depth, etc. All rooms have x=${hwR} and width fills to x=${plotW}.
LEFT of hallway: pack rooms BOTTOM to TOP. All rooms have x=0 and width fills to x=${hwL}.`}

RULE 5 — CONNECTIVITY: Porch → Foyer → Hallway → all rooms.
${facing === "north" ? `Foyer bottom edge y=${hwT}.` : facing === "south" ? `Foyer top edge y+d=${hwB}.` : facing === "east" ? `Foyer left edge x=${hwR}.` : `Foyer right edge x+w=${hwL}.`}

RULE 6 — ALL rooms INSIDE plot. No overlaps. Dimensions ±15% of requested.
RULE 7 — Ensuite/wardrobe share a wall with parent bedroom.
RULE 8 — Rooms + hallway cover ≥85% of plot.

${example}

OUTPUT — ONLY valid JSON, no markdown:
{ "rooms": [ { "name": "Hallway", "type": "corridor", "x": ${hallway.x}, "y": ${hallway.y}, "width": ${hallway.width}, "depth": ${hallway.depth} }, ...all rooms... ] }

BEFORE YOU OUTPUT, CHECK EACH ONE:
1. Is EVERY room inside the plot? (0 ≤ x, 0 ≤ y, x+width ≤ ${plotW}, y+depth ≤ ${plotD})
2. Does the hallway span the FULL ${isH ? `width (x=0..${plotW})` : `depth (y=0..${plotD})`}?
3. ${isH
  ? `Do rooms ABOVE and BELOW hallway each span x=0 to x=${plotW}?`
  : `Do rooms on EACH SIDE of hallway span y=0 to y=${plotD}?`}
4. Is the building a SINGLE RECTANGLE with NO L-shapes or voids?
5. Does every room share a wall with the hallway or with a hallway-adjacent room?
6. Are all edge coordinates EXACT integers or halves (no .1 or .9 gaps)?
If ANY answer is NO — FIX IT before outputting.`;
}

function buildHorizontalExample(plotW: number, plotD: number, facing: Facing, hwB: number, hwT: number): string {
  // N/S facing — horizontal hallway
  const frontLabel = facing === "north" ? "ABOVE" : "BELOW";
  const backLabel = facing === "north" ? "BELOW" : "ABOVE";
  const frontY = facing === "north" ? hwT : 0;
  const frontH = facing === "north" ? plotD - hwT : hwB;
  const backY = facing === "north" ? 0 : hwT;
  const backH = facing === "north" ? hwB : plotD - hwT;

  return `WORKED EXAMPLE — ${facing}-facing, 40×40 plot, hallway at y=${hwB}..${hwT}:
${frontLabel} hallway (entrance side): rooms from y=${frontY}, fill to y=${facing === "north" ? plotD : hwB}
  {"name":"Porch","type":"porch","x":17,"y":${facing === "north" ? plotD - 5 : 0},"width":6,"depth":5}
  {"name":"Foyer","type":"foyer","x":17,"y":${facing === "north" ? hwT : hwB - 5},"width":6,"depth":5}
  {"name":"Living Room","type":"living","x":0,"y":${frontY},"width":14,"depth":${frontH}}
  {"name":"Bedroom 2","type":"bedroom","x":14,"y":${frontY},"width":12,"depth":${Math.round(frontH * 0.6)}}
  {"name":"Bedroom 3","type":"bedroom","x":26,"y":${frontY},"width":14,"depth":${frontH}}
${backLabel} hallway (back side): rooms from y=${backY}, fill to y=${backY + backH}
  {"name":"Master Bedroom","type":"master_bedroom","x":0,"y":${backY},"width":13,"depth":${backH}}
  {"name":"Kitchen","type":"kitchen","x":13,"y":${backY},"width":12,"depth":${Math.round(backH * 0.5)}}
  {"name":"Dining Room","type":"dining","x":25,"y":${backY},"width":15,"depth":${backH}}

KEY: Both sides span x=0..${plotW}. All edges align to plot boundary. ONE rectangle.`;
}

function buildVerticalExample(plotW: number, plotD: number, facing: Facing, hwL: number, hwR: number): string {
  // E/W facing — vertical hallway
  const frontLabel = facing === "east" ? "RIGHT" : "LEFT";
  const backLabel = facing === "east" ? "LEFT" : "RIGHT";
  const frontX = facing === "east" ? hwR : 0;
  const frontW = facing === "east" ? plotW - hwR : hwL;
  const backX = facing === "east" ? 0 : hwR;
  const backW = facing === "east" ? hwL : plotW - hwR;

  return `WORKED EXAMPLE — ${facing}-facing, ${plotW}×${plotD} plot, hallway at x=${hwL}..${hwR}:
${frontLabel} of hallway (entrance side, x=${frontX}..${frontX + frontW}): stack rooms y=0 to y=${plotD}
  {"name":"Kitchen","type":"kitchen","x":${frontX},"y":0,"width":${frontW},"depth":11}
  {"name":"Porch","type":"porch","x":${facing === "east" ? plotW - 6 : 0},"y":11,"width":6,"depth":5}
  {"name":"Foyer","type":"foyer","x":${facing === "east" ? hwR : hwL - 8},"y":11,"width":8,"depth":6}
  {"name":"Living Room","type":"living","x":${frontX},"y":17,"width":${frontW},"depth":14}
  {"name":"Dining Room","type":"dining","x":${frontX},"y":31,"width":${frontW},"depth":${plotD - 31}}
${backLabel} of hallway (back side, x=${backX}..${backX + backW}): stack rooms y=0 to y=${plotD}
  {"name":"Master Bedroom","type":"master_bedroom","x":${backX},"y":0,"width":${backW},"depth":13}
  {"name":"Ensuite","type":"master_bathroom","x":${backX},"y":0,"width":8,"depth":6}
  {"name":"Bedroom 2","type":"bedroom","x":${backX},"y":13,"width":${backW},"depth":12}
  {"name":"Bedroom 3","type":"bedroom","x":${backX},"y":25,"width":${backW},"depth":11}
  {"name":"Common Bath","type":"bathroom","x":${backX},"y":36,"width":7,"depth":5}
  {"name":"Utility","type":"utility","x":${backX + 7},"y":36,"width":${backW - 7},"depth":${plotD - 36}}

KEY: BOTH sides span y=0 to y=${plotD}. Left edges at x=${backX}, right edges at x=${frontX + frontW}. ONE rectangle, NO L-shape.`;
}

// ───────────────────────────────────────────────────────────────────────────
// ROOM LIST
// ───────────────────────────────────────────────────────────────────────────

function formatRoomList(parsed: ParsedConstraints): string {
  const lines: string[] = ["ROOMS:"];
  for (const r of parsed.rooms) {
    if (r.is_circulation) continue;
    const dims = (r.dim_width_ft && r.dim_depth_ft) ? `${r.dim_width_ft}×${r.dim_depth_ft}ft` : "default size";
    const pos = r.position_direction ? ` [${posLabel(r.position_direction)}]` : "";
    const att = r.attached_to_room_id ? ` [ATTACHED to ${parsed.rooms.find(x => x.id === r.attached_to_room_id)?.name ?? r.attached_to_room_id}]` : "";
    lines.push(`- ${r.name}: ${dims}${pos}${att} (type: ${r.function})`);
  }
  if (!parsed.rooms.some(r => r.function === "porch")) {
    lines.push(`- Porch: 6×5ft [${parsed.plot.facing ?? "N"} wall centered] (type: porch)`);
  }
  if (parsed.adjacency_pairs.length > 0) {
    lines.push("\nADJACENCY (must share a wall):");
    for (const a of parsed.adjacency_pairs) {
      if (a.relationship === "attached_ensuite") continue;
      const na = parsed.rooms.find(r => r.id === a.room_a_id)?.name;
      const nb = parsed.rooms.find(r => r.id === a.room_b_id)?.name;
      if (na && nb) lines.push(`- ${na} ↔ ${nb}`);
    }
  }
  return lines.join("\n");
}

function posLabel(d: string): string {
  return { N: "north", S: "south", E: "east", W: "west", NE: "northeast", NW: "northwest", SE: "southeast", SW: "southwest", CENTER: "center" }[d] ?? d;
}

// ───────────────────────────────────────────────────────────────────────────
// GPT-4o CALL
// ───────────────────────────────────────────────────────────────────────────

async function callGPT4o(sys: string, user: string, roomList: string, key: string, temperature: number = LLM_TEMPERATURE): Promise<LLMRoom[]> {
  const client = getClient(key, LLM_TIMEOUT_MS);
  const resp = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature,
    max_tokens: LLM_MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: `Design this house:\n\n${user}\n\n${roomList}` },
    ],
  });
  const raw = resp.choices[0]?.message?.content;
  if (!raw) throw new Error("GPT-4o returned empty content");
  const data = JSON.parse(raw.replace(/```json\s*|```\s*/g, "").trim()) as LLMLayoutResponse;
  if (!Array.isArray(data.rooms)) throw new Error("GPT-4o response missing rooms array");
  return data.rooms;
}

// ───────────────────────────────────────────────────────────────────────────
// VALIDATE + REPAIR
// ───────────────────────────────────────────────────────────────────────────

function repair(
  rooms: LLMRoom[], plot: Rect, hallway: Rect,
  facing: Facing, parsed: ParsedConstraints, warnings: string[],
): LLMRoom[] {
  // 1. Ensure hallway in rooms (skip for no-hallway small layouts)
  const noHallway = hallway.width === 0 && hallway.depth === 0;
  if (noHallway) {
    // Remove any LLM-generated corridor — small layouts don't need one
    const idx = rooms.findIndex(r => r.type === "corridor" || r.type === "hallway");
    if (idx >= 0) { rooms.splice(idx, 1); warnings.push("Removed LLM-generated corridor (small layout)"); }
  } else if (!rooms.find(r => r.type === "corridor" || r.type === "hallway")) {
    rooms.unshift({ name: "Hallway", type: "corridor", ...hallway });
    warnings.push("Hallway missing — injected");
  } else {
    // Force hallway to exact coordinates
    const hw = rooms.find(r => r.type === "corridor" || r.type === "hallway")!;
    hw.x = hallway.x; hw.y = hallway.y; hw.width = hallway.width; hw.depth = hallway.depth;
  }

  // 2. Round to 0.5ft grid
  for (const r of rooms) {
    r.x = Math.round(r.x * 2) / 2;
    r.y = Math.round(r.y * 2) / 2;
    r.width = Math.round(r.width * 2) / 2;
    r.depth = Math.round(r.depth * 2) / 2;
    r.width = Math.max(r.width, 4);
    r.depth = Math.max(r.depth, 4);
  }

  // 3. Clamp to plot (MOVE inside, don't shrink)
  for (const r of rooms) {
    if (r.type === "corridor") continue; // hallway is authoritative
    if (r.x < 0) r.x = 0;
    if (r.y < 0) r.y = 0;
    if (r.x + r.width > plot.width) r.x = Math.max(0, plot.width - r.width);
    if (r.y + r.depth > plot.depth) r.y = Math.max(0, plot.depth - r.depth);
  }

  // 4. Snap near-miss edges
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      snapEdgePair(rooms[i], rooms[j], SNAP_THRESHOLD);
    }
  }

  // 5. Resolve overlaps (skip hallway — it's authoritative)
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        if (rooms[i].type === "corridor" || rooms[j].type === "corridor") continue;
        const ov = overlapArea(rooms[i], rooms[j]);
        if (ov > 2) nudgeApart(rooms[i], rooms[j], plot, warnings);
      }
    }
  }

  // 6. Force foyer→hallway connectivity (skip for no-hallway small layouts —
  //    positioning relative to a zero-size hallway creates degenerate 0-width rooms)
  const foyer = rooms.find(r => r.type === "foyer" || r.name.toLowerCase() === "foyer");
  if (foyer && !noHallway) {
    const isH = hallway.width > hallway.depth;
    if (isH) {
      if (facing === "north") foyer.y = hallway.y + hallway.depth;
      else foyer.y = hallway.y - foyer.depth;
      if (foyer.y < 0) { foyer.y = 0; foyer.depth = hallway.y; }
    } else {
      if (facing === "east") foyer.x = hallway.x + hallway.width;
      else foyer.x = hallway.x - foyer.width;
      if (foyer.x < 0) { foyer.x = 0; foyer.width = hallway.x; }
    }
  }

  // 7. Force porch→foyer connectivity + inside plot (skip for no-hallway)
  const porch = rooms.find(r => r.type === "porch");
  if (porch && foyer && !noHallway) {
    const isH = hallway.width > hallway.depth;
    if (isH) {
      if (facing === "north") {
        porch.y = foyer.y + foyer.depth;
        if (porch.y + porch.depth > plot.depth) porch.depth = plot.depth - porch.y;
      } else {
        porch.y = foyer.y - porch.depth;
        if (porch.y < 0) { porch.depth = foyer.y; porch.y = 0; }
      }
      porch.x = foyer.x + (foyer.width - porch.width) / 2;
      porch.x = Math.max(0, Math.min(porch.x, plot.width - porch.width));
    } else {
      if (facing === "east") {
        porch.x = foyer.x + foyer.width;
        if (porch.x + porch.width > plot.width) porch.width = plot.width - porch.x;
      } else {
        porch.x = foyer.x - porch.width;
        if (porch.x < 0) { porch.width = foyer.x; porch.x = 0; }
      }
      porch.y = foyer.y + (foyer.depth - porch.depth) / 2;
      porch.y = Math.max(0, Math.min(porch.y, plot.depth - porch.depth));
    }
  }

  // 8. Extend disconnected rooms toward hallway (skip for no-hallway —
  //    zero-size hallway makes touchesRect always true at origin)
  if (!noHallway) {
    const isH = hallway.width > hallway.depth;
    for (const r of rooms) {
      if (r.type === "corridor" || r.type === "porch" || r.type === "foyer") continue;
      if (touchesRect(r, hallway)) continue;
      // Check if touches any room that touches hallway
      const touchesConnected = rooms.some(other =>
        other !== r && touchesRect(r, other) && touchesRect(other, hallway),
      );
      if (touchesConnected) continue;

      // Extend toward hallway
      if (isH) {
        const hwTop = hallway.y + hallway.depth;
        const hwBot = hallway.y;
        if (r.y >= hwTop) {
          const gap = r.y - hwTop;
          if (gap < 15) { r.depth += gap; r.y = hwTop; }
        } else if (r.y + r.depth <= hwBot) {
          const gap = hwBot - (r.y + r.depth);
          if (gap < 15) r.depth += gap;
        }
      } else {
        const hwRight = hallway.x + hallway.width;
        const hwLeft = hallway.x;
        if (r.x >= hwRight) {
          const gap = r.x - hwRight;
          if (gap < 15) { r.width += gap; r.x = hwRight; }
        } else if (r.x + r.width <= hwLeft) {
          const gap = hwLeft - (r.x + r.width);
          if (gap < 15) r.width += gap;
        }
      }
    }
  }

  // 9. Synthesize missing rooms
  for (const pr of parsed.rooms) {
    if (pr.is_circulation) continue;
    const found = rooms.find(r => matchesRoom(r, pr));
    if (!found) {
      warnings.push(`${pr.name}: missing from LLM — synthesized`);
      const w = pr.dim_width_ft ?? 10;
      const d = pr.dim_depth_ft ?? 8;
      const pos = findOpen(w, d, rooms, plot);
      rooms.push({ name: pr.name, type: pr.function, x: pos.x, y: pos.y, width: w, depth: d });
    }
  }

  // 10. Compact rectangle check — fix L-shaped layouts
  // For E/W facing, rooms on both sides of the hallway should span the
  // same Y range (0..plotD). For N/S facing, same X range (0..plotW).
  // If not, stretch/move rooms to fill the full range.
  const isVertical = hallway.depth > hallway.width;
  const nonCorridorRooms = rooms.filter(r => r.type !== "corridor" && r.type !== "hallway");
  if (nonCorridorRooms.length > 0) {
    const bbox = {
      xMin: Math.min(...nonCorridorRooms.map(r => r.x)),
      yMin: Math.min(...nonCorridorRooms.map(r => r.y)),
      xMax: Math.max(...nonCorridorRooms.map(r => r.x + r.width)),
      yMax: Math.max(...nonCorridorRooms.map(r => r.y + r.depth)),
    };
    const bboxArea = (bbox.xMax - bbox.xMin) * (bbox.yMax - bbox.yMin);
    const totalRoomArea = nonCorridorRooms.reduce((s, r) => s + r.width * r.depth, 0)
      + hallway.width * hallway.depth;
    const wasteRatio = bboxArea > 0 ? 1 - totalRoomArea / bboxArea : 0;

    if (wasteRatio > 0.15) {
      warnings.push(
        `L-shape detected: bounding box ${Math.round(bboxArea)}sqft but rooms only ${Math.round(totalRoomArea)}sqft ` +
        `(${Math.round(wasteRatio * 100)}% waste). Aligning rooms to compact rectangle.`,
      );

      // Fix: align all rooms to plot boundaries AND hallway edges
      if (isVertical) {
        // E/W facing — ensure all rooms span y=0..plotD
        const hwLeft = hallway.x;
        const hwRight = hallway.x + hallway.width;
        for (const side of ["left", "right"] as const) {
          const sideRooms = nonCorridorRooms.filter(r => {
            const cx = r.x + r.width / 2;
            return side === "left" ? cx < hwLeft : cx > hwRight;
          });
          if (sideRooms.length === 0) continue;

          // Sort by y to find bottom-most and top-most
          sideRooms.sort((a, b) => a.y - b.y);
          const bottomRoom = sideRooms[0];
          const topRoom = sideRooms[sideRooms.length - 1];

          // Extend bottom room to y=0
          if (bottomRoom.y > 0.5) {
            bottomRoom.depth += bottomRoom.y;
            bottomRoom.y = 0;
          }

          // Extend top room to y=plotD
          const topEdge = topRoom.y + topRoom.depth;
          if (topEdge < plot.depth - 0.5) {
            topRoom.depth = plot.depth - topRoom.y;
          }

          // Align room widths to plot/hallway boundary (close inner gaps)
          for (const r of sideRooms) {
            if (side === "left") {
              if (r.x > 0.5) { r.width += r.x; r.x = 0; }
              const rightEdge = r.x + r.width;
              if (rightEdge < hwLeft - 0.5) { r.width = hwLeft - r.x; }
            } else {
              if (r.x > hwRight + 0.5) { r.width += r.x - hwRight; r.x = hwRight; }
              if (r.x < hwRight - 0.5 && r.x > hwRight - 2) { r.width += r.x - hwRight; r.x = hwRight; }
              const re = r.x + r.width;
              if (re < plot.width - 0.5) { r.width = plot.width - r.x; }
            }
          }
        }
      } else {
        // N/S facing — ensure all rooms span x=0..plotW
        const hwBot = hallway.y;
        const hwTop = hallway.y + hallway.depth;
        for (const side of ["below", "above"] as const) {
          const sideRooms = nonCorridorRooms.filter(r => {
            const cy = r.y + r.depth / 2;
            return side === "below" ? cy < hwBot : cy > hwTop;
          });
          if (sideRooms.length === 0) continue;

          sideRooms.sort((a, b) => a.x - b.x);
          const leftRoom = sideRooms[0];
          const rightRoom = sideRooms[sideRooms.length - 1];

          if (leftRoom.x > 0.5) {
            leftRoom.width += leftRoom.x;
            leftRoom.x = 0;
          }
          const rightEdge = rightRoom.x + rightRoom.width;
          if (rightEdge < plot.width - 0.5) {
            rightRoom.width = plot.width - rightRoom.x;
          }

          // Align room depths to plot/hallway boundary (close inner gaps)
          for (const r of sideRooms) {
            if (side === "below") {
              if (r.y > 0.5) { r.depth += r.y; r.y = 0; }
              const te = r.y + r.depth;
              if (te < hwBot - 0.5) { r.depth = hwBot - r.y; }
            } else {
              if (r.y > hwTop + 0.5) { r.depth += r.y - hwTop; r.y = hwTop; }
              if (r.y < hwTop - 0.5 && r.y > hwTop - 2) { r.depth += r.y - hwTop; r.y = hwTop; }
              const be = r.y + r.depth;
              if (be < plot.depth - 0.5) { r.depth = plot.depth - r.y; }
            }
          }
        }
      }
    }
  }

  return rooms;
}

// ───────────────────────────────────────────────────────────────────────────
// GEOMETRY HELPERS
// ───────────────────────────────────────────────────────────────────────────

/** Ratio of total room area to bounding-box area. 1.0 = perfect rectangle, <0.75 = L-shape. */
function measureCompactness(rooms: LLMRoom[]): number {
  const real = rooms.filter(r => r.type !== "corridor" && r.type !== "hallway");
  if (real.length === 0) return 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let totalArea = 0;
  for (const r of real) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.depth);
    totalArea += r.width * r.depth;
  }
  const bboxArea = (maxX - minX) * (maxY - minY);
  return bboxArea > 0 ? totalArea / bboxArea : 1;
}

/** Ratio of hallway length to plot's spanning dimension. */
function measureHallwaySpan(hw: Rect, plot: Rect): number {
  const isH = hw.width > hw.depth;
  return isH ? hw.width / plot.width : hw.depth / plot.depth;
}

function touchesRect(a: LLMRoom | Rect, b: LLMRoom | Rect): boolean {
  const eps = 0.3;
  const minLen = 0.5;
  const ax2 = a.x + a.width, ay2 = a.y + a.depth;
  const bx2 = b.x + b.width, by2 = b.y + b.depth;
  // Horizontal edge
  if (Math.abs(ay2 - b.y) < eps || Math.abs(by2 - a.y) < eps) {
    const o = Math.min(ax2, bx2) - Math.max(a.x, b.x);
    if (o > minLen) return true;
  }
  // Vertical edge
  if (Math.abs(ax2 - b.x) < eps || Math.abs(bx2 - a.x) < eps) {
    const o = Math.min(ay2, by2) - Math.max(a.y, b.y);
    if (o > minLen) return true;
  }
  return false;
}

function snapEdgePair(a: LLMRoom, b: LLMRoom, thr: number): void {
  const pairs = [
    { get: () => (a.x + a.width) - b.x, fix: (d: number) => { a.width -= d / 2; b.x -= d / 2; b.width += d / 2; } },
    { get: () => (b.x + b.width) - a.x, fix: (d: number) => { b.width -= d / 2; a.x -= d / 2; a.width += d / 2; } },
    { get: () => (a.y + a.depth) - b.y, fix: (d: number) => { a.depth -= d / 2; b.y -= d / 2; b.depth += d / 2; } },
    { get: () => (b.y + b.depth) - a.y, fix: (d: number) => { b.depth -= d / 2; a.y -= d / 2; a.depth += d / 2; } },
  ];
  for (const p of pairs) {
    const diff = p.get();
    if (Math.abs(diff) > 0.01 && Math.abs(diff) < thr) p.fix(diff);
  }
}

function overlapArea(a: LLMRoom, b: LLMRoom): number {
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.width, b.x + b.width);
  const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.depth, b.y + b.depth);
  return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0;
}

function nudgeApart(a: LLMRoom, b: LLMRoom, plot: Rect, warnings: string[]): void {
  const smaller = (a.width * a.depth) < (b.width * b.depth) ? a : b;
  const larger = smaller === a ? b : a;
  const ox = Math.min(smaller.x + smaller.width, larger.x + larger.width) - Math.max(smaller.x, larger.x);
  const oy = Math.min(smaller.y + smaller.depth, larger.y + larger.depth) - Math.max(smaller.y, larger.y);
  if (ox < oy) {
    if (smaller.x < larger.x) smaller.x = larger.x - smaller.width;
    else smaller.x = larger.x + larger.width;
  } else {
    if (smaller.y < larger.y) smaller.y = larger.y - smaller.depth;
    else smaller.y = larger.y + larger.depth;
  }
  smaller.x = Math.max(0, Math.min(smaller.x, plot.width - smaller.width));
  smaller.y = Math.max(0, Math.min(smaller.y, plot.depth - smaller.depth));
  warnings.push(`${smaller.name}: nudged away from ${larger.name}`);
}

function matchesRoom(llm: LLMRoom, pr: ParsedRoom): boolean {
  const a = llm.name.toLowerCase(), b = pr.name.toLowerCase();
  if (a === b) return true;
  if (llm.type === pr.function) return true;
  const aToks = a.split(/\s+/).filter(t => t.length >= 3);
  const bToks = b.split(/\s+/).filter(t => t.length >= 3);
  return aToks.some(t => bToks.includes(t));
}

function findOpen(w: number, d: number, rooms: LLMRoom[], plot: Rect): { x: number; y: number } {
  for (let y = 0; y <= plot.depth - d; y += 2) {
    for (let x = 0; x <= plot.width - w; x += 2) {
      const cand = { x, y, width: w, depth: d, name: "", type: "" };
      if (rooms.every(r => overlapArea(cand, r) < 0.1)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

// ───────────────────────────────────────────────────────────────────────────
// RETRY FEEDBACK
// ───────────────────────────────────────────────────────────────────────────

function countOrphans(rooms: StripPackRoom[], doors: { between: [string, string] }[]): number {
  const adj = new Map<string, Set<string>>();
  for (const r of rooms) if (r.placed) adj.set(r.name, new Set());
  for (const d of doors) {
    const [a, b] = d.between;
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  }
  // BFS from any room with a hallway door
  const seed = doors.find(d => d.between.includes("hallway") || d.between.includes("exterior"));
  if (!seed) return rooms.filter(r => r.placed).length;
  const start = seed.between[0] === "hallway" || seed.between[0] === "exterior" ? seed.between[1] : seed.between[0];
  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? []) {
      if (!visited.has(n)) { visited.add(n); queue.push(n); }
    }
  }
  return rooms.filter(r => r.placed && !visited.has(r.name)).length;
}

function buildFeedbackMessage(rooms: StripPackRoom[], doors: { between: [string, string] }[], spine: SpineLayout): string {
  const orphanNames: string[] = [];
  const adj = new Map<string, Set<string>>();
  for (const r of rooms) if (r.placed) adj.set(r.name, new Set());
  for (const d of doors) {
    adj.get(d.between[0])?.add(d.between[1]);
    adj.get(d.between[1])?.add(d.between[0]);
  }
  const seed = doors.find(d => d.between.includes("hallway"));
  if (seed) {
    const start = seed.between[0] === "hallway" ? seed.between[1] : seed.between[0];
    const visited = new Set([start]);
    const q = [start];
    while (q.length > 0) { const c = q.shift()!; for (const n of adj.get(c) ?? []) { if (!visited.has(n)) { visited.add(n); q.push(n); } } }
    for (const r of rooms) if (r.placed && !visited.has(r.name)) orphanNames.push(r.name);
  }
  return `PREVIOUS ATTEMPT FAILED — ${orphanNames.length} rooms are disconnected: ${orphanNames.join(", ")}.\nThese rooms have gaps between them and the hallway. Fix by making their edges touch the hallway or touch a room that touches the hallway. Ensure ZERO gaps between adjacent rooms.`;
}

// ───────────────────────────────────────────────────────────────────────────
// CONVERT TO STRIP-PACK TYPES
// ───────────────────────────────────────────────────────────────────────────

function toStripPack(
  llmRooms: LLMRoom[], hallway: Rect,
  parsed: ParsedConstraints, facing: Facing, plot: Rect,
): { rooms: StripPackRoom[]; spine: SpineLayout } {
  const isH = hallway.width > hallway.depth;
  const spine: SpineLayout = {
    spine: hallway,
    front_strip: isH
      ? (facing === "north"
        ? { x: 0, y: hallway.y + hallway.depth, width: plot.width, depth: plot.depth - hallway.y - hallway.depth }
        : { x: 0, y: 0, width: plot.width, depth: hallway.y })
      : (facing === "east"
        ? { x: hallway.x + hallway.width, y: 0, width: plot.width - hallway.x - hallway.width, depth: plot.depth }
        : { x: 0, y: 0, width: hallway.x, depth: plot.depth }),
    back_strip: isH
      ? (facing === "north"
        ? { x: 0, y: 0, width: plot.width, depth: hallway.y }
        : { x: 0, y: hallway.y + hallway.depth, width: plot.width, depth: plot.depth - hallway.y - hallway.depth })
      : (facing === "east"
        ? { x: 0, y: 0, width: hallway.x, depth: plot.depth }
        : { x: hallway.x + hallway.width, y: 0, width: plot.width - hallway.x - hallway.width, depth: plot.depth }),
    entrance_rooms: [],
    remaining_front: [],
    orientation: isH ? "horizontal" : "vertical",
    entrance_side: facing,
    hallway_width_ft: isH ? hallway.depth : hallway.width,
  };

  const rooms: StripPackRoom[] = [];
  for (const lr of llmRooms) {
    if (lr.type === "corridor" || lr.type === "hallway") continue;
    const pr = parsed.rooms.find(r => matchesRoom(lr, r));
    const fn = pr?.function ?? lr.type ?? "other";
    rooms.push({
      id: pr?.id ?? `llm_${lr.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name: lr.name, type: fn,
      requested_width_ft: pr?.dim_width_ft ?? lr.width,
      requested_depth_ft: pr?.dim_depth_ft ?? lr.depth,
      requested_area_sqft: (pr?.dim_width_ft ?? lr.width) * (pr?.dim_depth_ft ?? lr.depth),
      zone: ZONE_MAP[fn] ?? "PRIVATE",
      strip: inferStrip(lr, hallway, isH, facing),
      position_preference: pr?.position_direction ?? undefined,
      adjacencies: pr ? getAdj(pr.id, parsed) : [],
      is_attached_to: pr?.attached_to_room_id ?? undefined,
      needs_exterior_wall: (ZONE_MAP[fn] === "PUBLIC") || fn.includes("bedroom"),
      is_wet: pr?.is_wet ?? fn.includes("bath"),
      is_sacred: pr?.is_sacred ?? fn === "pooja",
      placed: { x: lr.x, y: lr.y, width: lr.width, depth: lr.depth },
      actual_area_sqft: lr.width * lr.depth,
    });
  }
  return { rooms, spine };
}

function inferStrip(r: LLMRoom, hw: Rect, isH: boolean, facing: Facing): StripAssignment {
  if (r.type === "porch" || r.type === "foyer") return "ENTRANCE";
  const cx = r.x + r.width / 2, cy = r.y + r.depth / 2;
  if (isH) {
    const mid = hw.y + hw.depth / 2;
    return facing === "north" ? (cy > mid ? "FRONT" : "BACK") : (cy < mid ? "FRONT" : "BACK");
  }
  const mid = hw.x + hw.width / 2;
  return facing === "east" ? (cx > mid ? "FRONT" : "BACK") : (cx < mid ? "FRONT" : "BACK");
}

function getAdj(id: string, p: ParsedConstraints): string[] {
  const out: string[] = [];
  for (const a of p.adjacency_pairs) {
    if (a.room_a_id === id) out.push(a.room_b_id);
    if (a.room_b_id === id) out.push(a.room_a_id);
  }
  return out;
}

function wireWallIds(rooms: StripPackRoom[], walls: { id: string; room_ids: string[] }[]): void {
  const m = new Map<string, string[]>();
  for (const w of walls) for (const id of w.room_ids) { if (!m.has(id)) m.set(id, []); m.get(id)!.push(w.id); }
  for (const r of rooms) r.wall_ids = m.get(r.id) ?? [];
}

// ───────────────────────────────────────────────────────────────────────────
// PREPROCESSOR (from strip-pack-engine)
// ───────────────────────────────────────────────────────────────────────────

function preprocessParsed(raw: ParsedConstraints, prompt: string | undefined, warnings: string[]): ParsedConstraints {
  const parsed: ParsedConstraints = {
    ...raw, plot: { ...raw.plot },
    rooms: raw.rooms.map(r => ({ ...r, doors: r.doors.map(d => ({ ...d })), windows: r.windows.map(w => ({ ...w })) })),
    adjacency_pairs: raw.adjacency_pairs.map(a => ({ ...a })),
    connects_all_groups: raw.connects_all_groups.map(g => ({ ...g, connected_room_ids: [...g.connected_room_ids] })),
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
    const hasFeat = parsed.special_features.some(f => (f.feature === "porch" || f.feature === "verandah") && f.mentioned_verbatim);
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

// ───────────────────────────────────────────────────────────────────────────
// METRICS
// ───────────────────────────────────────────────────────────────────────────

function computeMetrics(rooms: StripPackRoom[], spine: SpineLayout, plot: Rect, reqAdj: number): StripPackMetrics {
  let occ = spine.spine.width * spine.spine.depth;
  for (const r of rooms) if (r.placed) occ += r.placed.width * r.placed.depth;
  const pa = rectArea(plot);
  return {
    efficiency_pct: Math.round(Math.min(100, (occ / pa) * 100) * 10) / 10,
    void_area_sqft: Math.round(Math.max(0, pa - occ)),
    door_coverage_pct: 0, orphan_rooms: [], adjacency_satisfaction_pct: 0,
    total_rooms: rooms.length, rooms_with_doors: 0,
    required_adjacencies: reqAdj, satisfied_adjacencies: 0,
  };
}
