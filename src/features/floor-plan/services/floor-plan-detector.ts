/**
 * Floor Plan Pixel Detector
 *
 * Uses sharp to analyze floor plan images at the pixel level:
 *   grayscale → threshold → wall segments → flood fill rooms → door gaps → meter conversion
 *
 * Called by TR-004 BEFORE GPT-4o to get precise geometry.
 * GPT-4o then only labels the detected rooms (names, types).
 */

import type {
  FloorPlanGeometry,
  FloorPlanWall,
  FloorPlanDoor,
  FloorPlanRoom,
  FloorPlanRoomType,
} from "@/features/floor-plan/types/floor-plan";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DetectionResult {
  geometry: FloorPlanGeometry;
  confidence: number;       // 0-1
  pixelScale: number;       // meters per pixel
  rawWallSegments: number;
  rawRoomRegions: number;
}

export interface DetectionConfig {
  thresholdValue?: number;              // 0-255, default 128
  minWallLengthPx?: number;             // minimum wall segment in px, default 30
  minRoomAreaPx?: number;               // minimum room area in px², default 500
  estimatedFootprintMeters?: { width: number; depth: number };
  wallThicknessPx?: number;             // expected wall thickness in px, default 6
}

interface Segment {
  x1: number; y1: number;
  x2: number; y2: number;
  horizontal: boolean;
}

interface Region {
  minX: number; minY: number;
  maxX: number; maxY: number;
  area: number;
  cx: number; cy: number;
}

// ─── Main ──────────────────────────────────────────────────────────────────

export async function detectFloorPlanGeometry(
  imageBase64: string,
  mimeType: string,
  config?: DetectionConfig,
): Promise<DetectionResult> {
  const sharp = (await import("sharp")).default;
  const imgBuffer = Buffer.from(imageBase64, "base64");

  // ── Preprocessing ──────────────────────────────────────────────────────
  const meta = await sharp(imgBuffer).metadata();
  const srcW = meta.width ?? 1024;
  const srcH = meta.height ?? 1024;
  const maxDim = 1024;
  const scale = Math.min(maxDim / srcW, maxDim / srcH, 1);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const { data: pixels } = await sharp(imgBuffer)
    .resize(w, h)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Binary threshold — dark pixels are walls
  const threshold = config?.thresholdValue ?? 128;
  const binary = new Uint8Array(w * h);
  let totalDark = 0;
  for (let i = 0; i < pixels.length; i++) {
    if (pixels[i] < threshold) {
      binary[i] = 1;
      totalDark++;
    }
  }

  // ── Horizontal wall scan ───────────────────────────────────────────────
  const minLen = config?.minWallLengthPx ?? 30;
  const wallThick = config?.wallThicknessPx ?? 6;
  const hSegments: Segment[] = [];

  for (let y = 0; y < h; y++) {
    let runStart = -1;
    for (let x = 0; x <= w; x++) {
      const isDark = x < w && binary[y * w + x] === 1;
      if (isDark && runStart === -1) {
        runStart = x;
      } else if (!isDark && runStart !== -1) {
        const runLen = x - runStart;
        if (runLen >= minLen) {
          hSegments.push({ x1: runStart, y1: y, x2: x, y2: y, horizontal: true });
        }
        runStart = -1;
      }
    }
  }

  // ── Vertical wall scan ─────────────────────────────────────────────────
  const vSegments: Segment[] = [];

  for (let x = 0; x < w; x++) {
    let runStart = -1;
    for (let y = 0; y <= h; y++) {
      const isDark = y < h && binary[y * w + x] === 1;
      if (isDark && runStart === -1) {
        runStart = y;
      } else if (!isDark && runStart !== -1) {
        const runLen = y - runStart;
        if (runLen >= minLen) {
          vSegments.push({ x1: x, y1: runStart, x2: x, y2: y, horizontal: false });
        }
        runStart = -1;
      }
    }
  }

  const rawSegCount = hSegments.length + vSegments.length;

  // ── Merge collinear segments ───────────────────────────────────────────
  const mergedH = mergeCollinear(hSegments, true, wallThick);
  const mergedV = mergeCollinear(vSegments, false, wallThick);

  // ── Flood fill for rooms ───────────────────────────────────────────────
  const minRoomArea = config?.minRoomAreaPx ?? 500;
  const visited = new Uint8Array(w * h);

  // Mark wall pixels as visited
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === 1) visited[i] = 1;
  }

  const regions: Region[] = [];

  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      if (visited[y * w + x]) continue;
      const region = floodFill(visited, w, h, x, y);
      if (region.area >= minRoomArea) {
        regions.push(region);
      }
    }
  }

  const rawRoomCount = regions.length;

  // ── Detect door gaps ───────────────────────────────────────────────────
  // A door gap is a break in a wall segment shorter than ~1.2m equivalent
  const fpEstW = config?.estimatedFootprintMeters?.width ?? 14;
  const fpEstD = config?.estimatedFootprintMeters?.depth ?? 10;
  const pxPerMeterX = w / fpEstW;
  const pxPerMeterY = h / fpEstD;
  const maxDoorPx = 1.2 * Math.max(pxPerMeterX, pxPerMeterY);

  const doorGaps = findDoorGaps([...mergedH, ...mergedV], binary, w, h, maxDoorPx, wallThick);

  // ── Convert to meters ──────────────────────────────────────────────────
  const mPerPxX = fpEstW / w;
  const mPerPxY = fpEstD / h;
  const pixelScale = (mPerPxX + mPerPxY) / 2;

  const wallThicknessM = wallThick * pixelScale;
  const extThickness = Math.max(0.2, Math.round(wallThicknessM * 20) / 20);
  const intThickness = Math.max(0.1, extThickness * 0.75);

  // Classify walls: segments near image edges are exterior
  const edgePad = 20; // px from edge = exterior
  const walls: FloorPlanWall[] = [];

  for (const seg of mergedH) {
    const isExt = seg.y1 < edgePad || seg.y1 > h - edgePad;
    walls.push({
      start: [seg.x1 * mPerPxX, seg.y1 * mPerPxY],
      end: [seg.x2 * mPerPxX, seg.y2 * mPerPxY],
      thickness: isExt ? extThickness : intThickness,
      type: isExt ? "exterior" : "interior",
    });
  }
  for (const seg of mergedV) {
    const isExt = seg.x1 < edgePad || seg.x1 > w - edgePad;
    walls.push({
      start: [seg.x1 * mPerPxX, seg.y1 * mPerPxY],
      end: [seg.x2 * mPerPxX, seg.y2 * mPerPxY],
      thickness: isExt ? extThickness : intThickness,
      type: isExt ? "exterior" : "interior",
    });
  }

  // Rooms
  const rooms: FloorPlanRoom[] = regions.map((r, i) => ({
    name: `Room ${i + 1}`,
    center: [r.cx * mPerPxX, r.cy * mPerPxY] as [number, number],
    width: Math.round((r.maxX - r.minX) * mPerPxX * 10) / 10,
    depth: Math.round((r.maxY - r.minY) * mPerPxY * 10) / 10,
    type: "other" as FloorPlanRoomType,
  }));

  // Doors
  const doors: FloorPlanDoor[] = doorGaps.map((g) => {
    // Find closest wall index
    let bestWallIdx = 0;
    let bestDist = Infinity;
    walls.forEach((wall, idx) => {
      const wmx = (wall.start[0] + wall.end[0]) / 2;
      const wmy = (wall.start[1] + wall.end[1]) / 2;
      const d = Math.hypot(g.cx * mPerPxX - wmx, g.cy * mPerPxY - wmy);
      if (d < bestDist) { bestDist = d; bestWallIdx = idx; }
    });
    return {
      position: [g.cx * mPerPxX, g.cy * mPerPxY] as [number, number],
      width: Math.round(g.gapLength * pixelScale * 10) / 10,
      wallId: bestWallIdx,
      type: "single" as const,
    };
  });

  // Windows (simple heuristic: exterior wall gaps wider than door max)
  const windows = walls
    .filter(w => w.type === "exterior")
    .slice(0, 4)
    .map(wall => ({
      position: [
        (wall.start[0] + wall.end[0]) / 2,
        (wall.start[1] + wall.end[1]) / 2,
      ] as [number, number],
      width: 1.2,
      height: 1.2,
      sillHeight: 0.9,
    }));

  const geometry: FloorPlanGeometry = {
    footprint: { width: fpEstW, depth: fpEstD },
    wallHeight: 3.0,
    walls,
    doors,
    windows,
    rooms,
  };

  // ── Confidence ─────────────────────────────────────────────────────────
  const wallScore = Math.min(1, walls.length / 8);
  const roomScore = Math.min(1, rooms.length / 5);
  const darkRatio = totalDark / (w * h);
  // Good floor plans have 5-25% dark pixels (walls + labels)
  const coverageScore = darkRatio > 0.03 && darkRatio < 0.35 ? 1 : 0.3;
  const confidence = Math.min(1, (wallScore + roomScore + coverageScore) / 3);

  return {
    geometry,
    confidence,
    pixelScale,
    rawWallSegments: rawSegCount,
    rawRoomRegions: rawRoomCount,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function mergeCollinear(segments: Segment[], horizontal: boolean, tolerance: number): Segment[] {
  if (segments.length === 0) return [];

  // Sort by fixed axis, then by start of variable axis
  const sorted = [...segments].sort((a, b) => {
    const fixA = horizontal ? a.y1 : a.x1;
    const fixB = horizontal ? b.y1 : b.x1;
    if (Math.abs(fixA - fixB) > tolerance) return fixA - fixB;
    const varA = horizontal ? a.x1 : a.y1;
    const varB = horizontal ? b.x1 : b.y1;
    return varA - varB;
  });

  const merged: Segment[] = [];
  let cur = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const seg = sorted[i];
    const fixCur = horizontal ? cur.y1 : cur.x1;
    const fixSeg = horizontal ? seg.y1 : seg.x1;

    // Same band?
    if (Math.abs(fixCur - fixSeg) <= tolerance) {
      const endCur = horizontal ? cur.x2 : cur.y2;
      const startSeg = horizontal ? seg.x1 : seg.y1;

      // Overlapping or close?
      if (startSeg <= endCur + tolerance * 2) {
        // Extend
        if (horizontal) {
          cur.x2 = Math.max(cur.x2, seg.x2);
        } else {
          cur.y2 = Math.max(cur.y2, seg.y2);
        }
        continue;
      }
    }

    merged.push(cur);
    cur = { ...seg };
  }
  merged.push(cur);
  return merged;
}

function floodFill(visited: Uint8Array, w: number, h: number, sx: number, sy: number): Region {
  const queue: number[] = [sy * w + sx];
  visited[sy * w + sx] = 1;
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  let sumX = 0, sumY = 0, area = 0;

  while (queue.length > 0) {
    const idx = queue.pop()!;
    const x = idx % w;
    const y = (idx - x) / w;

    area++;
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    // 4-connected neighbors
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const ni = ny * w + nx;
        if (!visited[ni]) {
          visited[ni] = 1;
          queue.push(ni);
        }
      }
    }
  }

  return {
    minX, minY, maxX, maxY, area,
    cx: area > 0 ? sumX / area : sx,
    cy: area > 0 ? sumY / area : sy,
  };
}

interface DoorGap {
  cx: number;
  cy: number;
  gapLength: number;
}

function findDoorGaps(
  segments: Segment[],
  binary: Uint8Array,
  w: number,
  h: number,
  maxDoorPx: number,
  wallThick: number,
): DoorGap[] {
  const gaps: DoorGap[] = [];

  // For each pair of collinear segments, check if the gap between them is a door
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];

      if (a.horizontal !== b.horizontal) continue;

      if (a.horizontal) {
        // Same Y band?
        if (Math.abs(a.y1 - b.y1) > wallThick) continue;
        // Check gap between them
        const left = a.x2 < b.x1 ? a : b;
        const right = a.x2 < b.x1 ? b : a;
        const gapLen = right.x1 - left.x2;
        if (gapLen > 5 && gapLen < maxDoorPx) {
          gaps.push({
            cx: (left.x2 + right.x1) / 2,
            cy: a.y1,
            gapLength: gapLen,
          });
        }
      } else {
        // Same X band?
        if (Math.abs(a.x1 - b.x1) > wallThick) continue;
        const top = a.y2 < b.y1 ? a : b;
        const bottom = a.y2 < b.y1 ? b : a;
        const gapLen = bottom.y1 - top.y2;
        if (gapLen > 5 && gapLen < maxDoorPx) {
          gaps.push({
            cx: a.x1,
            cy: (top.y2 + bottom.y1) / 2,
            gapLength: gapLen,
          });
        }
      }
    }
  }

  return gaps;
}
