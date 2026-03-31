/**
 * AI Spatial Layout — GPT-4o-powered room coordinate generation
 *
 * GPT-4o sees ALL rooms + constraints simultaneously and outputs
 * exact (x, y, width, depth) coordinates for every room.
 *
 * Validation + retry with SPECIFIC error feedback (max 2 retries).
 * Gap-closing pass after acceptance to fix GPT-4o coordinate drift.
 * Falls back to algorithmic layout if AI fails.
 */

import { getClient } from "@/services/openai";
import type { EnhancedRoomProgram, RoomSpec } from "./ai-room-programmer";
import type { PlacedRoom } from "./layout-engine";

// ── Grid snap ──────────────────────────────────────────────────────────────

const GRID = 0.1;
function grid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

// ── System prompt ──────────────────────────────────────────────────────────

const SPATIAL_SYSTEM_PROMPT = `You are an expert Indian residential architect. Given a building footprint and room program, output EXACT coordinates for every room.

COORDINATE SYSTEM:
- Origin (0,0) = TOP-LEFT of footprint. X → right. Y → down. All in METERS, rounded to 0.10m.

ABSOLUTE NBC 2016 RULES — EVERY room MUST meet these or the plan is REJECTED:
- Living Room: area >= 9.5 sq.m, min(width,depth) >= 2.4m
- Dining Room: area >= 9.5 sq.m, min(width,depth) >= 2.4m
- Kitchen: area >= 5.5 sq.m, min(width,depth) >= 2.1m
- ANY Bedroom: area >= 9.5 sq.m, min(width,depth) >= 2.7m, aspect ratio <= 2.0 (e.g. 4.0x3.5 OK, 6.6x2.8 TOO ELONGATED)
- Master Bedroom: area >= 12.0 sq.m, min(width,depth) >= 3.0m, aspect ratio <= 2.0
- Bathroom: area >= 2.8 AND <= 4.5 sq.m (typical: 2.0m x 2.0m = 4.0 sq.m), min(width,depth) >= 1.5m
- Study/Office: area >= 6.0 sq.m, min(width,depth) >= 2.4m
- Corridor: min(width,depth) MUST be >= 1.2m (NOT 0.6m, NOT 1.0m — at least 1.2m)
- Balcony: min depth 1.2m

ROOM PROPORTION RULES:
- Bedrooms MUST have aspect ratio <= 2.0 (width/depth or depth/width). A 4.0m x 3.5m bedroom is good. A 6.6m x 2.8m bedroom is REJECTED (ratio 2.36).
- Make bedrooms more square: ideal ratio between 1.0 and 1.5.
- Corridor is the ONLY room allowed to be long and narrow.

SIZE PRIORITY (if space is tight, reduce in this order):
1. NEVER reduce Bedrooms below 9.5 sq.m — this is the #1 rule
2. Reduce Study/Utility FIRST (study needs only 6-8 sq.m, utility 3-5 sq.m)
3. Reduce Balcony to minimum 3 sq.m
4. Reduce Kitchen toward 7 sq.m (never below 5.5)
5. Reduce Dining toward 9.5 sq.m (never below 9.5)
6. NEVER let any Bathroom exceed 4.5 sq.m (typical bathroom is 2.0m x 2.0m)

WALL SHARING — THIS IS CRITICAL:
- Adjacent rooms MUST share an edge. If Room A ends at x=4.70, Room B MUST start at x=4.70 (not 5.20).
- NO GAPS between rooms. Every room edge must either touch another room or the footprint boundary.
- Rooms should tile together like puzzle pieces filling the entire footprint.
- The sum of all room areas must be >= 85% of footprint area.

ARCHITECTURAL RULES:
1. Kitchen MUST share a wall with Dining Room
2. Dining MUST share a wall with Living Room
3. Each Bedroom MUST share a wall with its paired Bathroom
4. Living Room, ALL Bedrooms, Kitchen, Dining MUST touch at least one footprint edge
5. Include a corridor connecting public and private zones
6. No habitable room aspect ratio > 2.0 (except corridor/balcony)

OUTPUT FORMAT — ONLY JSON, no markdown, no explanation:
{"rooms": [{"name": "Room Name", "type": "room_type", "x": 0.0, "y": 0.0, "width": 4.0, "depth": 3.5}]}

SELF-CHECK before responding — verify EACH room:
1. width * depth >= NBC minimum area for that room type?
2. min(width, depth) >= NBC minimum dimension?
3. Every bathroom area <= 4.5 sq.m? (NOT 5, NOT 6 — max 4.5)
4. Every bedroom >= 9.5 sq.m AND aspect ratio <= 2.0?
5. Corridor min(width,depth) >= 1.2m? (NOT 0.6, NOT 1.0)
6. Kitchen touching Dining? Each Bedroom touching its Bathroom?
7. No overlaps? No gaps between adjacent rooms?
8. All rooms fit within [0, fpW] x [0, fpH]?

If ANY check fails, FIX your coordinates before responding.`;

// ── NBC lookup (uses BOTH type and name for reliability) ───────────────────

function getNBCMin(type: string, name: string): { minArea: number; minDim: number; maxArea?: number } {
  const n = name.toLowerCase();
  // Name-based detection first (more reliable than GPT-returned type)
  if (n.includes("master") && (n.includes("bed") || type === "bedroom"))
    return { minArea: 12.0, minDim: 3.0 };
  if (n.includes("bed") || type === "bedroom")
    return { minArea: 9.5, minDim: 2.7 };
  if (n.includes("bath") || n.includes("toilet") || n.includes("wc") || type === "bathroom")
    return { minArea: 2.8, minDim: 1.5, maxArea: 4.5 };
  if (n.includes("living") || type === "living")
    return { minArea: 9.5, minDim: 2.4 };
  if (n.includes("dining") || type === "dining")
    return { minArea: 9.5, minDim: 2.4 };
  if (n.includes("kitchen") || type === "kitchen")
    return { minArea: 5.5, minDim: 2.1 };
  if (n.includes("study") || n.includes("office") || type === "office")
    return { minArea: 6.0, minDim: 2.4 };
  if (n.includes("corridor") || n.includes("hallway") || type === "hallway")
    return { minArea: 2.0, minDim: 1.05 };
  if (n.includes("staircase") || type === "staircase")
    return { minArea: 6.0, minDim: 2.5 };
  if (n.includes("balcony") || type === "balcony")
    return { minArea: 2.0, minDim: 1.2 };
  if (n.includes("foyer") || n.includes("entrance") || type === "entrance")
    return { minArea: 2.5, minDim: 1.5 };
  return { minArea: 2.5, minDim: 1.2 };
}

// ── Build user message ─────────────────────────────────────────────────────

function buildUserMessage(
  program: EnhancedRoomProgram,
  fpW: number, fpH: number,
): string {
  const roomTable = program.rooms.map(r => {
    const std = getNBCMin(r.type, r.name);
    const maxNote = std.maxArea ? `, MAX ${std.maxArea} sq.m` : "";
    return `- ${r.name} (${r.type}): target ${r.areaSqm.toFixed(1)} sq.m, NBC min ${std.minArea} sq.m / ${std.minDim}m${maxNote}${r.mustHaveExteriorWall ? " [EXTERIOR WALL REQUIRED]" : ""}`;
  }).join("\n");

  const adjList = program.adjacency.map(a =>
    `- ${a.roomA} ↔ ${a.roomB} (${a.reason}) — rooms MUST share a wall (touching edges)`
  ).join("\n");

  const vastuLine = program.isVastuRequested
    ? "\nVASTU: Kitchen in SE, Master Bedroom in SW, Pooja in NE, Living in N/E."
    : "";

  return `Design a floor plan for: ${program.originalPrompt ?? program.projectName}

FOOTPRINT: ${fpW.toFixed(1)}m wide x ${fpH.toFixed(1)}m deep (origin top-left, Y-down)
TOTAL AREA: ${program.totalAreaSqm.toFixed(1)} sq.m
${vastuLine}

ROOMS (${program.rooms.length} rooms — include ALL of them):
${roomTable}

ADJACENCY (rooms MUST share a wall — no gaps between them):
${adjList || "- Use architectural best practices"}

CRITICAL REMINDERS:
- Every Bedroom >= 9.5 sq.m AND aspect ratio <= 2.0 (e.g. 4.0x3.5m, NOT 6.6x2.8m).
- Every Bathroom MUST be between 2.8 and 4.5 sq.m (typical: 2.0m x 2.0m = 4.0 sq.m). NOT 5, NOT 6.
- Corridor min(width,depth) MUST be >= 1.2m. NOT 0.6m. NOT 1.0m. At LEAST 1.2m.
- Adjacent rooms share edges exactly: Room A ends at x=4.0, Room B starts at x=4.0.
- ALL room areas sum to >= ${(fpW * fpH * 0.85).toFixed(1)} sq.m.
- Footprint: x in [0, ${fpW.toFixed(1)}], y in [0, ${fpH.toFixed(1)}].

Output JSON with coordinates for all ${program.rooms.length} rooms.`;
}

// ── Validation ─────────────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  score: number;
  errors: string[];
  warnings: string[];
}

function validateAILayout(
  rooms: PlacedRoom[],
  fpW: number, fpH: number,
  program: EnhancedRoomProgram,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const TOL = 0.20; // 200mm tolerance for wall thickness

  // 1. All rooms within footprint
  for (const r of rooms) {
    if (r.x < -TOL || r.y < -TOL || r.x + r.width > fpW + TOL || r.y + r.depth > fpH + TOL) {
      errors.push(`${r.name} outside footprint`);
    }
  }

  // 2. No overlaps
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
      if (ox > TOL && oy > TOL) {
        errors.push(`${a.name} overlaps ${b.name}`);
      }
    }
  }

  // 3. NBC minimum areas and dimensions — uses NAME-BASED detection
  for (const r of rooms) {
    const nbc = getNBCMin(r.type, r.name);
    const area = r.width * r.depth;
    const minDim = Math.min(r.width, r.depth);

    if (area < nbc.minArea * 0.95) {
      // Find the biggest non-bedroom room to suggest stealing from
      const biggest = rooms
        .filter(rm => rm.type !== "bedroom" && !rm.name.toLowerCase().includes("bed") &&
                      rm.type !== "living" && rm.type !== "hallway")
        .sort((a, b) => (b.width * b.depth) - (a.width * a.depth))[0];
      const suggestion = biggest
        ? ` Reduce ${biggest.name} (${(biggest.width * biggest.depth).toFixed(1)}m²) to give space to ${r.name}.`
        : "";
      errors.push(`${r.name} area ${area.toFixed(1)}m² < NBC min ${nbc.minArea}m² (needs ${r.name} to be at least ${Math.ceil(nbc.minArea * 10) / 10}m²).${suggestion}`);
    }
    if (minDim < nbc.minDim - 0.05) {
      errors.push(`${r.name} min dimension ${minDim.toFixed(2)}m < ${nbc.minDim}m. Make ${r.name} at least ${nbc.minDim}m in both width and depth.`);
    }

    // Bathroom max area
    if (nbc.maxArea && area > nbc.maxArea + 0.3) {
      errors.push(`${r.name} area ${area.toFixed(1)}m² exceeds ${nbc.maxArea}m² max. Shrink ${r.name} to ~${nbc.maxArea.toFixed(1)}m² (e.g., ${Math.sqrt(nbc.maxArea).toFixed(1)}m x ${Math.sqrt(nbc.maxArea).toFixed(1)}m).`);
    }
  }

  // 4. No bathroom larger than smallest bedroom
  const bedAreas = rooms
    .filter(r => r.type === "bedroom" || r.name.toLowerCase().includes("bed"))
    .map(r => r.width * r.depth);
  const minBedArea = bedAreas.length > 0 ? Math.min(...bedAreas) : 999;
  for (const r of rooms) {
    if (r.type === "bathroom" || r.name.toLowerCase().includes("bath") || r.name.toLowerCase().includes("toilet")) {
      const area = r.width * r.depth;
      if (area > minBedArea && bedAreas.length > 0) {
        errors.push(`${r.name} (${area.toFixed(1)}m²) larger than smallest bedroom (${minBedArea.toFixed(1)}m²)`);
      }
    }
  }

  // 5. Kitchen-Dining adjacency
  const kitchen = rooms.find(r => r.type === "kitchen" || r.name.toLowerCase().includes("kitchen"));
  const dining = rooms.find(r => r.type === "dining" || r.name.toLowerCase().includes("dining"));
  if (kitchen && dining && !roomsTouch(kitchen, dining, TOL)) {
    errors.push("Kitchen and Dining Room do not share a wall. Move them so their rectangles touch.");
  }

  // 6. Bedroom-Bathroom adjacency
  for (const adj of program.adjacency) {
    const a = rooms.find(r => r.name === adj.roomA);
    const b = rooms.find(r => r.name === adj.roomB);
    if (!a || !b) continue;
    const nameA = adj.roomA.toLowerCase();
    const nameB = adj.roomB.toLowerCase();
    const isBedBath = (nameA.includes("bed") || nameA.includes("master")) &&
                      (nameB.includes("bath") || nameB.includes("toilet"));
    const isBathBed = (nameB.includes("bed") || nameB.includes("master")) &&
                      (nameA.includes("bath") || nameA.includes("toilet"));
    if ((isBedBath || isBathBed) && !roomsTouch(a, b, TOL)) {
      errors.push(`${adj.roomA} and ${adj.roomB} must share a wall but don't touch.`);
    }
  }

  // 7. Exterior wall check (warning, not hard error)
  for (const spec of program.rooms) {
    if (!spec.mustHaveExteriorWall) continue;
    const r = rooms.find(rm => rm.name === spec.name);
    if (!r) continue;
    const onEdge = r.x < TOL || r.y < TOL ||
      Math.abs(r.x + r.width - fpW) < TOL ||
      Math.abs(r.y + r.depth - fpH) < TOL;
    if (!onEdge) {
      warnings.push(`${r.name} should touch a footprint edge for windows`);
    }
  }

  // 8. Corridor minimum width (HARD — 1.2m minimum)
  for (const r of rooms) {
    const isCorridor = r.type === "hallway" || r.name.toLowerCase().includes("corr") ||
                       r.name.toLowerCase().includes("passage") || r.name.toLowerCase().includes("hallway");
    if (isCorridor) {
      const minDim = Math.min(r.width, r.depth);
      if (minDim < 1.15) { // 1.2m with 0.05m tolerance
        errors.push(`Corridor "${r.name}" width ${minDim.toFixed(2)}m is below 1.2m minimum. Corridor min(width,depth) MUST be >= 1.2m.`);
      }
    }
  }

  // 9. Bedroom aspect ratio (HARD — max 2.0)
  for (const r of rooms) {
    const isBedroom = r.type === "bedroom" || r.name.toLowerCase().includes("bed") ||
                      r.name.toLowerCase().includes("master");
    if (isBedroom) {
      const ratio = Math.max(r.width, r.depth) / Math.min(r.width, r.depth);
      if (ratio > 2.05) { // 2.0 with small tolerance
        const shorter = Math.min(r.width, r.depth);
        const longer = Math.max(r.width, r.depth);
        const idealShorter = Math.sqrt(r.width * r.depth / 1.4); // target AR ~1.4
        errors.push(`${r.name} aspect ratio ${ratio.toFixed(1)} exceeds 2.0 max (${r.width.toFixed(1)}m x ${r.depth.toFixed(1)}m). Make it more square, e.g., ${idealShorter.toFixed(1)}m x ${(r.width * r.depth / idealShorter).toFixed(1)}m.`);
      }
    }
  }

  // 10. Coverage
  const totalRoomArea = rooms.reduce((s, r) => s + r.width * r.depth, 0);
  const coverage = totalRoomArea / (fpW * fpH);
  if (coverage < 0.75) {
    warnings.push(`Coverage ${(coverage * 100).toFixed(0)}% — rooms have large gaps`);
  }

  const score = Math.max(0, 1.0 - errors.length * 0.15 - warnings.length * 0.03);
  return { valid: errors.length === 0, score, errors, warnings };
}

function roomsTouch(a: PlacedRoom, b: PlacedRoom, tol: number): boolean {
  const hTouch =
    (Math.abs((a.y + a.depth) - b.y) < tol || Math.abs((b.y + b.depth) - a.y) < tol) &&
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > tol;
  const vTouch =
    (Math.abs((a.x + a.width) - b.x) < tol || Math.abs((b.x + b.width) - a.x) < tol) &&
    Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y) > tol;
  return hTouch || vTouch;
}

// ── Gap-closing pass ───────────────────────────────────────────────────────

/**
 * Close gaps between rooms that should be adjacent.
 * GPT-4o often leaves 0.1-0.5m gaps between rooms. This pass finds
 * nearby edges and snaps them together, then expands rooms to touch
 * footprint boundaries.
 */
function closeGaps(rooms: PlacedRoom[], fpW: number, fpH: number): PlacedRoom[] {
  const result = rooms.map(r => ({ ...r }));
  const GAP_TOL = 0.6; // close gaps up to 600mm

  // Pass 1: Snap nearby edges between room pairs
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i], b = result[j];

        // Check vertical overlap (for horizontal edge snapping)
        const vOverlap = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
        if (vOverlap > 0.3) {
          // A right edge → B left edge
          const gapR = b.x - (a.x + a.width);
          if (gapR > 0.01 && gapR < GAP_TOL) {
            const mid = grid((a.x + a.width + b.x) / 2);
            a.width = grid(mid - a.x);
            b.width = grid(b.x + b.width - mid);
            b.x = mid;
          }
          // B right edge → A left edge
          const gapL = a.x - (b.x + b.width);
          if (gapL > 0.01 && gapL < GAP_TOL) {
            const mid = grid((b.x + b.width + a.x) / 2);
            b.width = grid(mid - b.x);
            a.width = grid(a.x + a.width - mid);
            a.x = mid;
          }
        }

        // Check horizontal overlap (for vertical edge snapping)
        const hOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        if (hOverlap > 0.3) {
          // A bottom edge → B top edge
          const gapB = b.y - (a.y + a.depth);
          if (gapB > 0.01 && gapB < GAP_TOL) {
            const mid = grid((a.y + a.depth + b.y) / 2);
            a.depth = grid(mid - a.y);
            b.depth = grid(b.y + b.depth - mid);
            b.y = mid;
          }
          // B bottom edge → A top edge
          const gapT = a.y - (b.y + b.depth);
          if (gapT > 0.01 && gapT < GAP_TOL) {
            const mid = grid((b.y + b.depth + a.y) / 2);
            b.depth = grid(mid - b.y);
            a.depth = grid(a.y + a.depth - mid);
            a.y = mid;
          }
        }
      }
    }
  }

  // Pass 2: Expand rooms to touch footprint edges if close
  for (const r of result) {
    if (r.x > 0 && r.x < GAP_TOL) {
      r.width = grid(r.width + r.x);
      r.x = 0;
    }
    if (r.y > 0 && r.y < GAP_TOL) {
      r.depth = grid(r.depth + r.y);
      r.y = 0;
    }
    const rightGap = fpW - (r.x + r.width);
    if (rightGap > 0 && rightGap < GAP_TOL) {
      r.width = grid(fpW - r.x);
    }
    const bottomGap = fpH - (r.y + r.depth);
    if (bottomGap > 0 && bottomGap < GAP_TOL) {
      r.depth = grid(fpH - r.y);
    }
  }

  // Recompute areas
  for (const r of result) {
    r.area = grid(r.width * r.depth);
  }

  return result;
}

// ── Parse GPT-4o response ──────────────────────────────────────────────────

function parseAIResponse(content: string): PlacedRoom[] | null {
  try {
    const parsed = JSON.parse(content);
    const rawRooms = parsed.rooms;
    if (!Array.isArray(rawRooms) || rawRooms.length === 0) return null;

    return rawRooms.map((r: Record<string, unknown>) => {
      const w = grid(Number(r.width ?? r.w ?? 3));
      const d = grid(Number(r.depth ?? r.h ?? r.d ?? 3));
      return {
        name: String(r.name ?? "Room"),
        type: String(r.type ?? "other"),
        x: grid(Number(r.x ?? 0)),
        y: grid(Number(r.y ?? 0)),
        width: w,
        depth: d,
        area: grid(w * d),
      };
    });
  } catch (err) {
    console.error("[AI-SPATIAL] Parse error:", err);
    return null;
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function generateAISpatialLayout(
  program: EnhancedRoomProgram,
  fpW: number, fpH: number,
  userApiKey?: string,
): Promise<PlacedRoom[] | null> {
  const MAX_RETRIES = 2;

  try {
    const client = getClient(userApiKey, 60_000);
    let lastErrors: string[] = [];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const userMessage = buildUserMessage(program, fpW, fpH);

      // On retry, append SPECIFIC errors with fix suggestions
      const retryFeedback = attempt > 0
        ? `\n\n--- ERRORS IN YOUR PREVIOUS ATTEMPT (you MUST fix ALL) ---\n${lastErrors.map((e, i) => `${i + 1}. ${e}`).join("\n")}\n\nFix every error above. Remember: bedrooms >= 9.5 sq.m, bathrooms <= 5.0 sq.m, adjacent rooms share edges exactly.`
        : "";

      const completion = await client.chat.completions.create({
        model: "gpt-4o",
        temperature: attempt === 0 ? 0.3 : 0.2, // lower temp on retry
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SPATIAL_SYSTEM_PROMPT },
          { role: "user", content: userMessage + retryFeedback },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        console.warn(`[AI-SPATIAL] Attempt ${attempt + 1}: empty response`);
        continue;
      }

      const rooms = parseAIResponse(content);
      if (!rooms || rooms.length === 0) {
        console.warn(`[AI-SPATIAL] Attempt ${attempt + 1}: parse failed`);
        continue;
      }

      // Close gaps before validation (GPT-4o coordinate drift)
      const gapClosed = closeGaps(rooms, fpW, fpH);

      const validation = validateAILayout(gapClosed, fpW, fpH, program);
      console.log(
        `[AI-SPATIAL] Attempt ${attempt + 1}: ${gapClosed.length} rooms, ` +
        `score=${validation.score.toFixed(2)}, errors=${validation.errors.length}, ` +
        `warnings=${validation.warnings.length}`
      );
      if (validation.errors.length > 0) {
        console.log(`[AI-SPATIAL] Errors: ${validation.errors.join("; ")}`);
      }

      if (validation.valid) {
        console.log(`[AI-SPATIAL] ACCEPTED on attempt ${attempt + 1}`);
        return gapClosed;
      }

      lastErrors = validation.errors;
    }

    console.warn(`[AI-SPATIAL] Failed after ${MAX_RETRIES + 1} attempts`);
    return null;
  } catch (err) {
    console.error("[AI-SPATIAL] Error:", err instanceof Error ? err.message : err);
    return null;
  }
}
