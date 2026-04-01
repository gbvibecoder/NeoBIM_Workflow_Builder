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
import type { EnhancedRoomProgram } from "./ai-room-programmer";
import type { PlacedRoom } from "./layout-engine";

// ── Grid snap ──────────────────────────────────────────────────────────────

const GRID = 0.1;
function grid(v: number): number {
  return Math.round(v / GRID) * GRID;
}

// ── System prompt ──────────────────────────────────────────────────────────

const SPATIAL_SYSTEM_PROMPT = `You are a senior architect at a top Indian design firm. You design floor plans that real families live in — not computer-generated grids. Given a footprint and room list, output precise coordinates for every room.

COORDINATE SYSTEM:
- Origin (0,0) = TOP-LEFT. X → right, Y → down. METERS, rounded to 0.10m.

═══ NBC 2016 HARD RULES (plan is REJECTED if any fails) ═══

Living Room:   area ≥ 9.5 m², min dim ≥ 2.4m
Dining Room:   area ≥ 9.5 m², min dim ≥ 2.4m
Kitchen:       area ≥ 5.5 m², min dim ≥ 2.1m
Bedroom:       area ≥ 9.5 m², min dim ≥ 2.7m, aspect ratio ≤ 1.8
Master Bed:    area ≥ 12.0 m², min dim ≥ 3.0m, aspect ratio ≤ 1.8
Bathroom:      area between 2.8 and 4.5 m², min dim ≥ 1.5m. Typical: 2.0m × 2.0m = 4.0 m².
Study/Office:  area ≥ 6.0 m², min dim ≥ 2.4m
Corridor:      min(width, depth) MUST be EXACTLY 1.2m. Not 0.6. Not 1.0. Always 1.2m.
Balcony:       min depth 1.2m

═══ ROOM PROPORTIONS (what makes rooms feel livable) ═══

Bedrooms should be nearly SQUARE — ideal aspect ratio 1.0 to 1.5.
  GOOD: 3.8m × 3.5m = 13.3 m² (ratio 1.09) — feels spacious
  GOOD: 4.2m × 3.2m = 13.4 m² (ratio 1.31) — comfortable
  BAD:  6.6m × 2.8m = 18.5 m² (ratio 2.36) — feels like a bowling alley, REJECTED

Living Room: ratio ≤ 1.6. Example: 5.0m × 3.5m or 4.5m × 4.0m
Kitchen: ratio ≤ 1.8. Example: 3.5m × 2.5m or 3.0m × 2.8m
Bathroom: ratio ≤ 1.5. Example: 2.0m × 2.0m or 2.2m × 1.8m

═══ SIZE PRIORITY (when space is tight) ═══

1. Bedrooms: NEVER below 9.5 m². This is rule #1.
2. Study/Utility: reduce FIRST (study 6-8 m², utility 3-5 m²)
3. Balcony: reduce to 3 m² minimum
4. Kitchen: reduce toward 7 m² (never below 5.5)
5. Bathrooms: ALWAYS between 2.8 and 4.5 m². Typical 4.0 m². NEVER 5+.

═══ ARCHITECTURAL DESIGN PRINCIPLES ═══

ADJACENCY (non-negotiable):
- Kitchen MUST share a wall with Dining Room
- Dining MUST share a wall with Living Room
- Each Bedroom MUST share a wall with its paired Bathroom
- Living, Bedrooms, Kitchen, Dining MUST touch at least one footprint edge

CIRCULATION:
- Include a corridor (1.2m wide) connecting public zone to private zone
- A person must be able to walk from the front door to every room through corridors or public rooms — never through a private bedroom

ZONING:
- PUBLIC zone (living, dining, kitchen, foyer) near the entry — grouped together
- PRIVATE zone (bedrooms, bathrooms) away from entry — grouped together
- SERVICE zone (utility, storage) can be interior, near kitchen for plumbing

WALL SHARING (critical for clean plans):
- Adjacent rooms share edges EXACTLY: if Room A ends at x=5.0, Room B starts at x=5.0
- NO gaps between rooms — every edge touches another room or the footprint boundary
- Rooms tile together filling ≥ 85% of the footprint

═══ LAYOUT DESIGN (not just boxes on a grid) ═══

DO NOT make every plan look the same. Vary the layout based on plot shape:

For WIDE plots (width ≥ 1.3 × depth):
- Public rooms along the front (entry side), corridor behind them
- Bedrooms behind corridor, bathroom tucked between bedrooms
- Creates a clear front-to-back flow

For DEEP plots (depth ≥ 1.3 × width):
- Corridor runs vertically with public rooms on one side, private on the other
- Kitchen and utility share a back wall for plumbing

For SQUARE plots:
- L-shaped corridor with public rooms in one corner, bedrooms in opposite corner
- Bathroom cluster in the center

DEPTH VARIATION — real plans have rooms at different depths:
- Not every room spans the full width of its zone
- Bathrooms are typically 2.0m deep — they don't need to be as deep as bedrooms
- This creates setbacks and niches that make the plan look designed

═══ OUTPUT FORMAT ═══

ONLY JSON, no markdown, no explanation:
{"rooms":[{"name":"Living Room","type":"living","x":0.0,"y":0.0,"width":4.5,"depth":3.8}]}

═══ EXAMPLE — "3BHK villa, 1400 sqft" (footprint 13.0m × 10.0m) ═══

{"rooms":[
  {"name":"Living Room","type":"living","x":0.0,"y":6.2,"width":5.0,"depth":3.8},
  {"name":"Dining Room","type":"dining","x":5.0,"y":6.2,"width":3.6,"depth":3.8},
  {"name":"Kitchen","type":"kitchen","x":8.6,"y":6.5,"width":3.2,"depth":2.8},
  {"name":"Foyer","type":"entrance","x":5.0,"y":9.0,"width":2.0,"depth":1.0},
  {"name":"Utility","type":"utility","x":8.6,"y":9.3,"width":2.2,"depth":0.7},
  {"name":"Corridor","type":"hallway","x":0.0,"y":5.0,"width":13.0,"depth":1.2},
  {"name":"Master Bedroom","type":"bedroom","x":0.0,"y":0.0,"width":4.2,"depth":3.8},
  {"name":"Bathroom 1","type":"bathroom","x":4.2,"y":0.0,"width":2.0,"depth":2.0},
  {"name":"Bedroom 2","type":"bedroom","x":0.0,"y":3.0,"width":3.8,"depth":2.0},
  {"name":"Bedroom 3","type":"bedroom","x":6.2,"y":0.0,"width":3.8,"depth":3.5},
  {"name":"Bathroom 2","type":"bathroom","x":3.8,"y":3.0,"width":2.0,"depth":2.0},
  {"name":"Bathroom 3","type":"bathroom","x":10.0,"y":0.0,"width":2.0,"depth":2.0},
  {"name":"Balcony","type":"balcony","x":10.0,"y":2.0,"width":3.0,"depth":1.5},
  {"name":"Study","type":"office","x":10.0,"y":3.5,"width":3.0,"depth":1.5}
]}

Note how: Kitchen (3.2×2.8) touches Dining (3.6×3.8). Bedrooms are nearly square. Bathrooms are 2.0×2.0=4.0 m². Corridor is 1.2m deep. Rooms at different depths create visual interest.

═══ SELF-CHECK (verify EVERY item before responding) ═══

□ Every bedroom area ≥ 9.5 m² AND aspect ratio ≤ 1.8?
□ Every bathroom area between 2.8 and 4.5 m²?
□ Corridor min dimension = 1.2m?
□ Kitchen shares a wall with Dining?
□ Each Bedroom shares a wall with its Bathroom?
□ No rooms overlap?
□ No gaps between adjacent rooms?
□ All rooms within footprint boundary?
□ Room areas sum ≥ 85% of footprint?

If ANY fails, fix coordinates before outputting.`;

// ── NBC lookup (name-based for reliability) ────────────────────────────────

function getNBCMin(type: string, name: string): { minArea: number; minDim: number; maxArea?: number; maxAR?: number } {
  const n = name.toLowerCase();
  if (n.includes("master") && (n.includes("bed") || type === "bedroom"))
    return { minArea: 12.0, minDim: 3.0, maxAR: 1.8 };
  if (n.includes("bed") || type === "bedroom")
    return { minArea: 9.5, minDim: 2.7, maxAR: 1.8 };
  if (n.includes("bath") || n.includes("toilet") || n.includes("wc") || type === "bathroom")
    return { minArea: 2.8, minDim: 1.5, maxArea: 4.5 };
  if (n.includes("living") || type === "living")
    return { minArea: 9.5, minDim: 2.4, maxAR: 1.8 };
  if (n.includes("dining") || type === "dining")
    return { minArea: 9.5, minDim: 2.4 };
  if (n.includes("kitchen") || type === "kitchen")
    return { minArea: 5.5, minDim: 2.1 };
  if (n.includes("study") || n.includes("office") || type === "office")
    return { minArea: 6.0, minDim: 2.4 };
  if (n.includes("corridor") || n.includes("hallway") || type === "hallway")
    return { minArea: 2.0, minDim: 1.2 };
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
    const maxNote = std.maxArea ? `, MAX ${std.maxArea} m²` : "";
    const arNote = std.maxAR ? `, AR ≤ ${std.maxAR}` : "";
    return `  ${r.name} (${r.type}): target ${r.areaSqm.toFixed(1)} m², min ${std.minArea} m² / ${std.minDim}m${maxNote}${arNote}${r.mustHaveExteriorWall ? " ★exterior" : ""}`;
  }).join("\n");

  const adjList = program.adjacency.map(a =>
    `  ${a.roomA} ↔ ${a.roomB} (${a.reason})`
  ).join("\n");

  const plotShape = fpW >= fpH * 1.3 ? "WIDE" : fpH >= fpW * 1.3 ? "DEEP" : "SQUARE";

  const vastuLine = program.isVastuRequested
    ? "\nVASTU: Kitchen→SE, Master Bedroom→SW, Pooja→NE, Living→N/E, Entrance→N or E."
    : "";

  return `Design: ${program.originalPrompt ?? program.projectName}

Footprint: ${fpW.toFixed(1)}m × ${fpH.toFixed(1)}m (${plotShape} plot, ${program.totalAreaSqm.toFixed(0)} m²)
${vastuLine}

Rooms (${program.rooms.length}):
${roomTable}

Must-share-wall pairs:
${adjList || "  (use architectural best practices)"}

Hard constraints:
• Bedrooms ≥ 9.5 m², AR ≤ 1.8, nearly square (3.8×3.5 good, 6.6×2.8 rejected)
• Bathrooms 2.8–4.5 m² only (typical 2.0×2.0 = 4.0 m²)
• Corridor width = 1.2m exactly
• Kitchen touches Dining. Each Bedroom touches its Bathroom.
• Rooms tile together — no gaps. Sum ≥ ${(fpW * fpH * 0.85).toFixed(0)} m².
• Footprint: [0,${fpW.toFixed(1)}] × [0,${fpH.toFixed(1)}]

Output JSON for all ${program.rooms.length} rooms.`;
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
  const TOL = 0.20;

  // 1. Rooms within footprint
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

  // 3. NBC areas, dimensions, max areas, and aspect ratios
  for (const r of rooms) {
    const nbc = getNBCMin(r.type, r.name);
    const area = r.width * r.depth;
    const minDim = Math.min(r.width, r.depth);
    const ratio = Math.max(r.width, r.depth) / Math.max(minDim, 0.1);

    if (area < nbc.minArea * 0.95) {
      const biggest = rooms
        .filter(rm => !rm.name.toLowerCase().includes("bed") && !rm.name.toLowerCase().includes("living") &&
                      rm.type !== "hallway" && rm.name !== r.name)
        .sort((a, b) => (b.width * b.depth) - (a.width * a.depth))[0];
      const tip = biggest ? ` Shrink ${biggest.name} (${(biggest.width * biggest.depth).toFixed(1)} m²) to make room.` : "";
      errors.push(`${r.name} area ${area.toFixed(1)} m² < min ${nbc.minArea} m².${tip}`);
    }
    if (minDim < nbc.minDim - 0.05) {
      errors.push(`${r.name} dimension ${minDim.toFixed(1)}m < ${nbc.minDim}m.`);
    }
    if (nbc.maxArea && area > nbc.maxArea + 0.2) {
      errors.push(`${r.name} area ${area.toFixed(1)} m² > max ${nbc.maxArea} m². Use ~2.0m×2.0m.`);
    }
    if (nbc.maxAR && ratio > nbc.maxAR + 0.05) {
      const side = Math.sqrt(area / 1.3);
      errors.push(`${r.name} ratio ${ratio.toFixed(1)} > ${nbc.maxAR} (${r.width.toFixed(1)}×${r.depth.toFixed(1)}m). Make squarer: ${side.toFixed(1)}×${(area / side).toFixed(1)}m.`);
    }
  }

  // 4. No bathroom > smallest bedroom
  const bedAreas = rooms
    .filter(r => r.type === "bedroom" || r.name.toLowerCase().includes("bed"))
    .map(r => r.width * r.depth);
  const minBedArea = bedAreas.length > 0 ? Math.min(...bedAreas) : 999;
  for (const r of rooms) {
    const isBath = r.type === "bathroom" || r.name.toLowerCase().includes("bath") || r.name.toLowerCase().includes("toilet");
    if (isBath && r.width * r.depth > minBedArea && bedAreas.length > 0) {
      errors.push(`${r.name} (${(r.width * r.depth).toFixed(1)} m²) > smallest bedroom (${minBedArea.toFixed(1)} m²)`);
    }
  }

  // 5. Kitchen-Dining adjacency
  const kitchen = rooms.find(r => r.type === "kitchen" || r.name.toLowerCase().includes("kitchen"));
  const dining = rooms.find(r => r.type === "dining" || r.name.toLowerCase().includes("dining"));
  if (kitchen && dining && !roomsTouch(kitchen, dining, TOL)) {
    errors.push("Kitchen and Dining do not share a wall.");
  }

  // 6. Bedroom-Bathroom adjacency
  for (const adj of program.adjacency) {
    const a = rooms.find(r => r.name === adj.roomA);
    const b = rooms.find(r => r.name === adj.roomB);
    if (!a || !b) continue;
    const nA = adj.roomA.toLowerCase(), nB = adj.roomB.toLowerCase();
    const isBedBath = ((nA.includes("bed") || nA.includes("master")) && (nB.includes("bath") || nB.includes("toilet"))) ||
                      ((nB.includes("bed") || nB.includes("master")) && (nA.includes("bath") || nA.includes("toilet")));
    if (isBedBath && !roomsTouch(a, b, TOL)) {
      errors.push(`${adj.roomA} ↔ ${adj.roomB} must share a wall.`);
    }
  }

  // 7. Corridor width (HARD — 1.2m)
  for (const r of rooms) {
    const isCorridor = r.type === "hallway" || r.name.toLowerCase().includes("corr") ||
                       r.name.toLowerCase().includes("passage") || r.name.toLowerCase().includes("hallway");
    if (isCorridor && Math.min(r.width, r.depth) < 1.15) {
      errors.push(`Corridor "${r.name}" is ${Math.min(r.width, r.depth).toFixed(1)}m wide — must be ≥ 1.2m.`);
    }
  }

  // 8. Exterior wall (soft)
  for (const spec of program.rooms) {
    if (!spec.mustHaveExteriorWall) continue;
    const r = rooms.find(rm => rm.name === spec.name);
    if (!r) continue;
    const onEdge = r.x < TOL || r.y < TOL ||
      Math.abs(r.x + r.width - fpW) < TOL || Math.abs(r.y + r.depth - fpH) < TOL;
    if (!onEdge) warnings.push(`${r.name} not on exterior edge`);
  }

  // 9. Coverage
  const totalArea = rooms.reduce((s, r) => s + r.width * r.depth, 0);
  if (totalArea / (fpW * fpH) < 0.75) {
    warnings.push(`Coverage ${((totalArea / (fpW * fpH)) * 100).toFixed(0)}% < 85%`);
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
 * Aggressive gap-closing pass for GPT-4o output.
 *
 * GPT-4o leaves gaps of 0.1m to 2.0m+ between rooms. This pass:
 * 1. Snaps nearby edges between all room pairs (up to 2.0m gap)
 * 2. Expands rooms to touch footprint edges (up to 2.0m)
 * 3. Runs 4 passes for chain propagation
 * 4. Expands rooms toward nearest neighbor to fill remaining gaps
 */
function closeGaps(rooms: PlacedRoom[], fpW: number, fpH: number): PlacedRoom[] {
  const result = rooms.map(r => ({ ...r }));
  const GAP_TOL = 2.0; // GPT-4o can leave gaps up to 2m

  // Pass 1-3: Snap nearby edges between room pairs
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i], b = result[j];

        const vOverlap = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
        if (vOverlap > 0.2) {
          // A right → B left
          const gapR = b.x - (a.x + a.width);
          if (gapR > 0.01 && gapR < GAP_TOL) {
            const mid = grid((a.x + a.width + b.x) / 2);
            a.width = grid(mid - a.x);
            b.width = grid(b.x + b.width - mid);
            b.x = mid;
          }
          // B right → A left
          const gapL = a.x - (b.x + b.width);
          if (gapL > 0.01 && gapL < GAP_TOL) {
            const mid = grid((b.x + b.width + a.x) / 2);
            b.width = grid(mid - b.x);
            a.width = grid(a.x + a.width - mid);
            a.x = mid;
          }
        }

        const hOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        if (hOverlap > 0.2) {
          // A bottom → B top
          const gapB = b.y - (a.y + a.depth);
          if (gapB > 0.01 && gapB < GAP_TOL) {
            const mid = grid((a.y + a.depth + b.y) / 2);
            a.depth = grid(mid - a.y);
            b.depth = grid(b.y + b.depth - mid);
            b.y = mid;
          }
          // B bottom → A top
          const gapT = a.y - (b.y + b.depth);
          if (gapT > 0.01 && gapT < GAP_TOL) {
            const mid = grid((b.y + b.depth + a.y) / 2);
            b.depth = grid(mid - b.y);
            a.depth = grid(a.y + a.depth - mid);
            a.y = mid;
          }
        }

        // Also snap aligned edges (e.g., two rooms whose tops differ by <0.5m)
        if (hOverlap > 0.5) {
          if (Math.abs(a.y - b.y) > 0 && Math.abs(a.y - b.y) < 0.5) {
            const avg = grid(Math.min(a.y, b.y));
            const diff = Math.max(a.y, b.y) - avg;
            if (a.y > b.y) { a.depth = grid(a.depth + diff); a.y = avg; }
            else { b.depth = grid(b.depth + diff); b.y = avg; }
          }
          if (Math.abs((a.y + a.depth) - (b.y + b.depth)) > 0 && Math.abs((a.y + a.depth) - (b.y + b.depth)) < 0.5) {
            const maxBottom = grid(Math.max(a.y + a.depth, b.y + b.depth));
            if (a.y + a.depth < maxBottom) a.depth = grid(maxBottom - a.y);
            else b.depth = grid(maxBottom - b.y);
          }
        }
        if (vOverlap > 0.5) {
          if (Math.abs(a.x - b.x) > 0 && Math.abs(a.x - b.x) < 0.5) {
            const avg = grid(Math.min(a.x, b.x));
            const diff = Math.max(a.x, b.x) - avg;
            if (a.x > b.x) { a.width = grid(a.width + diff); a.x = avg; }
            else { b.width = grid(b.width + diff); b.x = avg; }
          }
          if (Math.abs((a.x + a.width) - (b.x + b.width)) > 0 && Math.abs((a.x + a.width) - (b.x + b.width)) < 0.5) {
            const maxRight = grid(Math.max(a.x + a.width, b.x + b.width));
            if (a.x + a.width < maxRight) a.width = grid(maxRight - a.x);
            else b.width = grid(maxRight - b.x);
          }
        }
      }
    }
  }

  // Pass 4: Expand rooms to footprint edges
  for (const r of result) {
    if (r.x > 0 && r.x < GAP_TOL) { r.width = grid(r.width + r.x); r.x = 0; }
    if (r.y > 0 && r.y < GAP_TOL) { r.depth = grid(r.depth + r.y); r.y = 0; }
    const rGap = fpW - (r.x + r.width);
    if (rGap > 0.01 && rGap < GAP_TOL) r.width = grid(fpW - r.x);
    const bGap = fpH - (r.y + r.depth);
    if (bGap > 0.01 && bGap < GAP_TOL) r.depth = grid(fpH - r.y);
  }

  // Pass 5: Expand each room toward its nearest neighbor to fill remaining gaps
  // Only expand in directions where there's empty space (no other room)
  for (const r of result) {
    // Try expanding right
    const rightEdge = r.x + r.width;
    if (rightEdge < fpW - 0.1) {
      // Find nearest room to the right that overlaps vertically
      let nearestRight = fpW;
      for (const other of result) {
        if (other === r) continue;
        const vOvl = Math.min(r.y + r.depth, other.y + other.depth) - Math.max(r.y, other.y);
        if (vOvl > 0.2 && other.x > rightEdge - 0.1 && other.x < nearestRight) {
          nearestRight = other.x;
        }
      }
      if (nearestRight > rightEdge + 0.05 && nearestRight - rightEdge < 1.5) {
        r.width = grid(nearestRight - r.x);
      }
    }
    // Try expanding down
    const bottomEdge = r.y + r.depth;
    if (bottomEdge < fpH - 0.1) {
      let nearestDown = fpH;
      for (const other of result) {
        if (other === r) continue;
        const hOvl = Math.min(r.x + r.width, other.x + other.width) - Math.max(r.x, other.x);
        if (hOvl > 0.2 && other.y > bottomEdge - 0.1 && other.y < nearestDown) {
          nearestDown = other.y;
        }
      }
      if (nearestDown > bottomEdge + 0.05 && nearestDown - bottomEdge < 1.5) {
        r.depth = grid(nearestDown - r.y);
      }
    }
  }

  // Recompute areas
  for (const r of result) r.area = grid(r.width * r.depth);

  // Log coverage
  const totalArea = result.reduce((s, r) => s + r.width * r.depth, 0);
  const coverage = totalArea / (fpW * fpH) * 100;
  console.log(`[GAP-CLOSE] Coverage: ${coverage.toFixed(0)}% (${totalArea.toFixed(1)}/${(fpW * fpH).toFixed(1)} m²)`);

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
        width: w, depth: d,
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

      const retryFeedback = attempt > 0
        ? `\n\n⚠️ YOUR PREVIOUS LAYOUT WAS REJECTED. Fix ALL errors:\n${lastErrors.map((e, i) => `${i + 1}. ${e}`).join("\n")}\n\nRemember: bedrooms must be SQUARE (ratio ≤1.8), bathrooms 2.8-4.5 m², corridor exactly 1.2m wide.`
        : "";

      const completion = await client.chat.completions.create({
        model: "gpt-4o",
        temperature: attempt === 0 ? 0.4 : 0.2,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SPATIAL_SYSTEM_PROMPT },
          { role: "user", content: userMessage + retryFeedback },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) { console.warn(`[AI-SPATIAL] Attempt ${attempt + 1}: empty`); continue; }

      const rooms = parseAIResponse(content);
      if (!rooms || rooms.length === 0) { console.warn(`[AI-SPATIAL] Attempt ${attempt + 1}: parse fail`); continue; }

      const gapClosed = closeGaps(rooms, fpW, fpH);
      const v = validateAILayout(gapClosed, fpW, fpH, program);

      console.log(`[AI-SPATIAL] Attempt ${attempt + 1}: ${gapClosed.length} rooms, score=${v.score.toFixed(2)}, errors=${v.errors.length}, warnings=${v.warnings.length}`);
      if (v.errors.length > 0) console.log(`[AI-SPATIAL] Errors: ${v.errors.join("; ")}`);

      if (v.valid) {
        console.log(`[AI-SPATIAL] ACCEPTED on attempt ${attempt + 1}`);
        return gapClosed;
      }

      lastErrors = v.errors;
    }

    console.warn("[AI-SPATIAL] Failed after retries");
    return null;
  } catch (err) {
    console.error("[AI-SPATIAL] Error:", err instanceof Error ? err.message : err);
    return null;
  }
}
