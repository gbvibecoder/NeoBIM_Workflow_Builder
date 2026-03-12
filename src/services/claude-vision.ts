/**
 * Claude Vision — SVG-Based Floor Plan Analysis
 *
 * APPROACH: Claude generates an SVG replica of the floor plan.
 * SVG handles ANY shape: rectangles, triangles, curves, L-shapes, irregular.
 * The SVG coordinates ARE the room geometry — no error-prone coordinate extraction.
 *
 * Flow: Image → Claude generates SVG → Code parses SVG paths → Room polygons + walls
 */

import Anthropic from "@anthropic-ai/sdk";
import type { FloorPlanRoomType } from "@/types/floor-plan";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClaudeFloorPlanRoom {
  name: string;
  type: FloorPlanRoomType;
  width: number;
  depth: number;
  x: number;
  y: number;
  adjacentRooms?: string[];
  /** Polygon vertices in meters [[x,y], ...] — from SVG parsing */
  polygon?: [number, number][];
  /** Area in m² — computed from polygon */
  area?: number;
}

export interface ClaudeFloorPlanResult {
  buildingWidth: number;
  buildingDepth: number;
  buildingShape: string;
  rooms: ClaudeFloorPlanRoom[];
  rows: Array<Array<{
    name: string;
    type: string;
    width: number;
    depth: number;
    adjacentRooms?: string[];
  }>>;
  buildingOutline?: [number, number][];
  /** Wall segments extracted from SVG */
  walls?: Array<{ start: [number, number]; end: [number, number]; thickness: number; type: "exterior" | "interior" }>;
  /** Raw SVG content for debugging */
  svgContent?: string;
}

const VALID_TYPES: FloorPlanRoomType[] = [
  "living", "bedroom", "kitchen", "dining", "bathroom", "hallway",
  "veranda", "balcony", "entrance", "passage", "utility", "storage",
  "closet", "office", "patio", "staircase", "studio", "other",
];

function safeType(t: string): FloorPlanRoomType {
  const lower = t.toLowerCase().trim();
  return VALID_TYPES.includes(lower as FloorPlanRoomType) ? (lower as FloorPlanRoomType) : "other";
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function analyzeFloorPlanWithClaude(
  imageBase64: string,
  mimeType: string = "image/jpeg"
): Promise<ClaudeFloorPlanResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  // OAuth tokens (sk-ant-oat01-*) use Bearer auth, standard API keys use x-api-key
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  const client = isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: null })
    : new Anthropic({ apiKey });
  console.log(`[Claude Vision] Auth mode: ${isOAuth ? "OAuth Bearer" : "API key"}`);
  const mediaType = normalizeMediaType(mimeType);

  console.log("[Claude Vision] Analyzing floor plan (SVG approach)...");

  // ═══════════════════════════════════════════
  // Claude generates SVG replica of the floor plan
  // ═══════════════════════════════════════════

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 8000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
        {
          type: "text",
          text: `Look at this floor plan image. Recreate it as an SVG drawing.

The SVG must be a FAITHFUL reproduction of the floor plan layout.
Use a coordinate system where 1 unit = 1 meter.

Read dimension labels from the image to determine exact sizes.
If imperial (feet/inches), convert to meters.
If no dimensions, estimate from typical room sizes.

SVG STRUCTURE:

1. Set viewBox to match building dimensions: viewBox="0 0 {widthMeters} {depthMeters}"

2. BUILDING OUTLINE: A single <polygon> or <path> with:
   - id="building-outline"
   - class="outline"
   - For rectangular buildings: simple polygon
   - For triangular: 3-point polygon
   - For curved walls: use <path> with C (cubic bezier) or A (arc) commands
   - For irregular: polygon with as many vertices as needed

3. ROOM FILLS: For each room, a <polygon> or <path> or <rect> with:
   - id="room-{index}" (e.g., "room-0", "room-1")
   - class="room"
   - data-name="{room label from image}" (e.g., "Living Room")
   - data-type="{type}" (living|dining|kitchen|bedroom|bathroom|balcony|hallway|entrance|veranda|staircase|utility|storage|closet|office|passage|studio|patio|other)
   - fill with a color based on room type:
     living/dining: #D4A574
     kitchen: #E8E0D8
     bedroom: #C4956A
     bathroom: #B8C8D8
     balcony/veranda: #8B9F7B
     hallway/passage: #C5C0B8
     other: #CCBBAA
   - Room polygons should tile together — no gaps between rooms

4. WALLS: For each wall, a <line> with:
   - class="wall exterior" or class="wall interior"
   - stroke="#333333"
   - stroke-width appropriate for wall thickness (0.2 for exterior, 0.12 for interior)
   - x1, y1, x2, y2 coordinates in meters

5. ROOM LABELS: For each room, a <text> with:
   - class="label"
   - Positioned at room center
   - Contains room name

RULES:
- Coordinates in METERS (1 SVG unit = 1 meter)
- Y axis: 0 at top, increases downward (standard SVG)
- Room polygons must EXACTLY fill the building outline — no gaps
- For curved walls: use SVG arc (A) or bezier (C/Q) commands in <path>
- For diagonal walls: straight lines at any angle
- Include ALL rooms visible in the image
- Room edges must align — shared walls mean shared edge coordinates

OUTPUT ONLY THE SVG CODE. No explanation. No markdown. Start with <svg and end with </svg>.`,
        },
      ],
    }],
  });

  const text = extractText(response);
  console.log(`[Claude Vision] SVG response: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`);

  // Clean up SVG
  let svgContent = text;
  if (svgContent.includes("```")) {
    svgContent = svgContent.replace(/^```[a-z]*\n?/gi, "").replace(/\s*```\s*$/gi, "").trim();
  }
  const svgStart = svgContent.indexOf("<svg");
  if (svgStart > 0) svgContent = svgContent.substring(svgStart);
  const svgEnd = svgContent.lastIndexOf("</svg>");
  if (svgEnd > 0) svgContent = svgContent.substring(0, svgEnd + 6);

  if (!svgContent.startsWith("<svg")) {
    throw new Error("Claude did not return valid SVG");
  }

  console.log(`[Claude Vision] SVG size: ${svgContent.length} chars`);

  // ═══════════════════════════════════════════
  // DEBUG: Save SVG to public folder + log
  // ═══════════════════════════════════════════
  try {
    const fs = await import('fs');
    const path = await import('path');
    const debugPath = path.join(process.cwd(), 'public', 'debug-floor-plan.svg');
    fs.writeFileSync(debugPath, svgContent, 'utf-8');
    console.log(`[DEBUG] SVG saved to ${debugPath} (${svgContent.length} chars)`);
  } catch (e) {
    console.log('[DEBUG] Could not save SVG file:', e);
  }
  console.log('=== RAW SVG FROM CLAUDE ===');
  console.log(svgContent.substring(0, 2000));
  console.log(svgContent.length > 2000 ? `... (${svgContent.length - 2000} more chars)` : '');
  console.log('=== END SVG ===');

  // ═══════════════════════════════════════════
  // Parse SVG to extract geometry
  // ═══════════════════════════════════════════

  const result = parseSVGtoFloorPlan(svgContent);
  result.svgContent = svgContent;

  console.log('=== PARSED RESULT ===');
  console.log('Rooms:', result.rooms.length);
  for (const room of result.rooms) {
    console.log(`  ${room.name} (${room.type}): ${room.width}x${room.depth}m at (${room.x},${room.y}) polygon:${room.polygon?.length || 0}pts area=${room.area}m²`);
  }
  console.log('Walls:', result.walls?.length ?? 0);
  console.log('Building:', result.buildingWidth, 'x', result.buildingDepth);
  console.log('Building shape:', result.buildingShape);
  console.log('=== END PARSED ===');

  if (result.rooms.length < 1) {
    throw new Error(`SVG parsing found 0 rooms — Claude SVG may be malformed`);
  }

  console.log(`[Claude Vision] SVG parsed: ${result.rooms.length} rooms, ${result.walls?.length ?? 0} walls, ${result.buildingShape} ${result.buildingWidth.toFixed(1)}×${result.buildingDepth.toFixed(1)}m`);
  for (const rm of result.rooms) {
    console.log(`  ${rm.name} (${rm.type}): ${rm.width.toFixed(1)}×${rm.depth.toFixed(1)}m at (${rm.x.toFixed(1)},${rm.y.toFixed(1)}) ${rm.polygon ? `polygon:${rm.polygon.length}pts` : "rect"} area=${(rm.area ?? 0).toFixed(1)}m²`);
  }

  return result;
}

// ─── SVG → FloorPlanResult ──────────────────────────────────────────────────

export function parseSVGtoFloorPlan(svgContent: string): ClaudeFloorPlanResult {
  let buildingWidth = 10;
  let buildingDepth = 8;

  // Extract viewBox dimensions
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/[\s,]+/).map(Number);
    if (parts.length >= 4) {
      buildingWidth = parts[2] || 10;
      buildingDepth = parts[3] || 8;
    }
  }

  // Extract building outline
  let buildingOutline: [number, number][] = [];
  // Try id before points/d and vice versa
  const outlineMatch = svgContent.match(/id="building-outline"[^>]*(?:points="([^"]+)"|d="([^"]+)")/)
    || svgContent.match(/(?:points="([^"]+)"|d="([^"]+)")[^>]*id="building-outline"/)
    || svgContent.match(/class="outline"[^>]*(?:points="([^"]+)"|d="([^"]+)")/);

  if (outlineMatch) {
    const pts = parsePoints(outlineMatch[1] || "");
    const pathPts = parsePath(outlineMatch[2] || "");
    buildingOutline = pts.length >= 3 ? pts : pathPts;
  }

  if (buildingOutline.length < 3) {
    buildingOutline = [[0, 0], [buildingWidth, 0], [buildingWidth, buildingDepth], [0, buildingDepth]];
  }

  // Extract rooms
  const rooms: ClaudeFloorPlanRoom[] = [];
  // Strategy: find all elements with class="room" OR data-name attribute
  const elementRegex = /<(?:polygon|path|rect)\s[^>]*?(?:class="[^"]*room[^"]*"|data-name=")[^>]*?(?:\/?>[^<]*?<\/(?:polygon|path|rect)>|\/>)/gi;
  let match;

  console.log('=== ROOM REGEX MATCHING (primary) ===');
  while ((match = elementRegex.exec(svgContent)) !== null) {
    const el = match[0];
    console.log(`  MATCHED element (${el.length} chars): ${el.substring(0, 200)}...`);
    const room = parseRoomElement(el, rooms.length);
    if (room) {
      console.log(`    → Room: "${room.name}" (${room.type}) polygon:${room.polygon?.length || 0}pts area:${room.area}`);
      rooms.push(room);
    } else {
      console.log(`    → REJECTED (polygon < 3 points)`);
    }
  }
  console.log(`=== Primary regex found ${rooms.length} rooms ===`);

  // Fallback: if no rooms found, try matching by id="room-*"
  if (rooms.length === 0) {
    console.log('=== ROOM REGEX MATCHING (fallback: id="room-*") ===');
    const idRegex = /<(?:polygon|path|rect)\s[^>]*?id="room-\d+"[^>]*?(?:\/?>[^<]*?<\/(?:polygon|path|rect)>|\/>)/gi;
    while ((match = idRegex.exec(svgContent)) !== null) {
      const el = match[0];
      console.log(`  MATCHED element: ${el.substring(0, 200)}...`);
      const room = parseRoomElement(el, rooms.length);
      if (room) rooms.push(room);
    }
    console.log(`=== Fallback found ${rooms.length} rooms ===`);
  }

  // Filter out tiny rooms (< 0.5 m², likely SVG artifacts)
  const preFilterCount = rooms.length;
  for (let i = rooms.length - 1; i >= 0; i--) {
    if ((rooms[i].area ?? 0) < 0.5) {
      console.log(`[DEBUG] Removing tiny room: "${rooms[i].name}" area=${rooms[i].area}m²`);
      rooms.splice(i, 1);
    }
  }

  // Deduplicate rooms by name (keep first occurrence — largest area wins if same name)
  const seenNames = new Set<string>();
  for (let i = rooms.length - 1; i >= 0; i--) {
    const key = rooms[i].name.toLowerCase();
    if (seenNames.has(key)) {
      console.log(`[DEBUG] Removing duplicate room: "${rooms[i].name}"`);
      rooms.splice(i, 1);
    } else {
      seenNames.add(key);
    }
  }

  if (preFilterCount !== rooms.length) {
    console.log(`[DEBUG] Rooms: ${preFilterCount} → ${rooms.length} after filtering`);
  }

  // Extract walls
  const walls: Array<{ start: [number, number]; end: [number, number]; thickness: number; type: "exterior" | "interior" }> = [];
  const wallRegex = /<line\s[^>]*class="wall[^"]*"[^>]*\/?>/gi;
  while ((match = wallRegex.exec(svgContent)) !== null) {
    const el = match[0];
    const x1 = parseFloat(extractAttr(el, "x1") || "");
    const y1 = parseFloat(extractAttr(el, "y1") || "");
    const x2 = parseFloat(extractAttr(el, "x2") || "");
    const y2 = parseFloat(extractAttr(el, "y2") || "");

    // Skip walls with NaN/undefined coordinates
    if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
      console.log('[DEBUG] Skipping invalid wall line:', el.substring(0, 120));
      continue;
    }

    const isExterior = el.includes("exterior");
    const sw = parseFloat(extractAttr(el, "stroke-width") || "0.15");

    if (Math.abs(x2 - x1) > 0.01 || Math.abs(y2 - y1) > 0.01) {
      walls.push({ start: [x1, y1], end: [x2, y2], thickness: sw, type: isExterior ? "exterior" : "interior" });
    }
  }

  // If no walls from <line>, also try <rect> walls
  if (walls.length === 0) {
    const rectWallRegex = /<rect\s[^>]*class="wall[^"]*"[^>]*\/?>/gi;
    while ((match = rectWallRegex.exec(svgContent)) !== null) {
      const el = match[0];
      const rx = parseFloat(extractAttr(el, "x") || "0");
      const ry = parseFloat(extractAttr(el, "y") || "0");
      const rw = parseFloat(extractAttr(el, "width") || "0");
      const rh = parseFloat(extractAttr(el, "height") || "0");
      const isExterior = el.includes("exterior");
      if (rw > 0 && rh > 0) {
        if (rw > rh) {
          // Horizontal wall
          walls.push({ start: [rx, ry + rh / 2], end: [rx + rw, ry + rh / 2], thickness: rh, type: isExterior ? "exterior" : "interior" });
        } else {
          // Vertical wall
          walls.push({ start: [rx + rw / 2, ry], end: [rx + rw / 2, ry + rh], thickness: rw, type: isExterior ? "exterior" : "interior" });
        }
      }
    }
  }

  // If still no walls, generate from building outline + shared room edges
  if (walls.length === 0) {
    for (let i = 0; i < buildingOutline.length; i++) {
      const p1 = buildingOutline[i];
      const p2 = buildingOutline[(i + 1) % buildingOutline.length];
      walls.push({ start: p1, end: p2, thickness: 0.2, type: "exterior" });
    }
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        if (!rooms[i].polygon || !rooms[j].polygon) continue;
        const shared = findSharedEdges(rooms[i].polygon!, rooms[j].polygon!);
        for (const edge of shared) {
          walls.push({ start: edge[0], end: edge[1], thickness: 0.12, type: "interior" });
        }
      }
    }
  }

  // Auto-detect adjacency from shared edges
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      let isAdjacent = false;
      if (a.polygon && b.polygon) {
        isAdjacent = findSharedEdges(a.polygon, b.polygon).length > 0;
      } else {
        // Bounding box proximity check
        const aR = a.x + a.width, aB = a.y + a.depth;
        const bR = b.x + b.width, bB = b.y + b.depth;
        const vOverlap = Math.min(aB, bB) - Math.max(a.y, b.y);
        const hGap = Math.min(Math.abs(aR - b.x), Math.abs(bR - a.x));
        const hOverlap = Math.min(aR, bR) - Math.max(a.x, b.x);
        const vGap = Math.min(Math.abs(aB - b.y), Math.abs(bB - a.y));
        isAdjacent = (vOverlap > 0.3 && hGap < 1.0) || (hOverlap > 0.3 && vGap < 1.0);
      }
      if (isAdjacent) {
        a.adjacentRooms = a.adjacentRooms ?? [];
        b.adjacentRooms = b.adjacentRooms ?? [];
        if (!a.adjacentRooms.includes(b.name)) a.adjacentRooms.push(b.name);
        if (!b.adjacentRooms.includes(a.name)) b.adjacentRooms.push(a.name);
      }
    }
  }

  // Determine building shape
  let buildingShape = "rectangular";
  if (buildingOutline.length === 3) buildingShape = "triangular";
  else if (buildingOutline.length > 4) buildingShape = "irregular";
  else if (buildingOutline.length === 4) {
    buildingShape = checkRectangular(buildingOutline) ? "rectangular" : "angled";
  }

  // Sort rooms by position
  rooms.sort((a, b) => a.y - b.y || a.x - b.x);

  return {
    buildingWidth: round(buildingWidth),
    buildingDepth: round(buildingDepth),
    buildingShape,
    rooms,
    rows: [], // SVG approach doesn't use row-based layout — GN-011 falls through to x,y rooms
    buildingOutline,
    walls,
  };
}

// ─── Parse a single room element ────────────────────────────────────────────

function parseRoomElement(el: string, index: number): ClaudeFloorPlanRoom | null {
  const name = extractAttr(el, "data-name") || `Room ${index + 1}`;
  const type = safeType(extractAttr(el, "data-type") || "other");

  let polygon: [number, number][] = [];

  // Try polygon points
  const ptsAttr = extractAttr(el, "points");
  if (ptsAttr) polygon = parsePoints(ptsAttr);

  // Try path d
  if (polygon.length === 0) {
    const dAttr = extractAttr(el, "d");
    if (dAttr) polygon = parsePath(dAttr);
  }

  // Try rect
  if (polygon.length === 0) {
    const rx = parseFloat(extractAttr(el, "x") || "0");
    const ry = parseFloat(extractAttr(el, "y") || "0");
    const rw = parseFloat(extractAttr(el, "width") || "0");
    const rh = parseFloat(extractAttr(el, "height") || "0");
    if (rw > 0 && rh > 0) {
      polygon = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]];
    }
  }

  if (polygon.length < 3) return null;

  // Compute bounding box → x, y, width, depth
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of polygon) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  const center = calculateCentroid(polygon);
  const area = calculateArea(polygon);

  return {
    name,
    type,
    width: round(Math.max(0.5, maxX - minX)),
    depth: round(Math.max(0.5, maxY - minY)),
    x: round(minX),
    y: round(minY),
    adjacentRooms: [],
    polygon,
    area: round(area),
  };
}

// ─── SVG Parsing Helpers ────────────────────────────────────────────────────

function extractAttr(element: string, attr: string): string {
  const match = element.match(new RegExp(`${attr}="([^"]*)"`, "i"));
  return match ? match[1] : "";
}

function parsePoints(pointsStr: string): [number, number][] {
  if (!pointsStr) return [];
  const points: [number, number][] = [];
  const pairs = pointsStr.trim().split(/\s+/);
  for (const pair of pairs) {
    const [x, y] = pair.split(",").map(Number);
    if (!isNaN(x) && !isNaN(y)) points.push([x, y]);
  }
  return points;
}

function parsePath(d: string): [number, number][] {
  if (!d) return [];
  const points: [number, number][] = [];
  const commands = d.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/g);
  if (!commands) return [];

  let cx = 0, cy = 0;
  let startX = 0, startY = 0;

  for (const cmd of commands) {
    const type = cmd[0];
    const nums = cmd.slice(1).trim().match(/-?[\d.]+/g)?.map(Number) || [];

    switch (type) {
      case "M":
        for (let i = 0; i < nums.length; i += 2) {
          cx = nums[i]; cy = nums[i + 1];
          if (i === 0) { startX = cx; startY = cy; }
          points.push([cx, cy]);
        }
        break;
      case "m":
        for (let i = 0; i < nums.length; i += 2) {
          cx += nums[i]; cy += nums[i + 1];
          if (i === 0 && points.length === 0) { startX = cx; startY = cy; }
          points.push([cx, cy]);
        }
        break;
      case "L":
        for (let i = 0; i < nums.length; i += 2) {
          cx = nums[i]; cy = nums[i + 1];
          points.push([cx, cy]);
        }
        break;
      case "l":
        for (let i = 0; i < nums.length; i += 2) {
          cx += nums[i]; cy += nums[i + 1];
          points.push([cx, cy]);
        }
        break;
      case "H": cx = nums[0]; points.push([cx, cy]); break;
      case "h": cx += nums[0]; points.push([cx, cy]); break;
      case "V": cy = nums[0]; points.push([cx, cy]); break;
      case "v": cy += nums[0]; points.push([cx, cy]); break;
      case "C":
        for (let i = 0; i < nums.length; i += 6) {
          const x0 = cx, y0 = cy;
          const cx1 = nums[i], cy1 = nums[i + 1];
          const cx2 = nums[i + 2], cy2 = nums[i + 3];
          const x2 = nums[i + 4], y2 = nums[i + 5];
          for (let t = 0.25; t <= 1; t += 0.25) {
            const mt = 1 - t;
            points.push([
              mt * mt * mt * x0 + 3 * mt * mt * t * cx1 + 3 * mt * t * t * cx2 + t * t * t * x2,
              mt * mt * mt * y0 + 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t * t * t * y2,
            ]);
          }
          cx = x2; cy = y2;
        }
        break;
      case "c":
        for (let i = 0; i < nums.length; i += 6) {
          const x0 = cx, y0 = cy;
          const dcx1 = cx + nums[i], dcy1 = cy + nums[i + 1];
          const dcx2 = cx + nums[i + 2], dcy2 = cy + nums[i + 3];
          const dx2 = cx + nums[i + 4], dy2 = cy + nums[i + 5];
          for (let t = 0.25; t <= 1; t += 0.25) {
            const mt = 1 - t;
            points.push([
              mt * mt * mt * x0 + 3 * mt * mt * t * dcx1 + 3 * mt * t * t * dcx2 + t * t * t * dx2,
              mt * mt * mt * y0 + 3 * mt * mt * t * dcy1 + 3 * mt * t * t * dcy2 + t * t * t * dy2,
            ]);
          }
          cx = dx2; cy = dy2;
        }
        break;
      case "Q":
        for (let i = 0; i < nums.length; i += 4) {
          const x0 = cx, y0 = cy;
          const cpx = nums[i], cpy = nums[i + 1];
          const x2 = nums[i + 2], y2 = nums[i + 3];
          for (let t = 0.33; t <= 1; t += 0.33) {
            const mt = 1 - t;
            points.push([mt * mt * x0 + 2 * mt * t * cpx + t * t * x2, mt * mt * y0 + 2 * mt * t * cpy + t * t * y2]);
          }
          cx = x2; cy = y2;
        }
        break;
      case "q":
        for (let i = 0; i < nums.length; i += 4) {
          const x0 = cx, y0 = cy;
          const cpx = cx + nums[i], cpy = cy + nums[i + 1];
          const x2 = cx + nums[i + 2], y2 = cy + nums[i + 3];
          for (let t = 0.33; t <= 1; t += 0.33) {
            const mt = 1 - t;
            points.push([mt * mt * x0 + 2 * mt * t * cpx + t * t * x2, mt * mt * y0 + 2 * mt * t * cpy + t * t * y2]);
          }
          cx = x2; cy = y2;
        }
        break;
      case "A":
        for (let i = 0; i < nums.length; i += 7) {
          const endX = nums[i + 5], endY = nums[i + 6];
          points.push([(cx + endX) / 2, (cy + endY) / 2]);
          points.push([endX, endY]);
          cx = endX; cy = endY;
        }
        break;
      case "a":
        for (let i = 0; i < nums.length; i += 7) {
          const endX = cx + nums[i + 5], endY = cy + nums[i + 6];
          points.push([(cx + endX) / 2, (cy + endY) / 2]);
          points.push([endX, endY]);
          cx = endX; cy = endY;
        }
        break;
      case "Z":
      case "z":
        cx = startX; cy = startY;
        break;
    }
  }

  return points;
}

function calculateCentroid(points: [number, number][]): [number, number] {
  let sx = 0, sy = 0;
  for (const [x, y] of points) { sx += x; sy += y; }
  return [sx / points.length, sy / points.length];
}

function calculateArea(points: [number, number][]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function findSharedEdges(
  pathA: [number, number][],
  pathB: [number, number][]
): [[number, number], [number, number]][] {
  const edges: [[number, number], [number, number]][] = [];
  const tolerance = 0.3;

  for (let i = 0; i < pathA.length; i++) {
    const a1 = pathA[i];
    const a2 = pathA[(i + 1) % pathA.length];
    for (let j = 0; j < pathB.length; j++) {
      const b1 = pathB[j];
      const b2 = pathB[(j + 1) % pathB.length];
      const d1 = dist(a1, b1), d2 = dist(a2, b2);
      const d3 = dist(a1, b2), d4 = dist(a2, b1);
      if ((d1 < tolerance && d2 < tolerance) || (d3 < tolerance && d4 < tolerance)) {
        edges.push([a1, a2]);
      }
    }
  }
  return edges;
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

function checkRectangular(points: [number, number][]): boolean {
  if (points.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % 4];
    const p3 = points[(i + 2) % 4];
    const dx1 = p2[0] - p1[0], dy1 = p2[1] - p1[1];
    const dx2 = p3[0] - p2[0], dy2 = p3[1] - p2[1];
    const dot = dx1 * dx2 + dy1 * dy2;
    if (Math.abs(dot) > 0.5) return false;
  }
  return true;
}

// ─── Shared Helpers ─────────────────────────────────────────────────────────

function normalizeMediaType(mime: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const map: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
    "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg",
    "image/png": "image/png", "image/webp": "image/webp", "image/gif": "image/gif",
  };
  return map[mime.toLowerCase()] ?? "image/jpeg";
}

function extractText(response: Anthropic.Message): string {
  const block = response.content.find(b => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Claude returned no text response");
  return block.text.trim();
}

function round(n: number): number { return Math.round(n * 100) / 100; }
