/**
 * DXF R14 Export — Custom Generator
 *
 * Generates a valid DXF file that opens in AutoCAD, BricsCAD, LibreCAD.
 * All coordinates in mm. Layers with standard ACI colors.
 */

import type { Floor, Wall, Door, CadWindow, Room, FurnitureInstance } from "@/types/floor-plan-cad";
import {
  wallToRectangle,
  floorBounds,
  lineDirection,
  perpendicularLeft,
  addPoints,
  scalePoint,
  wallAngle,
  wallLength,
  polygonBounds,
} from "@/lib/floor-plan/geometry";
import { getCatalogItem } from "@/lib/floor-plan/furniture-catalog";
import { formatDimension } from "@/lib/floor-plan/unit-conversion";
import type { DisplayUnit } from "@/lib/floor-plan/unit-conversion";

// ACI color indices
const LAYER_DEFS: Array<{ name: string; color: number; lineweight: number }> = [
  { name: "A-WALL-EXTR", color: 7, lineweight: 50 },
  { name: "A-WALL-INTR", color: 8, lineweight: 35 },
  { name: "A-DOOR", color: 1, lineweight: 25 },
  { name: "A-WIND", color: 3, lineweight: 25 },
  { name: "A-DIM", color: 2, lineweight: 18 },
  { name: "A-NOTE", color: 7, lineweight: 18 },
  { name: "A-ROOM-NAME", color: 5, lineweight: 18 },
  { name: "A-FURN", color: 6, lineweight: 25 },
  { name: "A-GRID", color: 9, lineweight: 13 },
];

let handleCounter = 100;
function nextHandle(): string {
  return (handleCounter++).toString(16).toUpperCase();
}

export interface DxfExportOptions {
  includeDimensions: boolean;
  includeRoomLabels: boolean;
  includeGrid: boolean;
  displayUnit: DisplayUnit;
}

export function exportFloorToDxf(
  floor: Floor,
  projectName: string,
  options: DxfExportOptions
): string {
  handleCounter = 100;
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  // ======== HEADER ========
  w("0"); w("SECTION");
  w("2"); w("HEADER");
  // Units = millimeters
  w("9"); w("$INSUNITS"); w("70"); w("4");
  // Measurement = metric
  w("9"); w("$MEASUREMENT"); w("70"); w("1");
  // LTScale
  w("9"); w("$LTSCALE"); w("40"); w("1.0");
  w("0"); w("ENDSEC");

  // ======== TABLES ========
  w("0"); w("SECTION");
  w("2"); w("TABLES");

  // Line type table
  w("0"); w("TABLE");
  w("2"); w("LTYPE");
  w("70"); w("1");
  // CONTINUOUS
  w("0"); w("LTYPE");
  w("2"); w("CONTINUOUS");
  w("70"); w("0");
  w("3"); w("Solid line");
  w("72"); w("65");
  w("73"); w("0");
  w("40"); w("0.0");
  w("0"); w("ENDTAB");

  // Layer table
  w("0"); w("TABLE");
  w("2"); w("LAYER");
  w("70"); w(String(LAYER_DEFS.length));
  for (const layer of LAYER_DEFS) {
    w("0"); w("LAYER");
    w("2"); w(layer.name);
    w("70"); w("0");
    w("62"); w(String(layer.color));
    w("6"); w("CONTINUOUS");
    w("370"); w(String(layer.lineweight));
  }
  w("0"); w("ENDTAB");

  // Style table (STANDARD text style)
  w("0"); w("TABLE");
  w("2"); w("STYLE");
  w("70"); w("1");
  w("0"); w("STYLE");
  w("2"); w("STANDARD");
  w("70"); w("0");
  w("40"); w("0.0");
  w("41"); w("1.0");
  w("50"); w("0.0");
  w("71"); w("0");
  w("42"); w("2.5");
  w("3"); w("txt");
  w("0"); w("ENDTAB");

  w("0"); w("ENDSEC");

  // ======== ENTITIES ========
  w("0"); w("SECTION");
  w("2"); w("ENTITIES");

  // --- WALLS ---
  for (const wall of floor.walls) {
    const corners = wallToRectangle(wall);
    const layer = wall.type === "exterior" ? "A-WALL-EXTR" : "A-WALL-INTR";
    writeLwPolyline(w, corners.map((p) => [p.x, p.y]), layer, true);
  }

  // --- DOORS ---
  for (const door of floor.doors) {
    const wall = floor.walls.find((w) => w.id === door.wall_id);
    if (!wall) continue;

    const dir = lineDirection(wall.centerline);
    const norm = perpendicularLeft(dir);
    const halfThick = wall.thickness_mm / 2;

    const doorStart = addPoints(wall.centerline.start, scalePoint(dir, door.position_along_wall_mm));

    // Hinge point
    const hingeWorld = door.swing_direction === "left"
      ? addPoints(doorStart, scalePoint(norm, halfThick))
      : addPoints(addPoints(doorStart, scalePoint(dir, door.width_mm)), scalePoint(norm, halfThick));

    // Leaf end (open position)
    const leafEnd = addPoints(hingeWorld, scalePoint(norm, door.width_mm));

    // Door leaf line
    writeLine(w, hingeWorld.x, hingeWorld.y, leafEnd.x, leafEnd.y, "A-DOOR");

    // Swing arc
    const angle = wallAngle(wall);
    const angleDeg = (angle * 180) / Math.PI;
    let arcStart: number, arcEnd: number;
    if (door.swing_direction === "left") {
      arcStart = angleDeg + 90;
      arcEnd = angleDeg + 180;
    } else {
      arcStart = angleDeg;
      arcEnd = angleDeg + 90;
    }
    writeArc(w, hingeWorld.x, hingeWorld.y, door.width_mm, arcStart, arcEnd, "A-DOOR");
  }

  // --- WINDOWS ---
  for (const win of floor.windows) {
    const wall = floor.walls.find((w) => w.id === win.wall_id);
    if (!wall) continue;

    const dir = lineDirection(wall.centerline);
    const norm = perpendicularLeft(dir);
    const halfThick = wall.thickness_mm / 2;

    const winStart = addPoints(wall.centerline.start, scalePoint(dir, win.position_along_wall_mm));
    const winEnd = addPoints(winStart, scalePoint(dir, win.width_mm));

    // Three parallel lines (outer, glass, inner)
    const outer1 = addPoints(winStart, scalePoint(norm, halfThick));
    const outer2 = addPoints(winEnd, scalePoint(norm, halfThick));
    const inner1 = addPoints(winStart, scalePoint(norm, -halfThick));
    const inner2 = addPoints(winEnd, scalePoint(norm, -halfThick));

    writeLine(w, outer1.x, outer1.y, outer2.x, outer2.y, "A-WIND");
    writeLine(w, winStart.x, winStart.y, winEnd.x, winEnd.y, "A-WIND");
    writeLine(w, inner1.x, inner1.y, inner2.x, inner2.y, "A-WIND");
  }

  // --- ROOM LABELS ---
  if (options.includeRoomLabels) {
    for (const room of floor.rooms) {
      const bounds = polygonBounds(room.boundary.points);
      const roomW = bounds.width;
      const roomH = bounds.height;
      const areaText = `${room.area_sqm.toFixed(1)} m²`;
      const dimText = `${formatDimension(roomW, options.displayUnit)} × ${formatDimension(roomH, options.displayUnit)}`;

      // Room name
      writeMtext(w, room.label_position.x, room.label_position.y + 200,
        `${room.name}\\P${dimText}\\P${areaText}`, 250, "A-ROOM-NAME");
    }
  }

  // --- DIMENSIONS ---
  if (options.includeDimensions) {
    for (const room of floor.rooms) {
      const bounds = polygonBounds(room.boundary.points);
      const offset = 600;

      // Horizontal dimension below room
      writeDimension(w,
        bounds.min.x, bounds.min.y - offset,
        bounds.max.x, bounds.min.y - offset,
        bounds.width, options.displayUnit);

      // Vertical dimension left of room
      writeDimension(w,
        bounds.min.x - offset, bounds.min.y,
        bounds.min.x - offset, bounds.max.y,
        bounds.height, options.displayUnit);
    }
  }

  // --- FURNITURE ---
  for (const furn of floor.furniture) {
    const catalog = getCatalogItem(furn.catalog_id);
    if (!catalog) continue;
    const w_mm = catalog.width_mm * furn.scale;
    const d_mm = catalog.depth_mm * furn.scale;
    const ox = furn.position.x;
    const oy = furn.position.y;
    // Local corners before rotation
    const local: [number, number][] = [
      [0, 0], [w_mm, 0], [w_mm, d_mm], [0, d_mm],
    ];
    // Rotate around origin (position) then translate
    const rad = (furn.rotation_deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const corners = local.map(([lx, ly]) => [
      ox + lx * cos - ly * sin,
      oy + lx * sin + ly * cos,
    ]);
    writeLwPolyline(w, corners, "A-FURN", true);
    // Label at rotated center
    const centerLocal: [number, number] = [w_mm / 2, d_mm / 2];
    writeMtext(w, ox + centerLocal[0] * cos - centerLocal[1] * sin,
      oy + centerLocal[0] * sin + centerLocal[1] * cos, catalog.name, 120, "A-FURN");
  }

  // --- COLUMNS ---
  for (const col of floor.columns) {
    if (col.type === "circular") {
      const r = (col.diameter_mm ?? 300) / 2;
      writeArc(w, col.center.x, col.center.y, r, 0, 360, "A-GRID");
    } else {
      const hw = (col.width_mm ?? 300) / 2;
      const hd = (col.depth_mm ?? 300) / 2;
      writeLwPolyline(w, [
        [col.center.x - hw, col.center.y - hd],
        [col.center.x + hw, col.center.y - hd],
        [col.center.x + hw, col.center.y + hd],
        [col.center.x - hw, col.center.y + hd],
      ], "A-GRID", true);
      // X pattern
      writeLine(w, col.center.x - hw, col.center.y - hd, col.center.x + hw, col.center.y + hd, "A-GRID");
      writeLine(w, col.center.x + hw, col.center.y - hd, col.center.x - hw, col.center.y + hd, "A-GRID");
    }
  }

  // --- STAIRS ---
  for (const stair of floor.stairs) {
    // Boundary
    writeLwPolyline(w, stair.boundary.points.map((p) => [p.x, p.y]), "A-WALL-INTR", true);
    // Treads
    for (const tread of stair.treads) {
      writeLine(w, tread.start.x, tread.start.y, tread.end.x, tread.end.y, "A-WALL-INTR");
    }
    // Up direction arrow
    writeLine(w, stair.up_direction.start.x, stair.up_direction.start.y,
      stair.up_direction.end.x, stair.up_direction.end.y, "A-NOTE");
  }

  // --- ANNOTATIONS ---
  for (const ann of floor.annotations) {
    writeMtext(w, ann.position.x, ann.position.y, ann.text, ann.font_size_mm || 200, "A-NOTE");
    if (ann.leader_line && ann.leader_line.length >= 2) {
      for (let i = 0; i < ann.leader_line.length - 1; i++) {
        writeLine(w, ann.leader_line[i].x, ann.leader_line[i].y,
          ann.leader_line[i + 1].x, ann.leader_line[i + 1].y, "A-NOTE");
      }
    }
  }

  // --- GRID ---
  if (options.includeGrid) {
    const bounds = floorBounds(floor.walls, floor.rooms);
    const gridSize = 1000; // 1m grid
    const startX = Math.floor(bounds.min.x / gridSize) * gridSize;
    const endX = Math.ceil(bounds.max.x / gridSize) * gridSize;
    const startY = Math.floor(bounds.min.y / gridSize) * gridSize;
    const endY = Math.ceil(bounds.max.y / gridSize) * gridSize;
    for (let gx = startX; gx <= endX; gx += gridSize) {
      writeLine(w, gx, startY, gx, endY, "A-GRID");
    }
    for (let gy = startY; gy <= endY; gy += gridSize) {
      writeLine(w, startX, gy, endX, gy, "A-GRID");
    }
  }

  w("0"); w("ENDSEC");

  // ======== EOF ========
  w("0"); w("EOF");

  return lines.join("\n");
}

// ============================================================
// DXF Entity Writers
// ============================================================

function writeLine(w: (s: string) => void, x1: number, y1: number, x2: number, y2: number, layer: string) {
  w("0"); w("LINE");
  w("5"); w(nextHandle());
  w("8"); w(layer);
  w("10"); w(x1.toFixed(2));
  w("20"); w(y1.toFixed(2));
  w("30"); w("0.0");
  w("11"); w(x2.toFixed(2));
  w("21"); w(y2.toFixed(2));
  w("31"); w("0.0");
}

function writeArc(w: (s: string) => void, cx: number, cy: number, radius: number, startAngle: number, endAngle: number, layer: string) {
  // Normalize angles to 0-360
  while (startAngle < 0) startAngle += 360;
  while (endAngle < 0) endAngle += 360;

  w("0"); w("ARC");
  w("5"); w(nextHandle());
  w("8"); w(layer);
  w("10"); w(cx.toFixed(2));
  w("20"); w(cy.toFixed(2));
  w("30"); w("0.0");
  w("40"); w(radius.toFixed(2));
  w("50"); w(startAngle.toFixed(2));
  w("51"); w(endAngle.toFixed(2));
}

function writeLwPolyline(w: (s: string) => void, points: number[][], layer: string, closed: boolean) {
  w("0"); w("LWPOLYLINE");
  w("5"); w(nextHandle());
  w("8"); w(layer);
  w("90"); w(String(points.length));
  w("70"); w(closed ? "1" : "0"); // 1 = closed
  for (const [px, py] of points) {
    w("10"); w(px.toFixed(2));
    w("20"); w(py.toFixed(2));
  }
}

function writeMtext(w: (s: string) => void, x: number, y: number, text: string, height: number, layer: string) {
  w("0"); w("MTEXT");
  w("5"); w(nextHandle());
  w("8"); w(layer);
  w("10"); w(x.toFixed(2));
  w("20"); w(y.toFixed(2));
  w("30"); w("0.0");
  w("40"); w(height.toFixed(2)); // text height
  w("41"); w("2000"); // reference rectangle width
  w("71"); w("5"); // attachment point: middle center
  w("1"); w(text);
}

function writeDimension(w: (s: string) => void, x1: number, y1: number, x2: number, y2: number, value_mm: number, displayUnit: DisplayUnit) {
  // DXF DIMENSION entities are complex; use LINE + TEXT as fallback
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const isHoriz = Math.abs(y1 - y2) < Math.abs(x1 - x2);

  // Dimension line
  writeLine(w, x1, y1, x2, y2, "A-DIM");

  // Extension ticks (45° slashes)
  const tickSize = 60; // mm
  writeLine(w, x1 - tickSize, y1 + tickSize, x1 + tickSize, y1 - tickSize, "A-DIM");
  writeLine(w, x2 - tickSize, y2 + tickSize, x2 + tickSize, y2 - tickSize, "A-DIM");

  // Dimension text
  const label = formatDimension(value_mm, displayUnit);
  const textY = isHoriz ? midY + 150 : midY;
  const textX = isHoriz ? midX : midX - 150;
  writeMtext(w, textX, textY, label, 180, "A-DIM");
}

// ============================================================
// Download helper
// ============================================================

export function downloadDxf(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
