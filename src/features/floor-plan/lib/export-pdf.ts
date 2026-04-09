/**
 * PDF Export for Floor Plan
 *
 * Uses jsPDF to render floor plan to vector PDF.
 * Includes auto-scaling, title block, and optional content.
 */

import type { Floor, FloorPlanProject, FurnitureInstance } from "@/types/floor-plan-cad";
import { ROOM_COLORS } from "@/types/floor-plan-cad";
import {
  wallToRectangle,
  floorBounds,
  polygonBounds,
  lineDirection,
  perpendicularLeft,
  addPoints,
  scalePoint,
  wallAngle,
} from "@/features/floor-plan/lib/geometry";
import { formatDimension, formatArea } from "@/lib/floor-plan/unit-conversion";
import { getCatalogItem } from "@/features/floor-plan/lib/furniture-catalog";
import type { DisplayUnit } from "@/lib/floor-plan/unit-conversion";

export type PaperSize = "A4" | "A3" | "A1";
export type PdfScale = "1:50" | "1:100" | "1:200" | "auto";

export interface PdfExportOptions {
  paperSize: PaperSize;
  scale: PdfScale;
  includeTitleBlock: boolean;
  includeRoomFills: boolean;
  includeDimensions: boolean;
  displayUnit: DisplayUnit;
}

// Paper dimensions in mm (landscape)
const PAPER_SIZES: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A1: { w: 841, h: 594 },
};

const MARGIN = 20; // mm

export async function exportFloorToPdf(
  project: FloorPlanProject,
  floor: Floor,
  options: PdfExportOptions
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");

  const paper = PAPER_SIZES[options.paperSize] ?? PAPER_SIZES.A4;
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [paper.w, paper.h],
  });

  const bounds = floorBounds(floor.walls, floor.rooms);
  const drawableW = paper.w - MARGIN * 2 - (options.includeTitleBlock ? 60 : 0);
  const drawableH = paper.h - MARGIN * 2;

  // Calculate scale
  let scaleNum: number;
  if (options.scale === "auto") {
    const bwM = Math.max(bounds.width / 1000, 0.001);
    const bhM = Math.max(bounds.height / 1000, 0.001);
    const scaleX = drawableW / bwM;
    const scaleY = drawableH / bhM;
    scaleNum = Math.min(scaleX, scaleY) * 1000; // mm per mm
  } else {
    const parts = options.scale.split(":");
    const scaleVal = parts.length >= 2 ? parseInt(parts[1]) : 100;
    scaleNum = 1 / (scaleVal || 100) * 1000; // world mm to paper mm
  }

  // Transform: world mm → paper mm
  const toX = (wx: number) => MARGIN + (wx - bounds.min.x) * scaleNum / 1000;
  const toY = (wy: number) => MARGIN + (bounds.max.y - wy) * scaleNum / 1000; // flip Y

  // ======== ROOM FILLS ========
  if (options.includeRoomFills) {
    for (const room of floor.rooms) {
      const colors = ROOM_COLORS[room.type] ?? ROOM_COLORS.custom;
      const rgb = hexToRgb(colors.fill);
      if (rgb) {
        pdf.setFillColor(rgb.r, rgb.g, rgb.b);
        const pts = room.boundary.points.map((p) => [toX(p.x), toY(p.y)] as [number, number]);
        if (pts.length >= 3) {
          // @ts-ignore jsPDF polygon method
          pdf.setGState(new (pdf as any).GState({ opacity: 0.35 }));
          drawPolygon(pdf, pts, "F");
          pdf.setGState(new (pdf as any).GState({ opacity: 1 }));
        }
      }
    }
  }

  // ======== WALLS ========
  for (const wall of floor.walls) {
    const corners = wallToRectangle(wall);
    const pts = corners.map((p) => [toX(p.x), toY(p.y)] as [number, number]);
    const lw = wall.type === "exterior" ? 0.5 : 0.3;
    pdf.setLineWidth(lw);
    pdf.setDrawColor(30, 30, 30);
    pdf.setFillColor(255, 255, 255);
    drawPolygon(pdf, pts, "FD");
  }

  // ======== DOORS ========
  for (const door of floor.doors) {
    const wall = floor.walls.find((w) => w.id === door.wall_id);
    if (!wall) continue;

    const dir = lineDirection(wall.centerline);
    const norm = perpendicularLeft(dir);
    const halfThick = wall.thickness_mm / 2;
    const doorStart = addPoints(wall.centerline.start, scalePoint(dir, door.position_along_wall_mm));
    const hinge = door.swing_direction === "left"
      ? addPoints(doorStart, scalePoint(norm, halfThick))
      : addPoints(addPoints(doorStart, scalePoint(dir, door.width_mm)), scalePoint(norm, halfThick));
    const leafEnd = addPoints(hinge, scalePoint(norm, door.width_mm));

    // Clear wall at opening
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(255, 255, 255);
    const breakStart = addPoints(doorStart, scalePoint(norm, -halfThick - 5));
    const breakEnd = addPoints(addPoints(doorStart, scalePoint(dir, door.width_mm)), scalePoint(norm, halfThick + 5));
    pdf.rect(toX(Math.min(breakStart.x, breakEnd.x)), toY(Math.max(breakStart.y, breakEnd.y)),
      Math.abs(toX(breakEnd.x) - toX(breakStart.x)), Math.abs(toY(breakEnd.y) - toY(breakStart.y)), "F");

    // Leaf line
    pdf.setDrawColor(180, 0, 0);
    pdf.setLineWidth(0.25);
    pdf.line(toX(hinge.x), toY(hinge.y), toX(leafEnd.x), toY(leafEnd.y));

    // Swing arc (quarter-circle from open to closed position)
    try {
      const arcR = door.width_mm;
      const closedEnd = addPoints(hinge, scalePoint(dir, door.swing_direction === "left" ? arcR : -arcR));
      // Draw dashed arc by approximating with line segments
      pdf.setDrawColor(180, 0, 0);
      pdf.setLineWidth(0.15);
      const cx = toX(hinge.x);
      const cy = toY(hinge.y);
      const r = arcR * scaleNum / 1000;
      // Compute start/end angles from leafEnd and closedEnd
      const angOpen = Math.atan2(-(toY(leafEnd.y) - cy), toX(leafEnd.x) - cx);
      const angClosed = Math.atan2(-(toY(closedEnd.y) - cy), toX(closedEnd.x) - cx);
      const SEGMENTS = 12;
      const sweep = angClosed - angOpen;
      const step = sweep / SEGMENTS;
      for (let i = 0; i < SEGMENTS; i++) {
        // Dashed: draw every other segment
        if (i % 2 === 0) {
          const a1 = angOpen + step * i;
          const a2 = angOpen + step * (i + 1);
          pdf.line(cx + r * Math.cos(a1), cy - r * Math.sin(a1),
                   cx + r * Math.cos(a2), cy - r * Math.sin(a2));
        }
      }
    } catch (e) { console.warn("[PDF-ARC]", (e as Error)?.message ?? e); }

    // Hinge dot
    pdf.setFillColor(180, 0, 0);
    pdf.circle(toX(hinge.x), toY(hinge.y), 0.4, "F");
  }

  // ======== WINDOWS ========
  for (const win of floor.windows) {
    const wall = floor.walls.find((w) => w.id === win.wall_id);
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

    // Clear wall
    pdf.setFillColor(255, 255, 255);
    pdf.rect(
      toX(Math.min(inner1.x, outer2.x)), toY(Math.max(inner1.y, outer2.y)),
      Math.abs(toX(outer2.x) - toX(inner1.x)) || 0.1,
      Math.abs(toY(outer2.y) - toY(inner1.y)) || 0.1, "F"
    );

    pdf.setDrawColor(0, 120, 0);
    pdf.setLineWidth(0.2);
    pdf.line(toX(outer1.x), toY(outer1.y), toX(outer2.x), toY(outer2.y));
    pdf.line(toX(winStart.x), toY(winStart.y), toX(winEnd.x), toY(winEnd.y));
    pdf.line(toX(inner1.x), toY(inner1.y), toX(inner2.x), toY(inner2.y));
  }

  // ======== FURNITURE ========
  pdf.setDrawColor(120, 120, 120);
  pdf.setLineWidth(0.15);
  for (const furn of floor.furniture) {
    const catalog = getCatalogItem(furn.catalog_id);
    if (!catalog) continue;
    const fw = catalog.width_mm * furn.scale;
    const fd = catalog.depth_mm * furn.scale;
    const pw = fw * scaleNum / 1000;
    const ph = fd * scaleNum / 1000;
    // Compute rotated corners in world space, then transform to paper
    const ox = furn.position.x;
    const oy = furn.position.y;
    const rad = (furn.rotation_deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const localCorners: [number, number][] = [[0, 0], [fw, 0], [fw, fd], [0, fd]];
    const paperCorners = localCorners.map(([lx, ly]) => [
      toX(ox + lx * cos - ly * sin),
      toY(oy + lx * sin + ly * cos),
    ] as [number, number]);
    pdf.setFillColor(240, 240, 240);
    drawPolygon(pdf, paperCorners, "FD");
    // Label at rotated center
    const cx = toX(ox + (fw / 2) * cos - (fd / 2) * sin);
    const cy = toY(oy + (fw / 2) * sin + (fd / 2) * cos);
    pdf.setFontSize(4);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(120, 120, 120);
    pdf.text(catalog.name, cx, cy + 0.5, { align: "center" });
  }

  // ======== COLUMNS ========
  pdf.setDrawColor(60, 60, 60);
  pdf.setLineWidth(0.25);
  for (const col of floor.columns) {
    const sx = toX(col.center.x);
    const sy = toY(col.center.y);
    if (col.type === "circular") {
      const r = ((col.diameter_mm ?? 300) / 2) * scaleNum / 1000;
      pdf.setFillColor(180, 180, 180);
      pdf.circle(sx, sy, r, "FD");
    } else {
      const hw = ((col.width_mm ?? 300) / 2) * scaleNum / 1000;
      const hd = ((col.depth_mm ?? 300) / 2) * scaleNum / 1000;
      pdf.setFillColor(180, 180, 180);
      pdf.rect(sx - hw, sy - hd, hw * 2, hd * 2, "FD");
    }
  }

  // ======== STAIRS ========
  for (const stair of floor.stairs) {
    pdf.setDrawColor(80, 80, 80);
    pdf.setFillColor(220, 220, 220);
    pdf.setLineWidth(0.2);
    const stairPts = stair.boundary.points.map((p) => [toX(p.x), toY(p.y)] as [number, number]);
    drawPolygon(pdf, stairPts, "FD");
    // Draw treads
    pdf.setLineWidth(0.1);
    for (const tread of stair.treads) {
      pdf.line(toX(tread.start.x), toY(tread.start.y), toX(tread.end.x), toY(tread.end.y));
    }
  }

  // ======== ANNOTATIONS ========
  pdf.setTextColor(50, 50, 50);
  for (const ann of floor.annotations) {
    const ax = toX(ann.position.x);
    const ay = toY(ann.position.y);
    pdf.setFontSize(Math.max(5, Math.min(10, (ann.font_size_mm || 200) * scaleNum / 1000)));
    pdf.text(ann.text, ax, ay);
    // Leader line
    if (ann.leader_line && ann.leader_line.length >= 2) {
      pdf.setDrawColor(100, 100, 100);
      pdf.setLineWidth(0.1);
      for (let i = 0; i < ann.leader_line.length - 1; i++) {
        pdf.line(
          toX(ann.leader_line[i].x), toY(ann.leader_line[i].y),
          toX(ann.leader_line[i + 1].x), toY(ann.leader_line[i + 1].y)
        );
      }
    }
  }

  // ======== ROOM LABELS ========
  pdf.setTextColor(60, 60, 60);
  for (const room of floor.rooms) {
    const lx = toX(room.label_position.x);
    const ly = toY(room.label_position.y);
    const rBounds = polygonBounds(room.boundary.points);

    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.text(room.name, lx, ly - 1.5, { align: "center" });

    pdf.setFontSize(6);
    pdf.setFont("helvetica", "normal");
    const dimText = `${formatDimension(rBounds.width, options.displayUnit)} × ${formatDimension(rBounds.height, options.displayUnit)}`;
    pdf.text(dimText, lx, ly + 1.5, { align: "center" });
    pdf.text(formatArea(room.area_sqm, options.displayUnit), lx, ly + 4, { align: "center" });
  }

  // ======== DIMENSIONS ========
  if (options.includeDimensions) {
    pdf.setDrawColor(100, 100, 100);
    pdf.setTextColor(100, 100, 100);
    pdf.setLineWidth(0.1);

    for (const room of floor.rooms) {
      const rb = polygonBounds(room.boundary.points);
      const offset = 600;

      // Horizontal
      const hx1 = toX(rb.min.x);
      const hx2 = toX(rb.max.x);
      const hy = toY(rb.min.y - offset);
      pdf.line(hx1, hy, hx2, hy);
      // Ticks
      pdf.line(hx1 - 0.5, hy + 0.5, hx1 + 0.5, hy - 0.5);
      pdf.line(hx2 - 0.5, hy + 0.5, hx2 + 0.5, hy - 0.5);
      pdf.setFontSize(5);
      pdf.text(formatDimension(rb.width, options.displayUnit), (hx1 + hx2) / 2, hy - 1, { align: "center" });

      // Vertical
      const vx = toX(rb.min.x - offset);
      const vy1 = toY(rb.min.y);
      const vy2 = toY(rb.max.y);
      pdf.line(vx, vy1, vx, vy2);
      pdf.line(vx - 0.5, vy1 + 0.5, vx + 0.5, vy1 - 0.5);
      pdf.line(vx - 0.5, vy2 + 0.5, vx + 0.5, vy2 - 0.5);
      pdf.text(formatDimension(rb.height, options.displayUnit), vx - 1, (vy1 + vy2) / 2, { align: "center", angle: 90 });
    }
  }

  // ======== TITLE BLOCK ========
  if (options.includeTitleBlock) {
    const tbX = paper.w - MARGIN - 55;
    const tbY = paper.h - MARGIN - 40;
    const tbW = 55;
    const tbH = 40;

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.4);
    pdf.rect(tbX, tbY, tbW, tbH);

    // Divider lines
    pdf.setLineWidth(0.15);
    pdf.line(tbX, tbY + 10, tbX + tbW, tbY + 10);
    pdf.line(tbX, tbY + 18, tbX + tbW, tbY + 18);
    pdf.line(tbX, tbY + 26, tbX + tbW, tbY + 26);
    pdf.line(tbX, tbY + 33, tbX + tbW, tbY + 33);

    pdf.setTextColor(0, 0, 0);

    // Project name
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.text(project.name, tbX + tbW / 2, tbY + 6, { align: "center" });

    // Drawing title
    pdf.setFontSize(6);
    pdf.setFont("helvetica", "normal");
    pdf.text(`Floor Plan — ${floor.name}`, tbX + tbW / 2, tbY + 14.5, { align: "center" });

    // Scale
    const scaleLabel = options.scale === "auto" ? `1:${Math.round(1000 / scaleNum)}` : options.scale;
    pdf.text(`Scale: ${scaleLabel}`, tbX + tbW / 2, tbY + 22.5, { align: "center" });

    // Date
    pdf.text(new Date().toLocaleDateString(), tbX + tbW / 2, tbY + 30, { align: "center" });

    // Generated by
    pdf.setFontSize(5);
    pdf.setTextColor(120, 120, 120);
    pdf.text("Generated by BuildFlow", tbX + tbW / 2, tbY + 37, { align: "center" });
  }

  // ======== SCALE BAR ========
  const sbX = MARGIN;
  const sbY = paper.h - MARGIN - 3;
  const sbSegment = 1000 * scaleNum / 1000; // 1m in paper mm
  const sbSegments = 3;
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.3);

  for (let i = 0; i < sbSegments; i++) {
    const x = sbX + i * sbSegment;
    if (i % 2 === 0) {
      pdf.setFillColor(0, 0, 0);
    } else {
      pdf.setFillColor(255, 255, 255);
    }
    pdf.rect(x, sbY, sbSegment, 1.5, "FD");
  }
  pdf.setFontSize(5);
  pdf.setTextColor(0, 0, 0);
  pdf.text("0", sbX, sbY - 0.5, { align: "center" });
  for (let i = 1; i <= sbSegments; i++) {
    pdf.text(`${i}m`, sbX + i * sbSegment, sbY - 0.5, { align: "center" });
  }

  // Save
  const filename = `${project.name.replace(/[^a-zA-Z0-9]/g, "_")}_floor_plan.pdf`;
  pdf.save(filename);
}

// ============================================================
// Helpers
// ============================================================

function drawPolygon(pdf: any, points: [number, number][], style: string) {
  if (points.length < 3) return;
  // Build line deltas from first point — jsPDF lines() handles concave polygons correctly
  const deltas: [number, number][] = [];
  for (let i = 1; i < points.length; i++) {
    deltas.push([points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]]);
  }
  // closed=true auto-closes back to start
  pdf.lines(deltas, points[0][0], points[0][1], [1, 1], style, true);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}
