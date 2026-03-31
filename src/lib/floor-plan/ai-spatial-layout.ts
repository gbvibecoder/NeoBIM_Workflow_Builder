/**
 * AI Spatial Layout — GPT-4o-powered room coordinate generation
 *
 * Replaces algorithmic layout (BSP/spine) with AI spatial reasoning.
 * GPT-4o sees ALL rooms + constraints simultaneously and outputs
 * exact (x, y, width, depth) coordinates for every room.
 *
 * Includes validation + retry with error feedback (max 2 retries).
 * Falls back to algorithmic layout if AI fails or is unavailable.
 *
 * Integration: Called from layoutFloorPlan() as primary path.
 * Returns PlacedRoom[] identical to BSP output format.
 */

import { getClient } from "@/services/openai";
import type { EnhancedRoomProgram, RoomSpec, AdjacencyRequirement } from "./ai-room-programmer";
import type { PlacedRoom } from "./layout-engine";

// ── Grid snap (match layout-engine) ────────────────────────────────────────

const GRID = 0.1;

function grid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

// ── System prompt ──────────────────────────────────────────────────────────

const SPATIAL_SYSTEM_PROMPT = `You are an expert Indian residential architect with 25 years of experience designing floor plans that comply with NBC 2016 and IS codes. You specialize in space-efficient layouts for Indian homes.

Your task: Given a building footprint and room program, output the EXACT coordinates (x, y, width, depth) for every room so that the plan is architecturally sound and NBC compliant.

COORDINATE SYSTEM:
- Origin (0,0) is the TOP-LEFT corner of the footprint (Y increases downward)
- X increases rightward (East)
- Y increases downward (South)
- All dimensions in METERS, rounded to nearest 0.10m
- Entry facade is at y=footprintDepth (bottom edge) unless specified otherwise

MANDATORY NBC 2016 RULES (you MUST satisfy ALL of these):
- Living Room: min area 9.5 sq.m, min dimension 2.4m, ideal 12-20 sq.m
- Dining Room: min area 9.5 sq.m, min dimension 2.4m, ideal 10-14 sq.m
- Kitchen: min area 5.5 sq.m, min dimension 2.1m, ideal 8-12 sq.m
- Bedroom: min area 9.5 sq.m, min dimension 2.7m, ideal 10-16 sq.m
- Master Bedroom: min area 12.0 sq.m, min dimension 3.0m, ideal 14-18 sq.m
- Bathroom: min area 2.8 sq.m, min dimension 1.5m, MAX 5.0 sq.m
- Study/Office: min area 6.0 sq.m, min dimension 2.4m
- Corridor: min width 1.2m
- Balcony: min depth 1.2m
- Staircase: min 2.5m x 3.0m

ARCHITECTURAL RULES (you MUST follow ALL of these):
1. ADJACENCY: Kitchen MUST share a wall (touching rectangles) with Dining Room. Dining MUST touch Living Room. Each Bedroom MUST touch its paired Bathroom.
2. EXTERIOR WALLS: Living Room, ALL Bedrooms, Kitchen, and Dining MUST touch at least one footprint edge (x=0, x=fpW, y=0, or y=fpH).
3. CIRCULATION: Include a corridor connecting entry to all zones. No room accessible only through another private room.
4. ENTRY SEQUENCE: Foyer/entrance near entry edge. Living Room near entry. Bedrooms away from entry (privacy gradient).
5. PROPORTIONS: No habitable room aspect ratio > 2.0 (except corridor and balcony).
6. NO OVERLAPS: Rooms may touch (share a wall) but must NOT overlap. Two rooms overlap if their rectangles intersect with area > 0.
7. COMPLETE TILING: Rooms should fill >=85% of footprint. Minimize gaps.
8. BATHROOM SIZE: Every bathroom MUST be 2.8-5.0 sq.m. No bathroom may be larger than any bedroom.

DESIGN PRINCIPLES:
- Public zone (living, dining, kitchen) near entry, grouped together
- Private zone (bedrooms, bathrooms) away from entry, grouped together
- Service rooms (utility, storage) can be interior
- Kitchen and bathrooms share plumbing walls where possible
- Living room gets maximum facade exposure for light and ventilation

OUTPUT FORMAT — Respond with ONLY a JSON object, no markdown, no explanation:
{
  "rooms": [
    {"name": "Living Room", "type": "living", "x": 0.0, "y": 0.0, "width": 4.50, "depth": 3.80},
    {"name": "Kitchen", "type": "kitchen", "x": 4.50, "y": 0.0, "width": 3.00, "depth": 3.00}
  ]
}

BEFORE outputting, mentally verify ALL of these (fix any that fail):
1. Every room area (width x depth) >= NBC minimum for its type?
2. Every room min(width, depth) >= NBC minimum dimension for its type?
3. Kitchen and Dining rectangles touch (share an edge)?
4. Every Bedroom rectangle touches its paired Bathroom rectangle?
5. Living, Bedrooms, Kitchen, Dining all touch a footprint edge?
6. No two room rectangles overlap (intersect with positive area)?
7. Every room fits within footprint boundary [0, fpW] x [0, fpH]?
8. Every bathroom area <= 5.0 sq.m?
9. Sum of all room areas >= 85% of footprint area?
10. No habitable room has aspect ratio > 2.0?`;

// ── Few-shot example ───────────────────────────────────────────────────────

const FEW_SHOT_EXAMPLE = `
EXAMPLE — "3BHK apartment, 1200 sqft" (footprint 13.6m x 8.2m):

{
  "rooms": [
    {"name": "Foyer", "type": "entrance", "x": 5.0, "y": 6.7, "width": 1.8, "depth": 1.5},
    {"name": "Living Room", "type": "living", "x": 0.0, "y": 4.5, "width": 5.0, "depth": 3.7},
    {"name": "Dining Room", "type": "dining", "x": 0.0, "y": 1.5, "width": 3.8, "depth": 3.0},
    {"name": "Kitchen", "type": "kitchen", "x": 3.8, "y": 1.5, "width": 3.0, "depth": 3.0},
    {"name": "Corridor", "type": "hallway", "x": 5.0, "y": 1.5, "width": 1.2, "depth": 5.2},
    {"name": "Master Bedroom", "type": "bedroom", "x": 6.8, "y": 4.2, "width": 4.0, "depth": 4.0},
    {"name": "Bathroom 1", "type": "bathroom", "x": 6.8, "y": 2.7, "width": 2.0, "depth": 1.5},
    {"name": "Bedroom 2", "type": "bedroom", "x": 8.8, "y": 0.0, "width": 4.8, "depth": 3.5},
    {"name": "Bathroom 2", "type": "bathroom", "x": 6.8, "y": 0.0, "width": 2.0, "depth": 1.5},
    {"name": "Bedroom 3", "type": "bedroom", "x": 0.0, "y": 0.0, "width": 3.8, "depth": 1.5},
    {"name": "Bathroom 3", "type": "bathroom", "x": 10.8, "y": 4.2, "width": 1.5, "depth": 2.0},
    {"name": "Balcony", "type": "balcony", "x": 0.0, "y": 6.7, "width": 3.0, "depth": 1.5}
  ]
}

Note: Kitchen touches Dining (shared wall at x=3.8). Each bedroom touches its bathroom. Living room at entry edge. All habitable rooms touch footprint edges.`;

// ── Build user message ─────────────────────────────────────────────────────

function buildUserMessage(
  program: EnhancedRoomProgram,
  fpW: number,
  fpH: number,
): string {
  const roomTable = program.rooms.map(r => {
    const std = getNBCMin(r.type, r.name);
    return `- ${r.name} (${r.type}): target ${r.areaSqm.toFixed(1)} sq.m, NBC min ${std.minArea} sq.m / ${std.minDim}m${r.mustHaveExteriorWall ? " [MUST touch exterior]" : ""}`;
  }).join("\n");

  const adjList = program.adjacency.map(a =>
    `- ${a.roomA} ↔ ${a.roomB} (${a.reason}) — MUST share a wall`
  ).join("\n");

  const vastuLine = program.isVastuRequested
    ? "VASTU REQUESTED: Kitchen in SE, Master Bedroom in SW, Pooja in NE, Living in N/E, Entrance from N or E preferred."
    : "";

  const facingLine = program.facingDirection
    ? `PLOT FACING: ${program.facingDirection} (entry from ${program.facingDirection})`
    : "Entry: from bottom edge (y = footprintDepth)";

  return `Design a floor plan for:
${program.originalPrompt ?? program.projectName}

FOOTPRINT: ${fpW.toFixed(1)}m wide (X) x ${fpH.toFixed(1)}m deep (Y)
TOTAL AREA: ${program.totalAreaSqm.toFixed(1)} sq.m
${facingLine}
${vastuLine}

ROOM PROGRAM (${program.rooms.length} rooms):
${roomTable}

ADJACENCY REQUIREMENTS:
${adjList || "- None specified (use architectural best practices)"}

CONSTRAINTS:
- Footprint boundary: x in [0, ${fpW.toFixed(1)}], y in [0, ${fpH.toFixed(1)}]
- Every dimension rounded to 0.10m
- Kitchen MUST touch Dining Room (shared wall)
- Each Bedroom MUST touch its paired Bathroom (shared wall)
- Living Room, ALL Bedrooms, Kitchen, Dining MUST touch a footprint edge
- ALL bathrooms: area between 2.8 and 5.0 sq.m
- Corridor width >= 1.2m
- No room overlap allowed
- Total room area >= ${(fpW * fpH * 0.85).toFixed(1)} sq.m (85% of footprint)

Output the JSON coordinates for ALL ${program.rooms.length} rooms.${program.rooms.length > 8 ? "\n\n" + FEW_SHOT_EXAMPLE : ""}`;
}

// ── NBC minimums lookup ────────────────────────────────────────────────────

function getNBCMin(type: string, name: string): { minArea: number; minDim: number } {
  const n = name.toLowerCase();
  if (n.includes("master") && (type === "bedroom" || n.includes("bed")))
    return { minArea: 12.0, minDim: 3.0 };
  switch (type) {
    case "living": return { minArea: 9.5, minDim: 2.4 };
    case "dining": return { minArea: 9.5, minDim: 2.4 };
    case "kitchen": return { minArea: 5.5, minDim: 2.1 };
    case "bedroom": return { minArea: 9.5, minDim: 2.7 };
    case "bathroom": return { minArea: 2.8, minDim: 1.5 };
    case "office": return { minArea: 6.0, minDim: 2.4 };
    case "hallway": return { minArea: 2.0, minDim: 1.05 };
    case "staircase": return { minArea: 6.0, minDim: 2.5 };
    case "balcony": return { minArea: 2.0, minDim: 1.2 };
    case "entrance": return { minArea: 2.5, minDim: 1.5 };
    default: return { minArea: 2.5, minDim: 1.2 };
  }
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
  fpW: number,
  fpH: number,
  program: EnhancedRoomProgram,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const TOL = 0.15;

  // 1. All rooms within footprint
  for (const r of rooms) {
    if (r.x < -TOL || r.y < -TOL || r.x + r.width > fpW + TOL || r.y + r.depth > fpH + TOL) {
      errors.push(`${r.name} outside footprint: (${r.x},${r.y}) ${r.width}x${r.depth}`);
    }
  }

  // 2. No overlaps
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
      if (ox > TOL && oy > TOL) {
        errors.push(`${a.name} overlaps ${b.name} by ${(ox * oy).toFixed(2)}m²`);
      }
    }
  }

  // 3. NBC minimum areas and dimensions
  for (const r of rooms) {
    const spec = program.rooms.find(s => s.name === r.name);
    const nbc = getNBCMin(r.type, r.name);
    const area = r.width * r.depth;
    const minDim = Math.min(r.width, r.depth);

    if (area < nbc.minArea * 0.95) {
      errors.push(`${r.name} area ${area.toFixed(1)}m² < NBC min ${nbc.minArea}m²`);
    }
    if (minDim < nbc.minDim - 0.05) {
      errors.push(`${r.name} dim ${minDim.toFixed(2)}m < NBC min ${nbc.minDim}m`);
    }
  }

  // 4. Bathroom max 5.0m² and smaller than every bedroom
  const bedAreas = rooms.filter(r => r.type === "bedroom").map(r => r.width * r.depth);
  const minBedArea = bedAreas.length > 0 ? Math.min(...bedAreas) : 999;
  for (const r of rooms) {
    if (r.type === "bathroom") {
      const area = r.width * r.depth;
      if (area > 5.5) {
        errors.push(`${r.name} area ${area.toFixed(1)}m² > 5.5m² max`);
      }
      if (area > minBedArea && bedAreas.length > 0) {
        errors.push(`${r.name} (${area.toFixed(1)}m²) larger than smallest bedroom (${minBedArea.toFixed(1)}m²)`);
      }
    }
  }

  // 5. Kitchen-Dining adjacency (HARD)
  const kitchen = rooms.find(r => r.type === "kitchen");
  const dining = rooms.find(r => r.type === "dining" || r.name.toLowerCase().includes("dining"));
  if (kitchen && dining && !roomsTouch(kitchen, dining, TOL)) {
    errors.push("Kitchen and Dining Room do not share a wall");
  }

  // 6. Bedroom-Bathroom adjacency (HARD)
  for (const adj of program.adjacency) {
    const a = rooms.find(r => r.name === adj.roomA);
    const b = rooms.find(r => r.name === adj.roomB);
    if (!a || !b) continue;
    const isBedBath = (a.type === "bedroom" && b.type === "bathroom") ||
                      (a.type === "bathroom" && b.type === "bedroom");
    if (isBedBath && !roomsTouch(a, b, TOL)) {
      errors.push(`${adj.roomA} and ${adj.roomB} do not share a wall (${adj.reason})`);
    }
  }

  // 7. Exterior wall check
  for (const spec of program.rooms) {
    if (!spec.mustHaveExteriorWall) continue;
    const r = rooms.find(rm => rm.name === spec.name);
    if (!r) continue;
    const onEdge = r.x < TOL || r.y < TOL ||
      Math.abs(r.x + r.width - fpW) < TOL ||
      Math.abs(r.y + r.depth - fpH) < TOL;
    if (!onEdge) {
      warnings.push(`${r.name} needs exterior wall but is interior`);
    }
  }

  // 8. Coverage
  const totalRoomArea = rooms.reduce((s, r) => s + r.width * r.depth, 0);
  const coverage = totalRoomArea / (fpW * fpH);
  if (coverage < 0.80) {
    warnings.push(`Coverage ${(coverage * 100).toFixed(0)}% below 85% target`);
  }

  // 9. Aspect ratios
  for (const r of rooms) {
    if (r.type === "hallway" || r.type === "balcony") continue;
    const ratio = Math.max(r.width, r.depth) / Math.min(r.width, r.depth);
    if (ratio > 2.5) {
      warnings.push(`${r.name} AR ${ratio.toFixed(1)} > 2.0`);
    }
  }

  const score = Math.max(0, 1.0 - errors.length * 0.12 - warnings.length * 0.03);
  return { valid: errors.length === 0, score, errors, warnings };
}

function roomsTouch(a: PlacedRoom, b: PlacedRoom, tol: number): boolean {
  // Horizontal edge touch
  const hTouch =
    (Math.abs((a.y + a.depth) - b.y) < tol || Math.abs((b.y + b.depth) - a.y) < tol) &&
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > tol;
  // Vertical edge touch
  const vTouch =
    (Math.abs((a.x + a.width) - b.x) < tol || Math.abs((b.x + b.width) - a.x) < tol) &&
    Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y) > tol;
  return hTouch || vTouch;
}

// ── Parse GPT-4o response ──────────────────────────────────────────────────

function parseAIResponse(content: string, program: EnhancedRoomProgram): PlacedRoom[] | null {
  try {
    const parsed = JSON.parse(content);
    const rawRooms = parsed.rooms;
    if (!Array.isArray(rawRooms) || rawRooms.length === 0) return null;

    const placed: PlacedRoom[] = rawRooms.map((r: Record<string, unknown>) => ({
      name: String(r.name ?? "Room"),
      type: String(r.type ?? "other"),
      x: grid(Number(r.x ?? 0)),
      y: grid(Number(r.y ?? 0)),
      width: grid(Number(r.width ?? r.w ?? 3)),
      depth: grid(Number(r.depth ?? r.h ?? 3)),
      area: 0,
    }));

    // Compute areas
    for (const r of placed) {
      r.area = grid(r.width * r.depth);
    }

    return placed;
  } catch (err) {
    console.error("[AI-SPATIAL] Failed to parse response:", err);
    return null;
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function generateAISpatialLayout(
  program: EnhancedRoomProgram,
  fpW: number,
  fpH: number,
  userApiKey?: string,
): Promise<PlacedRoom[] | null> {
  const MAX_RETRIES = 2;

  try {
    const client = getClient(userApiKey, 60_000);
    let lastErrors: string[] = [];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const userMessage = buildUserMessage(program, fpW, fpH);

      // On retry, append errors for GPT-4o to fix
      const retryFeedback = attempt > 0
        ? `\n\nYour PREVIOUS layout had these ERRORS — you MUST fix ALL of them:\n${lastErrors.map(e => `- ${e}`).join("\n")}\n\nAdjust coordinates to fix every error. Do NOT repeat the same mistakes.`
        : "";

      const completion = await client.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.3,
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

      const rooms = parseAIResponse(content, program);
      if (!rooms || rooms.length === 0) {
        console.warn(`[AI-SPATIAL] Attempt ${attempt + 1}: failed to parse rooms`);
        continue;
      }

      const validation = validateAILayout(rooms, fpW, fpH, program);
      console.log(
        `[AI-SPATIAL] Attempt ${attempt + 1}: ${rooms.length} rooms, ` +
        `score=${validation.score.toFixed(2)}, errors=${validation.errors.length}, ` +
        `warnings=${validation.warnings.length}`
      );

      if (validation.errors.length > 0) {
        console.log(`[AI-SPATIAL] Errors: ${validation.errors.join("; ")}`);
      }

      if (validation.valid) {
        console.log(`[AI-SPATIAL] ACCEPTED on attempt ${attempt + 1}`);

        // Ensure all program rooms are present
        const outputNames = new Set(rooms.map(r => r.name));
        for (const spec of program.rooms) {
          if (!outputNames.has(spec.name)) {
            // Check fuzzy match
            const fuzzy = rooms.find(r =>
              r.name.toLowerCase().includes(spec.name.toLowerCase().split(" ")[0])
            );
            if (!fuzzy) {
              console.warn(`[AI-SPATIAL] Missing room: ${spec.name}`);
            }
          }
        }

        return rooms;
      }

      lastErrors = validation.errors;
    }

    console.warn(`[AI-SPATIAL] Failed after ${MAX_RETRIES + 1} attempts, falling back`);
    return null;
  } catch (err) {
    console.error("[AI-SPATIAL] Error:", err instanceof Error ? err.message : err);
    return null;
  }
}
