/**
 * LLM-driven floor plan layout engine.
 *
 * Instead of encoding architectural knowledge in a strip-pack algorithm,
 * this engine asks GPT-4o to place rooms on the plot. The LLM has been
 * trained on millions of floor plans and already knows architectural
 * conventions (master bedroom away from entrance, kitchen near dining,
 * hallway connects everything, rooms tile the plot with shared walls).
 *
 * Pipeline:
 *   1. Build a precise system prompt with plot dims, room list, adjacency
 *   2. Call GPT-4o with structured JSON output (temperature 0.3)
 *   3. Validate + repair the LLM output (snap edges, clamp to plot, fix overlaps)
 *   4. Convert to StripPackRoom[] + SpineLayout
 *   5. Call existing wall-builder, door-placer, window-placer
 *   6. Return StripPackResult (same type as the strip-pack engine)
 *
 * The existing converter.ts then turns StripPackResult → FloorPlanProject.
 */

import { getClient } from "@/features/ai/services/openai";
import type { ParsedConstraints, ParsedRoom } from "./structured-parser";
import type {
  Facing,
  Rect,
  StripPackResult,
  StripPackRoom,
  StripPackMetrics,
  SpineLayout,
  RoomZone,
  StripAssignment,
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
  hallway: { x: number; y: number; width: number; depth: number };
}

// ───────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ───────────────────────────────────────────────────────────────────────────

const LLM_MODEL = "gpt-4o";
const LLM_TEMPERATURE = 0.3;
const LLM_MAX_TOKENS = 4096;
const LLM_TIMEOUT_MS = 30_000;
const SNAP_THRESHOLD_FT = 0.5;

const ZONE_BY_TYPE: Record<string, RoomZone> = {
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

const DEFAULT_DIMS: Record<string, [number, number]> = {
  bedroom: [12, 11], master_bedroom: [14, 13], guest_bedroom: [12, 11],
  kids_bedroom: [11, 10], living: [16, 13], dining: [12, 11],
  kitchen: [10, 9], bathroom: [7, 5], master_bathroom: [9, 6],
  powder_room: [5, 4], walk_in_wardrobe: [7, 5], walk_in_closet: [7, 5],
  foyer: [8, 7], porch: [9, 6], verandah: [12, 8], balcony: [10, 4],
  corridor: [12, 4], utility: [6, 5], store: [6, 5], laundry: [6, 5],
  pantry: [6, 5], pooja: [5, 4], study: [10, 9], other: [10, 8],
};

// ───────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────────

export async function runLLMLayoutEngine(
  prompt: string,
  parsed: ParsedConstraints,
  apiKey: string,
): Promise<StripPackResult> {
  const warnings: string[] = [];
  const facing = normalizeFacing(parsed.plot.facing);
  const plotW = parsed.plot.width_ft ?? 40;
  const plotD = parsed.plot.depth_ft ?? 50;
  const plot: Rect = { x: 0, y: 0, width: plotW, depth: plotD };

  // Step 1: Build prompt
  const systemPrompt = buildSystemPrompt(parsed, plotW, plotD, facing);
  const roomListStr = formatRoomList(parsed);

  // Step 2: Call LLM
  const llmStart = Date.now();
  let layout = await callLLMForLayout(systemPrompt, prompt, roomListStr, apiKey);
  const llmMs = Date.now() - llmStart;
  warnings.push(`LLM layout call: ${llmMs}ms, ${layout.rooms.length} rooms returned`);

  // Step 3: Validate and repair
  layout = validateAndRepair(layout, plot, parsed, warnings);

  // Step 4: Convert to StripPackRoom[] + SpineLayout
  const { rooms, spine } = llmToStripPack(layout, parsed, facing, plot, warnings);

  // Step 4b: Ensure every room shares a wall with the hallway or a hallway-
  //          touching room. This prevents orphan cascades caused by small gaps.
  ensureHallwayConnectivity(rooms, spine, plot, warnings);

  // Step 5: Build walls, doors, windows using existing proven pipeline
  const walls = buildWalls({ rooms, spine, plot });

  // Wire wall_ids
  const wallsByRoom = new Map<string, string[]>();
  for (const w of walls) {
    for (const id of w.room_ids) {
      if (!wallsByRoom.has(id)) wallsByRoom.set(id, []);
      wallsByRoom.get(id)!.push(w.id);
    }
  }
  for (const r of rooms) r.wall_ids = wallsByRoom.get(r.id) ?? [];

  const adjacencyPairs = parsed.adjacency_pairs.map(p => ({ a: p.room_a_id, b: p.room_b_id }));
  const porchRoom = rooms.find(r => r.type === "porch" || r.type === "verandah");
  const foyerRoom = rooms.find(r => r.type === "foyer");

  const doorOut = placeDoors({
    rooms, walls, spine, adjacencyPairs,
    porchId: porchRoom?.id,
    foyerId: foyerRoom?.id,
  });
  warnings.push(...doorOut.warnings);

  const winOut = placeWindows({
    rooms, walls, doors: doorOut.doors, facing,
  });
  warnings.push(...winOut.warnings);

  // Step 6: Compute metrics
  const metrics = computeMetrics(rooms, spine, plot, adjacencyPairs.length);

  return {
    rooms, spine, walls,
    doors: doorOut.doors,
    windows: winOut.windows,
    plot, metrics, warnings,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ───────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(
  parsed: ParsedConstraints,
  plotW: number,
  plotD: number,
  facing: Facing,
): string {
  const hallwayDir = (facing === "north" || facing === "south") ? "EAST-WEST" : "NORTH-SOUTH";
  const hallwayDim = (facing === "north" || facing === "south")
    ? `width=${plotW}ft (full plot width), depth=4ft`
    : `width=4ft, depth=${plotD}ft (full plot depth)`;

  const facingDescriptions: Record<Facing, string> = {
    north: `NORTH (road at top, y=${plotD}). Porch at top, INSIDE plot (y + depth ≤ ${plotD}). Foyer directly below porch, touching hallway's top edge.`,
    south: `SOUTH (road at bottom, y=0). Porch at bottom, INSIDE plot (y ≥ 0). Foyer directly above porch, touching hallway's bottom edge.`,
    east:  `EAST (road at right, x=${plotW}). Porch at right, INSIDE plot (x + width ≤ ${plotW}). Foyer directly left of porch, touching hallway's right edge.`,
    west:  `WEST (road at left, x=0). Porch at left, INSIDE plot (x ≥ 0). Foyer directly right of porch, touching hallway's left edge.`,
  };

  return `You are an expert residential architect. Place rooms on a rectangular plot to create a professional floor plan.

COORDINATE SYSTEM:
- Origin (0,0) is the SOUTHWEST corner
- X grows EAST (0 = west edge, ${plotW} = east edge)
- Y grows NORTH (0 = south edge, ${plotD} = north edge)
- All dimensions in FEET

PLOT: ${plotW}ft wide × ${plotD}ft deep
FACING: ${facingDescriptions[facing]}
TOTAL AREA: ${parsed.plot.total_built_up_sqft ?? plotW * plotD} sqft

HALLWAY (use these EXACT coordinates):
- Runs ${hallwayDir} across the FULL plot
${facing === "north" ? `- hallway: { "x": 0, "y": ${Math.round(plotD * 0.55)}, "width": ${plotW}, "depth": 4 }
- Entrance-side rooms go ABOVE hallway (y > ${Math.round(plotD * 0.55) + 4})
- Back-side rooms go BELOW hallway (y < ${Math.round(plotD * 0.55)})` :
  facing === "south" ? `- hallway: { "x": 0, "y": ${Math.round(plotD * 0.45)}, "width": ${plotW}, "depth": 4 }
- Entrance-side rooms go BELOW hallway (y < ${Math.round(plotD * 0.45)})
- Back-side rooms go ABOVE hallway (y > ${Math.round(plotD * 0.45) + 4})` :
  facing === "east" ? `- hallway: { "x": ${Math.round(plotW * 0.55)}, "y": 0, "width": 4, "depth": ${plotD} }
- Entrance-side rooms go RIGHT of hallway (x > ${Math.round(plotW * 0.55) + 4})
- Back-side rooms go LEFT of hallway (x < ${Math.round(plotW * 0.55)})` :
  `- hallway: { "x": ${Math.round(plotW * 0.45)}, "y": 0, "width": 4, "depth": ${plotD} }
- Entrance-side rooms go LEFT of hallway (x < ${Math.round(plotW * 0.45)})
- Back-side rooms go RIGHT of hallway (x > ${Math.round(plotW * 0.45) + 4})`}
- Foyer MUST have one edge touching the hallway edge exactly

RULES (follow ALL):

1. WALL SHARING — THE MOST CRITICAL RULE:
   - Adjacent rooms MUST have edges that are MATHEMATICALLY IDENTICAL
   - If Room A ends at x=14, Room B starts at x=14 EXACTLY — no gaps
   - Rooms must TILE the plot like a jigsaw puzzle
   - The union of all rooms + hallway should cover ≥85% of the plot

2. CONNECTIVITY (CRITICAL):
   - The foyer MUST share a wall with the hallway — their edges must touch exactly
   - The porch MUST share a wall with the foyer
   - The porch MUST be INSIDE the plot boundary (not extending beyond)
   - EVERY room must share a wall with the hallway OR with a room that touches the hallway
   - Path must exist: Porch → Foyer → Hallway → every other room
   - For north-facing: foyer's bottom edge = hallway's top edge (same Y coordinate)
   - For south-facing: foyer's top edge = hallway's bottom edge
   - For east-facing: foyer's left edge = hallway's right edge
   - For west-facing: foyer's right edge = hallway's left edge

3. PLACEMENT ZONES:
   - ENTRANCE SIDE: Living, dining, foyer, porch, pooja
   - BACK SIDE: Bedrooms, kitchen, bathrooms, utility
   - Attached rooms (ensuite, wardrobe) share a wall with their parent bedroom

4. GEOMETRY:
   - All rooms are rectangles (axis-aligned)
   - No room outside plot boundary
   - No overlapping rooms
   - No room smaller than 4ft in any dimension
   - Aspect ratio no worse than 3:1

5. DIMENSIONS:
   - Use user-specified dimensions (±15% adjustment OK for fit)
   - Never shrink below 70% of requested area

OUTPUT: Return ONLY valid JSON (no markdown, no backticks, no explanation):
{
  "rooms": [
    { "name": "Room Name", "type": "room_function", "x": 0, "y": 0, "width": 10, "depth": 8 }
  ],
  "hallway": { "x": 0, "y": 18, "width": ${plotW}, "depth": 4 }
}

Include hallway BOTH as "hallway" object AND in rooms array (type "corridor").
Include porch and foyer in rooms array.
Double-check: no overlaps, no gaps between adjacent rooms, all rooms inside plot.`;
}

// ───────────────────────────────────────────────────────────────────────────
// ROOM LIST FORMATTING
// ───────────────────────────────────────────────────────────────────────────

function formatRoomList(parsed: ParsedConstraints): string {
  const lines: string[] = ["ROOMS TO PLACE:"];

  for (const room of parsed.rooms) {
    if (room.is_circulation) continue; // hallway handled in system prompt
    const w = room.dim_width_ft;
    const d = room.dim_depth_ft;
    const dims = (w && d) ? `${w}ft × ${d}ft` : `use default size for ${room.function}`;
    const pos = room.position_direction
      ? ` [position: ${normalizePositionLabel(room.position_direction)}]`
      : "";
    const attached = room.attached_to_room_id
      ? ` [ATTACHED to ${findRoomNameById(parsed, room.attached_to_room_id)}]`
      : "";
    lines.push(`- ${room.name}: ${dims}${pos}${attached} (type: ${room.function})`);
  }

  // Synthesize porch if missing
  const hasPorch = parsed.rooms.some(r => r.function === "porch" || r.function === "verandah");
  if (!hasPorch) {
    lines.push(`- Porch: 6ft × 5ft [position: ${parsed.plot.facing ?? "N"} wall centered] (type: porch)`);
  }

  if (parsed.adjacency_pairs.length > 0) {
    lines.push("\nADJACENCY (rooms that MUST share a wall):");
    for (const adj of parsed.adjacency_pairs) {
      if (adj.relationship === "attached_ensuite") continue; // handled by [ATTACHED]
      const a = findRoomNameById(parsed, adj.room_a_id);
      const b = findRoomNameById(parsed, adj.room_b_id);
      if (a && b) lines.push(`- ${a} adjacent to ${b}`);
    }
  }

  return lines.join("\n");
}

function normalizePositionLabel(dir: string): string {
  const map: Record<string, string> = {
    N: "north side", S: "south side", E: "east side", W: "west side",
    NE: "northeast corner", NW: "northwest corner",
    SE: "southeast corner", SW: "southwest corner",
    CENTER: "center",
  };
  return map[dir] ?? dir;
}

function findRoomNameById(parsed: ParsedConstraints, id: string): string | null {
  return parsed.rooms.find(r => r.id === id)?.name ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// LLM CALL
// ───────────────────────────────────────────────────────────────────────────

async function callLLMForLayout(
  systemPrompt: string,
  userPrompt: string,
  roomListStr: string,
  apiKey: string,
): Promise<LLMLayoutResponse> {
  const client = getClient(apiKey, LLM_TIMEOUT_MS);

  const completion = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: LLM_TEMPERATURE,
    max_tokens: LLM_MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Create a floor plan layout for:\n\n${userPrompt}\n\n${roomListStr}` },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("LLM returned empty content");

  const cleaned = raw.replace(/```json\s*|```\s*/g, "").trim();
  const layout = JSON.parse(cleaned) as LLMLayoutResponse;

  if (!layout.rooms || !Array.isArray(layout.rooms)) {
    throw new Error("LLM response missing rooms array");
  }

  return layout;
}

// ───────────────────────────────────────────────────────────────────────────
// VALIDATE AND REPAIR
// ───────────────────────────────────────────────────────────────────────────

function validateAndRepair(
  layout: LLMLayoutResponse,
  plot: Rect,
  parsed: ParsedConstraints,
  warnings: string[],
): LLMLayoutResponse {
  const rooms = layout.rooms;

  // 1. Ensure hallway exists
  if (!layout.hallway) {
    const corridorRoom = rooms.find(r =>
      r.type === "corridor" || r.type === "hallway" || r.name.toLowerCase().includes("hallway"),
    );
    if (corridorRoom) {
      layout.hallway = { x: corridorRoom.x, y: corridorRoom.y, width: corridorRoom.width, depth: corridorRoom.depth };
      warnings.push("Extracted hallway from corridor room in rooms array");
    } else {
      warnings.push("No hallway in LLM output — synthesizing");
      const hw = 4;
      const facing = normalizeFacing(parsed.plot.facing);
      if (facing === "north" || facing === "south") {
        layout.hallway = { x: 0, y: plot.depth * 0.45, width: plot.width, depth: hw };
      } else {
        layout.hallway = { x: plot.width * 0.45, y: 0, width: hw, depth: plot.depth };
      }
      rooms.push({ name: "Hallway", type: "corridor", ...layout.hallway });
    }
  }

  // 2. Ensure hallway is in rooms array
  const hasCorridorInRooms = rooms.some(r => r.type === "corridor" || r.type === "hallway");
  if (!hasCorridorInRooms) {
    rooms.push({ name: "Hallway", type: "corridor", ...layout.hallway });
  }

  // 3. Round all coordinates to nearest 0.5ft to eliminate floating-point
  //    gaps and micro-overlaps. Rooms align better on a clean grid.
  for (const room of rooms) {
    room.x = Math.round(room.x * 2) / 2;
    room.y = Math.round(room.y * 2) / 2;
    room.width = Math.round(room.width * 2) / 2;
    room.depth = Math.round(room.depth * 2) / 2;
  }

  // 4. Clamp all rooms to plot boundary (move inside, don't shrink)
  for (const room of rooms) {
    if (room.x < 0) room.x = 0;
    if (room.y < 0) room.y = 0;
    if (room.x + room.width > plot.width) {
      room.x = Math.max(0, plot.width - room.width);
    }
    if (room.y + room.depth > plot.depth) {
      room.y = Math.max(0, plot.depth - room.depth);
    }
    room.width = Math.max(room.width, 4);
    room.depth = Math.max(room.depth, 4);
  }

  // 5. Snap near-miss edge alignment
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      snapEdges(rooms[i], rooms[j], SNAP_THRESHOLD_FT);
    }
  }

  // 5b. Resolve overlaps — nudge the smaller room to share an edge
  //     instead of shrinking (shrinking creates gaps that break connectivity)
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const overlap = computeRectOverlap(rooms[i], rooms[j]);
        if (overlap > 2.0) {
          resolveOverlap(rooms[i], rooms[j], plot, warnings);
        }
      }
    }
  }

  // 6. CRITICAL: Force foyer to touch hallway (prevents orphan cascade)
  const facing = normalizeFacing(parsed.plot.facing);
  const hw = layout.hallway;
  const foyer = rooms.find(r => r.type === "foyer" || r.name.toLowerCase().includes("foyer"));
  if (foyer && hw) {
    const isHorizontal = hw.width > hw.depth;
    if (isHorizontal) {
      // Hallway runs E-W. Foyer must touch hallway's top or bottom edge.
      const hwTop = hw.y + hw.depth;
      const hwBot = hw.y;
      const foyerBot = foyer.y;
      const foyerTop = foyer.y + foyer.depth;
      if (facing === "north") {
        // Foyer should be ABOVE hallway → foyer.y = hwTop
        if (Math.abs(foyerBot - hwTop) > 0.01) {
          foyer.depth = foyerTop - hwTop;
          foyer.y = hwTop;
          if (foyer.depth < 4) foyer.depth = 5;
          warnings.push(`Foyer: y adjusted to ${hwTop} to touch hallway top edge`);
        }
      } else {
        // south: foyer below hallway → foyer.y + foyer.depth = hwBot
        if (Math.abs(foyerTop - hwBot) > 0.01) {
          foyer.y = hwBot - foyer.depth;
          if (foyer.y < 0) { foyer.y = 0; foyer.depth = hwBot; }
          warnings.push(`Foyer: adjusted to touch hallway bottom edge`);
        }
      }
    } else {
      // Hallway runs N-S. Foyer must touch hallway's left or right edge.
      const hwRight = hw.x + hw.width;
      const hwLeft = hw.x;
      if (facing === "east") {
        // Foyer east of hallway → foyer.x = hwRight
        if (Math.abs(foyer.x - hwRight) > 0.01) {
          const oldRight = foyer.x + foyer.width;
          foyer.x = hwRight;
          foyer.width = Math.max(5, oldRight - hwRight);
          warnings.push(`Foyer: x adjusted to ${hwRight} to touch hallway right edge`);
        }
      } else {
        // west: foyer west of hallway → foyer.x + foyer.width = hwLeft
        if (Math.abs(foyer.x + foyer.width - hwLeft) > 0.01) {
          foyer.x = hwLeft - foyer.width;
          if (foyer.x < 0) { foyer.width = hwLeft; foyer.x = 0; }
          warnings.push(`Foyer: adjusted to touch hallway left edge`);
        }
      }
    }
  }

  // 7. Fix porch placement — must be INSIDE plot and touching foyer
  const porch = rooms.find(r => r.type === "porch" || r.name.toLowerCase().includes("porch"));
  if (porch) {
    // If porch extends beyond plot, move it inside
    if (porch.y + porch.depth > plot.depth) {
      porch.y = plot.depth - porch.depth;
      warnings.push(`Porch: moved inside plot (y=${porch.y.toFixed(1)})`);
    }
    if (porch.x + porch.width > plot.width) {
      porch.x = plot.width - porch.width;
      warnings.push(`Porch: moved inside plot (x=${porch.x.toFixed(1)})`);
    }
    if (porch.y < 0) porch.y = 0;
    if (porch.x < 0) porch.x = 0;

    // Ensure porch touches foyer
    if (foyer) {
      if (facing === "north") {
        porch.y = foyer.y + foyer.depth;
        if (porch.y + porch.depth > plot.depth) porch.depth = plot.depth - porch.y;
      } else if (facing === "south") {
        porch.y = foyer.y - porch.depth;
        if (porch.y < 0) { porch.depth = foyer.y; porch.y = 0; }
      } else if (facing === "east") {
        porch.x = foyer.x + foyer.width;
        if (porch.x + porch.width > plot.width) porch.width = plot.width - porch.x;
      } else {
        porch.x = foyer.x - porch.width;
        if (porch.x < 0) { porch.width = foyer.x; porch.x = 0; }
      }
      // Center porch on foyer
      if (facing === "north" || facing === "south") {
        porch.x = foyer.x + (foyer.width - porch.width) / 2;
        porch.x = Math.max(0, Math.min(porch.x, plot.width - porch.width));
      } else {
        porch.y = foyer.y + (foyer.depth - porch.depth) / 2;
        porch.y = Math.max(0, Math.min(porch.y, plot.depth - porch.depth));
      }
    }
  }

  // 8. Ensure all parsed rooms are represented
  for (const pr of parsed.rooms) {
    if (pr.is_circulation) continue;
    const found = rooms.find(r =>
      r.name.toLowerCase() === pr.name.toLowerCase() ||
      r.type === pr.function ||
      r.name.toLowerCase().includes(pr.name.toLowerCase().split(" ")[0]),
    );
    if (!found) {
      warnings.push(`${pr.name}: missing from LLM output — synthesizing`);
      const [dw, dd] = DEFAULT_DIMS[pr.function] ?? [10, 8];
      const w = pr.dim_width_ft ?? dw;
      const d = pr.dim_depth_ft ?? dd;
      // Place at first available position (overflow-style)
      const pos = findOpenPosition(w, d, rooms, layout.hallway, plot);
      rooms.push({ name: pr.name, type: pr.function, x: pos.x, y: pos.y, width: w, depth: d });
    }
  }

  return layout;
}

function snapEdges(a: LLMRoom, b: LLMRoom, threshold: number): void {
  // A right ≈ B left
  const arbl = (a.x + a.width) - b.x;
  if (Math.abs(arbl) < threshold && Math.abs(arbl) > 0.01) {
    const mid = a.x + a.width - arbl / 2;
    a.width = mid - a.x;
    b.width += b.x - mid;
    b.x = mid;
  }
  // B right ≈ A left
  const bral = (b.x + b.width) - a.x;
  if (Math.abs(bral) < threshold && Math.abs(bral) > 0.01) {
    const mid = b.x + b.width - bral / 2;
    b.width = mid - b.x;
    a.width += a.x - mid;
    a.x = mid;
  }
  // A top ≈ B bottom
  const atbb = (a.y + a.depth) - b.y;
  if (Math.abs(atbb) < threshold && Math.abs(atbb) > 0.01) {
    const mid = a.y + a.depth - atbb / 2;
    a.depth = mid - a.y;
    b.depth += b.y - mid;
    b.y = mid;
  }
  // B top ≈ A bottom
  const btab = (b.y + b.depth) - a.y;
  if (Math.abs(btab) < threshold && Math.abs(btab) > 0.01) {
    const mid = b.y + b.depth - btab / 2;
    b.depth = mid - b.y;
    a.depth += a.y - mid;
    a.y = mid;
  }
}

function computeRectOverlap(a: LLMRoom, b: LLMRoom): number {
  const x0 = Math.max(a.x, b.x);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y0 = Math.max(a.y, b.y);
  const y1 = Math.min(a.y + a.depth, b.y + b.depth);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

function resolveOverlap(a: LLMRoom, b: LLMRoom, plot: Rect, warnings: string[]): void {
  const aArea = a.width * a.depth;
  const bArea = b.width * b.depth;
  const smaller = aArea < bArea ? a : b;
  const larger = smaller === a ? b : a;

  // Find which edge of the larger room the smaller overlaps least on,
  // then nudge the smaller to that edge
  const overlapX = Math.min(smaller.x + smaller.width, larger.x + larger.width) - Math.max(smaller.x, larger.x);
  const overlapY = Math.min(smaller.y + smaller.depth, larger.y + larger.depth) - Math.max(smaller.y, larger.y);

  if (overlapX < overlapY) {
    // Nudge horizontally
    if (smaller.x < larger.x) {
      smaller.width = larger.x - smaller.x;
    } else {
      const newX = larger.x + larger.width;
      smaller.width = Math.max(4, smaller.x + smaller.width - newX);
      smaller.x = newX;
    }
  } else {
    // Nudge vertically
    if (smaller.y < larger.y) {
      smaller.depth = larger.y - smaller.y;
    } else {
      const newY = larger.y + larger.depth;
      smaller.depth = Math.max(4, smaller.y + smaller.depth - newY);
      smaller.y = newY;
    }
  }

  // Clamp to plot
  if (smaller.x + smaller.width > plot.width) smaller.width = plot.width - smaller.x;
  if (smaller.y + smaller.depth > plot.depth) smaller.depth = plot.depth - smaller.y;

  warnings.push(`${smaller.name}: resized to resolve overlap with ${larger.name}`);
}

function findOpenPosition(
  w: number, d: number,
  rooms: LLMRoom[],
  hallway: { x: number; y: number; width: number; depth: number },
  plot: Rect,
): { x: number; y: number } {
  const blockers = rooms.map(r => ({ x: r.x, y: r.y, width: r.width, depth: r.depth }));
  blockers.push(hallway);
  const step = 1;
  for (let y = 0; y <= plot.depth - d; y += step) {
    for (let x = 0; x <= plot.width - w; x += step) {
      const cand = { x, y, width: w, depth: d };
      let blocked = false;
      for (const b of blockers) {
        if (computeRectOverlap(
          { name: "", type: "", ...cand },
          { name: "", type: "", ...b },
        ) > 0.1) {
          blocked = true;
          break;
        }
      }
      if (!blocked) return { x, y };
    }
  }
  return { x: 0, y: 0 }; // last resort
}

// ───────────────────────────────────────────────────────────────────────────
// CONVERT LLM OUTPUT → STRIP-PACK TYPES
// ───────────────────────────────────────────────────────────────────────────

function llmToStripPack(
  layout: LLMLayoutResponse,
  parsed: ParsedConstraints,
  facing: Facing,
  plot: Rect,
  warnings: string[],
): { rooms: StripPackRoom[]; spine: SpineLayout } {
  const hw = layout.hallway;
  const spineRect: Rect = { x: hw.x, y: hw.y, width: hw.width, depth: hw.depth };

  // Build front/back strips from hallway position
  const isHorizontal = hw.width > hw.depth;
  let frontStrip: Rect;
  let backStrip: Rect;

  if (isHorizontal) {
    // Hallway runs E-W
    if (facing === "north") {
      frontStrip = { x: 0, y: hw.y + hw.depth, width: plot.width, depth: plot.depth - (hw.y + hw.depth) };
      backStrip = { x: 0, y: 0, width: plot.width, depth: hw.y };
    } else {
      frontStrip = { x: 0, y: 0, width: plot.width, depth: hw.y };
      backStrip = { x: 0, y: hw.y + hw.depth, width: plot.width, depth: plot.depth - (hw.y + hw.depth) };
    }
  } else {
    // Hallway runs N-S
    if (facing === "east") {
      frontStrip = { x: hw.x + hw.width, y: 0, width: plot.width - (hw.x + hw.width), depth: plot.depth };
      backStrip = { x: 0, y: 0, width: hw.x, depth: plot.depth };
    } else {
      frontStrip = { x: 0, y: 0, width: hw.x, depth: plot.depth };
      backStrip = { x: hw.x + hw.width, y: 0, width: plot.width - (hw.x + hw.width), depth: plot.depth };
    }
  }

  const spine: SpineLayout = {
    spine: spineRect,
    front_strip: frontStrip,
    back_strip: backStrip,
    entrance_rooms: [],
    remaining_front: [frontStrip],
    orientation: isHorizontal ? "horizontal" : "vertical",
    entrance_side: facing,
    hallway_width_ft: isHorizontal ? hw.depth : hw.width,
  };

  // Convert LLM rooms to StripPackRoom[]
  const rooms: StripPackRoom[] = [];
  const parsedByName = new Map<string, ParsedRoom>();
  for (const pr of parsed.rooms) {
    parsedByName.set(pr.name.toLowerCase(), pr);
  }

  for (const llmRoom of layout.rooms) {
    // Skip the hallway/corridor — it's the spine, not a packable room
    if (llmRoom.type === "corridor" || llmRoom.type === "hallway") continue;

    const pr = matchParsedRoom(llmRoom, parsed);
    const fn = pr?.function ?? llmRoom.type ?? "other";
    const zone = ZONE_BY_TYPE[fn] ?? "PRIVATE";
    const strip = inferStripFromPosition(llmRoom, spineRect, isHorizontal, facing);

    const reqW = pr?.dim_width_ft ?? llmRoom.width;
    const reqD = pr?.dim_depth_ft ?? llmRoom.depth;

    const room: StripPackRoom = {
      id: pr?.id ?? `llm_${llmRoom.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name: llmRoom.name,
      type: fn,
      requested_width_ft: reqW,
      requested_depth_ft: reqD,
      requested_area_sqft: reqW * reqD,
      zone,
      strip,
      position_preference: pr?.position_direction ?? undefined,
      adjacencies: pr ? getAdjacencies(pr.id, parsed) : [],
      is_attached_to: pr?.attached_to_room_id ?? undefined,
      needs_exterior_wall: zone === "PUBLIC" || fn.includes("bedroom"),
      is_wet: pr?.is_wet ?? (fn.includes("bath") || fn === "kitchen"),
      is_sacred: pr?.is_sacred ?? (fn === "pooja"),
      placed: { x: llmRoom.x, y: llmRoom.y, width: llmRoom.width, depth: llmRoom.depth },
      actual_area_sqft: llmRoom.width * llmRoom.depth,
    };
    rooms.push(room);
  }

  return { rooms, spine };
}

function matchParsedRoom(llm: LLMRoom, parsed: ParsedConstraints): ParsedRoom | undefined {
  const llmNameLower = llm.name.toLowerCase();
  // Exact name match
  let match = parsed.rooms.find(r => r.name.toLowerCase() === llmNameLower);
  if (match) return match;
  // Function match
  match = parsed.rooms.find(r => r.function === llm.type && !r.is_circulation);
  if (match) return match;
  // Partial name match
  match = parsed.rooms.find(r => {
    const rLower = r.name.toLowerCase();
    return rLower.includes(llmNameLower) || llmNameLower.includes(rLower);
  });
  if (match) return match;
  // Token overlap
  const llmTokens = llmNameLower.split(/\s+/).filter(t => t.length >= 3);
  for (const pr of parsed.rooms) {
    const prTokens = pr.name.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
    const overlap = llmTokens.filter(t => prTokens.includes(t)).length;
    if (overlap > 0) return pr;
  }
  return undefined;
}

function getAdjacencies(roomId: string, parsed: ParsedConstraints): string[] {
  const adj: string[] = [];
  for (const p of parsed.adjacency_pairs) {
    if (p.room_a_id === roomId) adj.push(p.room_b_id);
    if (p.room_b_id === roomId) adj.push(p.room_a_id);
  }
  return adj;
}

function inferStripFromPosition(
  room: LLMRoom,
  spine: Rect,
  isHorizontal: boolean,
  facing: Facing,
): StripAssignment {
  if (room.type === "porch" || room.type === "verandah" || room.type === "foyer") return "ENTRANCE";

  const roomCenterX = room.x + room.width / 2;
  const roomCenterY = room.y + room.depth / 2;

  if (isHorizontal) {
    const spineY = spine.y + spine.depth / 2;
    if (facing === "north") return roomCenterY > spineY ? "FRONT" : "BACK";
    return roomCenterY < spineY ? "FRONT" : "BACK";
  } else {
    const spineX = spine.x + spine.width / 2;
    if (facing === "east") return roomCenterX > spineX ? "FRONT" : "BACK";
    return roomCenterX < spineX ? "FRONT" : "BACK";
  }
}

// ───────────────────────────────────────────────────────────────────────────
// METRICS
// ───────────────────────────────────────────────────────────────────────────

function computeMetrics(
  rooms: StripPackRoom[],
  spine: SpineLayout,
  plot: Rect,
  requiredAdjacencies: number,
): StripPackMetrics {
  let occupied = spine.spine.width * spine.spine.depth;
  for (const r of rooms) if (r.placed) occupied += r.placed.width * r.placed.depth;
  const plotArea = rectArea(plot);
  const efficiency_pct = plotArea > 0 ? Math.min(100, (occupied / plotArea) * 100) : 0;
  const void_area_sqft = Math.max(0, plotArea - occupied);

  return {
    efficiency_pct: Math.round(efficiency_pct * 10) / 10,
    void_area_sqft: Math.round(void_area_sqft),
    door_coverage_pct: 0,
    orphan_rooms: [],
    adjacency_satisfaction_pct: 0,
    total_rooms: rooms.length,
    rooms_with_doors: 0,
    required_adjacencies: requiredAdjacencies,
    satisfied_adjacencies: 0,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// HALLWAY CONNECTIVITY REPAIR
// ───────────────────────────────────────────────────────────────────────────

/**
 * Ensure every room is reachable from the hallway via shared walls. If a
 * room doesn't share an edge with the hallway or with any hallway-connected
 * room, extend or nudge it to create the connection.
 *
 * This fixes the most common LLM error: rooms placed with 1-3ft gaps from
 * the hallway that prevent wall/door generation.
 */
function ensureHallwayConnectivity(
  rooms: StripPackRoom[],
  spine: SpineLayout,
  plot: Rect,
  warnings: string[],
): void {
  const spineRect = spine.spine;

  // Build connectivity graph. A room is "connected" if it shares an edge
  // (>0.5ft overlap) with the hallway or with any connected room.
  const sharesEdge = (a: Rect, b: Rect): boolean => {
    const eps = 0.2;
    const minLen = 0.5;
    // Horizontal edge
    if (Math.abs(a.y + a.depth - b.y) < eps || Math.abs(b.y + b.depth - a.y) < eps) {
      const o = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      if (o > minLen) return true;
    }
    // Vertical edge
    if (Math.abs(a.x + a.width - b.x) < eps || Math.abs(b.x + b.width - a.x) < eps) {
      const o = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
      if (o > minLen) return true;
    }
    return false;
  };

  // BFS from hallway to find all connected rooms
  const connected = new Set<string>();
  const queue: string[] = [];

  // Seed: rooms that touch the hallway
  for (const r of rooms) {
    if (!r.placed) continue;
    if (sharesEdge(r.placed, spineRect)) {
      connected.add(r.id);
      queue.push(r.id);
    }
  }

  // Expand: rooms that touch connected rooms
  while (queue.length > 0) {
    const curId = queue.shift()!;
    const curRoom = rooms.find(r => r.id === curId);
    if (!curRoom?.placed) continue;
    for (const other of rooms) {
      if (!other.placed || connected.has(other.id)) continue;
      if (sharesEdge(curRoom.placed, other.placed)) {
        connected.add(other.id);
        queue.push(other.id);
      }
    }
  }

  // For each disconnected room, extend it toward the hallway
  for (const room of rooms) {
    if (!room.placed || connected.has(room.id)) continue;

    const p = room.placed;
    const isHorizontal = spine.orientation === "horizontal";

    // Try to extend toward the hallway
    if (isHorizontal) {
      const hwTop = spineRect.y + spineRect.depth;
      const hwBot = spineRect.y;
      const roomBot = p.y;
      const roomTop = p.y + p.depth;

      if (roomBot > hwTop) {
        // Room is above hallway — extend downward
        const gap = roomBot - hwTop;
        if (gap < 10) {
          p.depth += gap;
          p.y = hwTop;
          warnings.push(`${room.name}: extended ${gap.toFixed(1)}ft down to touch hallway`);
        }
      } else if (roomTop < hwBot) {
        // Room is below hallway — extend upward
        const gap = hwBot - roomTop;
        if (gap < 10) {
          p.depth += gap;
          warnings.push(`${room.name}: extended ${gap.toFixed(1)}ft up to touch hallway`);
        }
      }
    } else {
      const hwRight = spineRect.x + spineRect.width;
      const hwLeft = spineRect.x;
      const roomLeft = p.x;
      const roomRight = p.x + p.width;

      if (roomLeft > hwRight) {
        const gap = roomLeft - hwRight;
        if (gap < 10) {
          p.width += gap;
          p.x = hwRight;
          warnings.push(`${room.name}: extended ${gap.toFixed(1)}ft left to touch hallway`);
        }
      } else if (roomRight < hwLeft) {
        const gap = hwLeft - roomRight;
        if (gap < 10) {
          p.width += gap;
          warnings.push(`${room.name}: extended ${gap.toFixed(1)}ft right to touch hallway`);
        }
      }
    }

    room.actual_area_sqft = p.width * p.depth;
  }
}
