/**
 * SVG Export for Floor Plan
 *
 * Clean, semantic SVG with layers mapped to <g> groups.
 * All text as <text> elements (editable in Illustrator/Figma).
 */

import type { Floor, FurnitureInstance } from "@/types/floor-plan-cad";
import { ROOM_COLORS } from "@/types/floor-plan-cad";
import {
  wallToRectangle,
  floorBounds,
  polygonBounds,
  lineDirection,
  perpendicularLeft,
  addPoints,
  scalePoint,
} from "@/lib/floor-plan/geometry";
import { formatDimension, formatArea } from "@/lib/floor-plan/unit-conversion";
import { getCatalogItem } from "@/lib/floor-plan/furniture-catalog";
import type { DisplayUnit } from "@/lib/floor-plan/unit-conversion";

export interface SvgExportOptions {
  includeRoomFills: boolean;
  includeDimensions: boolean;
  includeGrid: boolean;
  displayUnit: DisplayUnit;
}

export function exportFloorToSvg(
  floor: Floor,
  projectName: string,
  options: SvgExportOptions
): string {
  const bounds = floorBounds(floor.walls, floor.rooms);
  const PAD = 2000; // mm padding
  const vbX = bounds.min.x - PAD;
  const vbY = -(bounds.max.y + PAD); // flip Y for SVG
  const vbW = bounds.width + PAD * 2;
  const vbH = bounds.height + PAD * 2;

  // SVG Y flip: negate Y coordinates
  const y = (worldY: number) => -worldY;

  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w(`<?xml version="1.0" encoding="UTF-8"?>`);
  w(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}">`);
  w(`  <title>${escapeXml(projectName)} — Floor Plan</title>`);
  w(`  <style>`);
  w(`    text { font-family: Inter, Helvetica, Arial, sans-serif; }`);
  w(`    .wall-ext { fill: #FFFFFF; stroke: #1A1A1A; stroke-width: 8; }`);
  w(`    .wall-int { fill: #FFFFFF; stroke: #333333; stroke-width: 5; }`);
  w(`    .door-leaf { stroke: #1A1A1A; stroke-width: 3; fill: none; }`);
  w(`    .door-arc { stroke: #555555; stroke-width: 2; fill: none; stroke-dasharray: 12 8; }`);
  w(`    .window-line { stroke: #1A1A1A; stroke-width: 3; }`);
  w(`    .window-glass { stroke: #3B82F6; stroke-width: 4; }`);
  w(`    .dim-line { stroke: #666666; stroke-width: 1.5; }`);
  w(`    .dim-tick { stroke: #666666; stroke-width: 3; }`);
  w(`    .dim-text { fill: #666666; font-size: 180px; text-anchor: middle; }`);
  w(`    .room-name { font-weight: 600; font-size: 250px; text-anchor: middle; }`);
  w(`    .room-dim { font-size: 180px; text-anchor: middle; fill: #666666; }`);
  w(`    .room-area { font-size: 180px; font-weight: bold; text-anchor: middle; fill: #444444; }`);
  w(`  </style>`);

  // ======== ROOM FILLS ========
  if (options.includeRoomFills) {
    w(`  <g id="A-ROOM-FILL" opacity="0.4">`);
    for (const room of floor.rooms) {
      const colors = ROOM_COLORS[room.type] ?? ROOM_COLORS.custom;
      const pts = room.boundary.points.map((p) => `${p.x},${y(p.y)}`).join(" ");
      w(`    <polygon points="${pts}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="3"/>`);
    }
    w(`  </g>`);
  }

  // ======== WALLS ========
  w(`  <g id="A-WALL">`);
  for (const wall of floor.walls) {
    const corners = wallToRectangle(wall);
    const pts = corners.map((p) => `${p.x},${y(p.y)}`).join(" ");
    const cls = wall.type === "exterior" ? "wall-ext" : "wall-int";
    w(`    <polygon points="${pts}" class="${cls}"/>`);
  }
  w(`  </g>`);

  // ======== DOORS ========
  w(`  <g id="A-DOOR">`);
  for (const door of floor.doors) {
    const wall = floor.walls.find((wl) => wl.id === door.wall_id);
    if (!wall) continue;

    const dir = lineDirection(wall.centerline);
    const norm = perpendicularLeft(dir);
    const halfThick = wall.thickness_mm / 2;
    const doorStart = addPoints(wall.centerline.start, scalePoint(dir, door.position_along_wall_mm));

    const hinge = door.swing_direction === "left"
      ? addPoints(doorStart, scalePoint(norm, halfThick))
      : addPoints(addPoints(doorStart, scalePoint(dir, door.width_mm)), scalePoint(norm, halfThick));
    const leafEnd = addPoints(hinge, scalePoint(norm, door.width_mm));

    // Leaf line
    w(`    <line x1="${hinge.x}" y1="${y(hinge.y)}" x2="${leafEnd.x}" y2="${y(leafEnd.y)}" class="door-leaf"/>`);

    // Hinge dot
    w(`    <circle cx="${hinge.x}" cy="${y(hinge.y)}" r="40" fill="#1A1A1A"/>`);
  }
  w(`  </g>`);

  // ======== WINDOWS ========
  w(`  <g id="A-WIND">`);
  for (const win of floor.windows) {
    const wall = floor.walls.find((wl) => wl.id === win.wall_id);
    if (!wall) continue;

    const dir = lineDirection(wall.centerline);
    const norm = perpendicularLeft(dir);
    const halfThick = wall.thickness_mm / 2;
    const winStart = addPoints(wall.centerline.start, scalePoint(dir, win.position_along_wall_mm));
    const winEnd = addPoints(winStart, scalePoint(dir, win.width_mm));

    const outer1 = addPoints(winStart, scalePoint(norm, halfThick));
    const outer2 = addPoints(winEnd, scalePoint(norm, halfThick));
    const inner1 = addPoints(winStart, scalePoint(norm, -halfThick));
    const inner2 = addPoints(winEnd, scalePoint(norm, -halfThick));

    w(`    <line x1="${outer1.x}" y1="${y(outer1.y)}" x2="${outer2.x}" y2="${y(outer2.y)}" class="window-line"/>`);
    w(`    <line x1="${winStart.x}" y1="${y(winStart.y)}" x2="${winEnd.x}" y2="${y(winEnd.y)}" class="window-glass"/>`);
    w(`    <line x1="${inner1.x}" y1="${y(inner1.y)}" x2="${inner2.x}" y2="${y(inner2.y)}" class="window-line"/>`);
  }
  w(`  </g>`);

  // ======== ROOM LABELS ========
  w(`  <g id="A-ROOM-NAME">`);
  for (const room of floor.rooms) {
    const lx = room.label_position.x;
    const ly = y(room.label_position.y);
    const colors = ROOM_COLORS[room.type] ?? ROOM_COLORS.custom;
    const rb = polygonBounds(room.boundary.points);
    const dimText = `${formatDimension(rb.width, options.displayUnit)} × ${formatDimension(rb.height, options.displayUnit)}`;

    w(`    <text x="${lx}" y="${ly - 200}" class="room-name" fill="${colors.label}">${escapeXml(room.name)}</text>`);
    w(`    <text x="${lx}" y="${ly + 50}" class="room-dim">${escapeXml(dimText)}</text>`);
    w(`    <text x="${lx}" y="${ly + 300}" class="room-area">${escapeXml(formatArea(room.area_sqm, options.displayUnit))}</text>`);
  }
  w(`  </g>`);

  // ======== FURNITURE ========
  if (floor.furniture.length > 0) {
    w(`  <g id="A-FURN" opacity="0.7">`);
    for (const furn of floor.furniture) {
      const catalog = getCatalogItem(furn.catalog_id);
      if (!catalog) continue;
      const fw = catalog.width_mm * furn.scale;
      const fd = catalog.depth_mm * furn.scale;
      const fx = furn.position.x;
      const fy = y(furn.position.y);
      w(`    <g transform="translate(${fx},${fy}) rotate(${-furn.rotation_deg})">`);
      w(`      <rect x="0" y="${-fd}" width="${fw}" height="${fd}" stroke="#666" stroke-width="2" fill="#f5f5f5" fill-opacity="0.3"/>`);
      w(`      <text x="${fw / 2}" y="${-fd / 2}" font-size="120" text-anchor="middle" dominant-baseline="central" fill="#888">${escapeXml(catalog.name)}</text>`);
      w(`    </g>`);
    }
    w(`  </g>`);
  }

  // ======== COLUMNS ========
  if (floor.columns.length > 0) {
    w(`  <g id="A-COLS">`);
    for (const col of floor.columns) {
      if (col.type === "circular") {
        const r = (col.diameter_mm ?? 300) / 2;
        w(`    <circle cx="${col.center.x}" cy="${y(col.center.y)}" r="${r}" stroke="#333" stroke-width="3" fill="rgba(100,100,100,0.2)"/>`);
      } else {
        const hw = (col.width_mm ?? 300) / 2;
        const hd = (col.depth_mm ?? 300) / 2;
        w(`    <rect x="${col.center.x - hw}" y="${y(col.center.y) - hd}" width="${hw * 2}" height="${hd * 2}" stroke="#333" stroke-width="3" fill="rgba(100,100,100,0.2)"/>`);
      }
    }
    w(`  </g>`);
  }

  // ======== DIMENSIONS ========
  if (options.includeDimensions) {
    w(`  <g id="A-DIM">`);
    for (const room of floor.rooms) {
      const rb = polygonBounds(room.boundary.points);
      const off = 600;
      const tickSz = 80;

      // Horizontal
      const hy = y(rb.min.y - off);
      w(`    <line x1="${rb.min.x}" y1="${hy}" x2="${rb.max.x}" y2="${hy}" class="dim-line"/>`);
      w(`    <line x1="${rb.min.x - tickSz}" y1="${hy + tickSz}" x2="${rb.min.x + tickSz}" y2="${hy - tickSz}" class="dim-tick"/>`);
      w(`    <line x1="${rb.max.x - tickSz}" y1="${hy + tickSz}" x2="${rb.max.x + tickSz}" y2="${hy - tickSz}" class="dim-tick"/>`);
      w(`    <text x="${(rb.min.x + rb.max.x) / 2}" y="${hy - 100}" class="dim-text">${escapeXml(formatDimension(rb.width, options.displayUnit))}</text>`);

      // Vertical
      const vx = rb.min.x - off;
      const vy1 = y(rb.min.y);
      const vy2 = y(rb.max.y);
      w(`    <line x1="${vx}" y1="${vy1}" x2="${vx}" y2="${vy2}" class="dim-line"/>`);
      w(`    <line x1="${vx - tickSz}" y1="${vy1 + tickSz}" x2="${vx + tickSz}" y2="${vy1 - tickSz}" class="dim-tick"/>`);
      w(`    <line x1="${vx - tickSz}" y1="${vy2 + tickSz}" x2="${vx + tickSz}" y2="${vy2 - tickSz}" class="dim-tick"/>`);
      w(`    <text x="${vx - 150}" y="${(vy1 + vy2) / 2}" class="dim-text" transform="rotate(-90 ${vx - 150} ${(vy1 + vy2) / 2})">${escapeXml(formatDimension(rb.height, options.displayUnit))}</text>`);
    }
    w(`  </g>`);
  }

  w(`</svg>`);
  return lines.join("\n");
}

export function downloadSvg(content: string, filename: string) {
  const blob = new Blob([content], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
