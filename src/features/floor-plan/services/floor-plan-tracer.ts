/**
 * Floor Plan Tracer — Pixel-accurate wall detection using Sharp.
 *
 * Approach: Threshold image → find dark pixel runs → cluster into wall segments
 *           → flood-fill white areas to find enclosed rooms.
 *
 * This is deterministic pixel math — no AI, no hallucination.
 */

import sharp from "sharp";

export interface TracedWallSegment {
  x1: number; y1: number; x2: number; y2: number;
  thickness: number;
}

export interface TracedRegion {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  area: number;
}

export interface TraceResult {
  svg: string;
  width: number;
  height: number;
  wallSegments: TracedWallSegment[];
  enclosedRegions: TracedRegion[];
}

export async function traceFloorPlanToSVG(
  imageBuffer: Buffer
): Promise<TraceResult> {
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;

  // Resize for performance, keep aspect ratio
  const processWidth = Math.min(imgWidth, 800);
  const scale = processWidth / imgWidth;
  const processHeight = Math.round(imgHeight * scale);

  const grayBuffer = await sharp(imageBuffer)
    .resize(processWidth, processHeight, { fit: "fill" })
    .grayscale()
    .normalize()
    .raw()
    .toBuffer();

  const pixels = new Uint8Array(grayBuffer);

  // ── STEP 1: Threshold — dark pixels = walls ──
  const threshold = 100;
  const wallMap: boolean[][] = [];
  for (let y = 0; y < processHeight; y++) {
    wallMap[y] = [];
    for (let x = 0; x < processWidth; x++) {
      wallMap[y][x] = pixels[y * processWidth + x] < threshold;
    }
  }

  // ── STEP 2: Find horizontal wall segments ──
  const hSegments: Array<{ y: number; x1: number; x2: number }> = [];
  for (let y = 0; y < processHeight; y++) {
    let inWall = false;
    let startX = 0;
    for (let x = 0; x <= processWidth; x++) {
      const isWall = x < processWidth && wallMap[y][x];
      if (isWall && !inWall) {
        inWall = true;
        startX = x;
      } else if (!isWall && inWall) {
        inWall = false;
        if (x - startX >= 4) {
          hSegments.push({ y, x1: startX, x2: x });
        }
      }
    }
  }

  // ── STEP 3: Find vertical wall segments ──
  const vSegments: Array<{ x: number; y1: number; y2: number }> = [];
  for (let x = 0; x < processWidth; x++) {
    let inWall = false;
    let startY = 0;
    for (let y = 0; y <= processHeight; y++) {
      const isWall = y < processHeight && wallMap[y][x];
      if (isWall && !inWall) {
        inWall = true;
        startY = y;
      } else if (!isWall && inWall) {
        inWall = false;
        if (y - startY >= 4) {
          vSegments.push({ x, y1: startY, y2: y });
        }
      }
    }
  }

  // ── STEP 4: Cluster into wall lines ──
  const mergedH = clusterHorizontalSegments(hSegments, 3);
  const mergedV = clusterVerticalSegments(vSegments, 3);

  // ── STEP 5: Dilate wall map to close door gaps, then flood-fill ──
  // Doors create gaps in walls — dilate by a radius to close them
  // so flood fill finds enclosed rooms instead of leaking through.
  const dilateRadius = Math.max(3, Math.round(processWidth * 0.008)); // ~6px for 800px wide
  const dilatedMap: boolean[][] = [];
  for (let y = 0; y < processHeight; y++) {
    dilatedMap[y] = new Array(processWidth).fill(false);
  }
  for (let y = 0; y < processHeight; y++) {
    for (let x = 0; x < processWidth; x++) {
      if (wallMap[y][x]) {
        for (let dy = -dilateRadius; dy <= dilateRadius; dy++) {
          for (let dx = -dilateRadius; dx <= dilateRadius; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < processHeight && nx >= 0 && nx < processWidth) {
              dilatedMap[ny][nx] = true;
            }
          }
        }
      }
    }
  }


  const visited: boolean[][] = [];
  for (let y = 0; y < processHeight; y++) {
    visited[y] = new Array(processWidth).fill(false);
  }

  const regions: TracedRegion[] = [];
  let regionId = 0;
  const imageArea = processWidth * processHeight;

  const allRegions: Array<{ bounds: { x: number; y: number; width: number; height: number }; center: { x: number; y: number }; area: number }> = [];
  for (let y = 1; y < processHeight - 1; y++) {
    for (let x = 1; x < processWidth - 1; x++) {
      if (!dilatedMap[y][x] && !visited[y][x]) {
        const region = floodFill(dilatedMap, visited, x, y, processWidth, processHeight);
        if (region.area > 50) allRegions.push(region); // collect anything non-trivial for logging
      }
    }
  }

  // Log all regions before filtering
  for (const r of allRegions) {
    const pct = ((r.area / imageArea) * 100).toFixed(1);
    const included = r.area > imageArea * 0.02 && r.area < imageArea * 0.6;
  }

  // Filter: rooms must be 3-60% of image area (skip furniture, door arcs, background)
  for (const r of allRegions) {
    if (r.area > imageArea * 0.02 && r.area < imageArea * 0.6) {
      regions.push({ id: regionId++, bounds: r.bounds, center: r.center, area: r.area });
    }
  }

  regions.sort((a, b) => b.area - a.area);

  // ── STEP 6: Generate SVG + scale back to original coords ──
  const wallSegments: TracedWallSegment[] = [
    ...mergedH.map(s => ({
      x1: s.x1 / scale, y1: s.y / scale,
      x2: s.x2 / scale, y2: s.y / scale,
      thickness: Math.max(s.thickness / scale, 1),
    })),
    ...mergedV.map(s => ({
      x1: s.x / scale, y1: s.y1 / scale,
      x2: s.x / scale, y2: s.y2 / scale,
      thickness: Math.max(s.thickness / scale, 1),
    })),
  ];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${imgWidth} ${imgHeight}" width="${imgWidth}" height="${imgHeight}">\n`;
  for (const w of wallSegments) {
    svg += `  <line x1="${w.x1.toFixed(1)}" y1="${w.y1.toFixed(1)}" x2="${w.x2.toFixed(1)}" y2="${w.y2.toFixed(1)}" stroke="#333" stroke-width="${w.thickness.toFixed(1)}" class="wall"/>\n`;
  }
  for (const r of regions) {
    const b = r.bounds;
    svg += `  <rect x="${(b.x / scale).toFixed(1)}" y="${(b.y / scale).toFixed(1)}" width="${(b.width / scale).toFixed(1)}" height="${(b.height / scale).toFixed(1)}" fill="rgba(200,200,255,0.2)" stroke="blue" stroke-width="0.5" class="region" data-region-id="${r.id}" data-area="${r.area}"/>\n`;
  }
  svg += `</svg>`;

  const scaledRegions = regions.map(r => ({
    ...r,
    bounds: {
      x: r.bounds.x / scale,
      y: r.bounds.y / scale,
      width: r.bounds.width / scale,
      height: r.bounds.height / scale,
    },
    center: { x: r.center.x / scale, y: r.center.y / scale },
  }));

  return { svg, width: imgWidth, height: imgHeight, wallSegments, enclosedRegions: scaledRegions };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function floodFill(
  wallMap: boolean[][],
  visited: boolean[][],
  startX: number,
  startY: number,
  width: number,
  height: number,
): { bounds: { x: number; y: number; width: number; height: number }; center: { x: number; y: number }; area: number } {
  // Use iterative BFS to avoid stack overflow on large regions
  const queue: number[] = [startX, startY];
  let head = 0;
  let minX = startX, maxX = startX, minY = startY, maxY = startY;
  let sumX = 0, sumY = 0, count = 0;

  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (wallMap[y][x] || visited[y][x]) continue;

    visited[y][x] = true;
    count++;
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    queue.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  return {
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    center: { x: count > 0 ? sumX / count : startX, y: count > 0 ? sumY / count : startY },
    area: count,
  };
}

function clusterHorizontalSegments(
  segments: Array<{ y: number; x1: number; x2: number }>,
  tolerance: number,
): Array<{ y: number; x1: number; x2: number; thickness: number }> {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.y - b.y || a.x1 - b.x1);
  const clusters: Array<{ ys: number[]; x1: number; x2: number }> = [];
  let cur = { ys: [sorted[0].y], x1: sorted[0].x1, x2: sorted[0].x2 };

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    const lastY = cur.ys[cur.ys.length - 1];
    const xOverlap = Math.min(cur.x2, s.x2) - Math.max(cur.x1, s.x1);
    const xRange = Math.max(cur.x2 - cur.x1, s.x2 - s.x1);
    if (Math.abs(s.y - lastY) <= tolerance && xOverlap > xRange * 0.5) {
      cur.ys.push(s.y);
      cur.x1 = Math.min(cur.x1, s.x1);
      cur.x2 = Math.max(cur.x2, s.x2);
    } else {
      clusters.push(cur);
      cur = { ys: [s.y], x1: s.x1, x2: s.x2 };
    }
  }
  clusters.push(cur);

  return clusters
    .filter(c => c.x2 - c.x1 > 25) // min 25px — skip text, furniture marks
    .map(c => ({
      y: c.ys[Math.floor(c.ys.length / 2)],
      x1: c.x1,
      x2: c.x2,
      thickness: Math.max(c.ys[c.ys.length - 1] - c.ys[0], 2),
    }));
}

function clusterVerticalSegments(
  segments: Array<{ x: number; y1: number; y2: number }>,
  tolerance: number,
): Array<{ x: number; y1: number; y2: number; thickness: number }> {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.x - b.x || a.y1 - b.y1);
  const clusters: Array<{ xs: number[]; y1: number; y2: number }> = [];
  let cur = { xs: [sorted[0].x], y1: sorted[0].y1, y2: sorted[0].y2 };

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    const lastX = cur.xs[cur.xs.length - 1];
    const yOverlap = Math.min(cur.y2, s.y2) - Math.max(cur.y1, s.y1);
    const yRange = Math.max(cur.y2 - cur.y1, s.y2 - s.y1);
    if (Math.abs(s.x - lastX) <= tolerance && yOverlap > yRange * 0.5) {
      cur.xs.push(s.x);
      cur.y1 = Math.min(cur.y1, s.y1);
      cur.y2 = Math.max(cur.y2, s.y2);
    } else {
      clusters.push(cur);
      cur = { xs: [s.x], y1: s.y1, y2: s.y2 };
    }
  }
  clusters.push(cur);

  return clusters
    .filter(c => c.y2 - c.y1 > 25) // min 25px — skip text, furniture marks
    .map(c => ({
      x: c.xs[Math.floor(c.xs.length / 2)],
      y1: c.y1,
      y2: c.y2,
      thickness: Math.max(c.xs[c.xs.length - 1] - c.xs[0], 2),
    }));
}
