/**
 * Node Output Adapter — Extracts structured outputs from a FloorPlanProject
 * for downstream workflow nodes (BOQ, IFC, reports).
 */

import type { FloorPlanProject, Floor, Wall, Room, Door, CadWindow } from "@/types/floor-plan-cad";
import { generateBOQ, type BOQReport } from "@/features/floor-plan/lib/boq-generator";
import { analyzeVastuCompliance, type VastuReport } from "@/features/floor-plan/lib/vastu-analyzer";
import { validateBuildingCode, type CodeReport } from "@/features/floor-plan/lib/code-validator";
import { exportFloorToSvg } from "@/features/floor-plan/lib/export-svg";
import { wallLength, polygonBounds } from "@/features/floor-plan/lib/geometry";

// ────────────────────────────────────────────────────────────────────────────
// Room Schedule
// ────────────────────────────────────────────────────────────────────────────

export interface RoomScheduleEntry {
  room_number: number;
  name: string;
  type: string;
  area_sqm: number;
  width_m: number;
  length_m: number;
  floor: string;
  vastu_direction?: string;
  vastu_compliant?: boolean;
}

export function extractRoomSchedule(project: FloorPlanProject): RoomScheduleEntry[] {
  const entries: RoomScheduleEntry[] = [];
  let num = 1;
  for (const floor of project.floors) {
    for (const room of floor.rooms) {
      const b = polygonBounds(room.boundary.points);
      entries.push({
        room_number: num++,
        name: room.name,
        type: room.type.replace(/_/g, " "),
        area_sqm: Math.round(room.area_sqm * 100) / 100,
        width_m: Math.round((b.width / 1000) * 100) / 100,
        length_m: Math.round((b.height / 1000) * 100) / 100,
        floor: floor.name,
        vastu_direction: room.vastu_direction ?? undefined,
        vastu_compliant: room.vastu_compliant ?? undefined,
      });
    }
  }
  return entries;
}

// ────────────────────────────────────────────────────────────────────────────
// BOQ Quantities (structured JSON for downstream BOQ calculator)
// ────────────────────────────────────────────────────────────────────────────

export interface BOQQuantities {
  walls: {
    exterior: { length_m: number; area_sqm: number; volume_cum: number; material: string };
    interior: { length_m: number; area_sqm: number; volume_cum: number; material: string };
    partition: { length_m: number; area_sqm: number; volume_cum: number; material: string };
  };
  doors: Array<{
    type: string;
    width_mm: number;
    height_mm: number;
    count: number;
    description: string;
  }>;
  windows: Array<{
    type: string;
    width_mm: number;
    height_mm: number;
    count: number;
    area_sqm: number;
  }>;
  flooring: {
    total_area_sqm: number;
    by_room_type: Record<string, number>;
  };
  plastering: {
    interior_wall_area_sqm: number;
    ceiling_area_sqm: number;
    exterior_wall_area_sqm: number;
  };
  skirting: { total_length_m: number };
  painting: {
    wall_area_sqm: number;
    ceiling_area_sqm: number;
  };
  structural: {
    columns_count: number;
    columns_volume_cum: number;
    slab_area_sqm: number;
    slab_volume_cum: number;
    stairs_count: number;
  };
}

export function computeBOQQuantities(project: FloorPlanProject): BOQQuantities {
  const result: BOQQuantities = {
    walls: {
      exterior: { length_m: 0, area_sqm: 0, volume_cum: 0, material: "brick_230mm" },
      interior: { length_m: 0, area_sqm: 0, volume_cum: 0, material: "brick_150mm" },
      partition: { length_m: 0, area_sqm: 0, volume_cum: 0, material: "drywall_100mm" },
    },
    doors: [],
    windows: [],
    flooring: { total_area_sqm: 0, by_room_type: {} },
    plastering: { interior_wall_area_sqm: 0, ceiling_area_sqm: 0, exterior_wall_area_sqm: 0 },
    skirting: { total_length_m: 0 },
    painting: { wall_area_sqm: 0, ceiling_area_sqm: 0 },
    structural: { columns_count: 0, columns_volume_cum: 0, slab_area_sqm: 0, slab_volume_cum: 0, stairs_count: 0 },
  };

  for (const floor of project.floors) {
    // Walls
    for (const wall of floor.walls) {
      const len = wallLength(wall) / 1000; // m
      const area = len * (wall.height_mm / 1000); // sqm
      const vol = area * (wall.thickness_mm / 1000); // cum
      const bucket = wall.type === "exterior" ? "exterior" : wall.type === "partition" ? "partition" : "interior";
      result.walls[bucket].length_m += len;
      result.walls[bucket].area_sqm += area;
      result.walls[bucket].volume_cum += vol;

      if (wall.type === "exterior") {
        result.plastering.exterior_wall_area_sqm += area;
      } else {
        result.plastering.interior_wall_area_sqm += area * 2; // both sides
      }
    }

    // Doors — group by type+size
    const doorGroups = new Map<string, { type: string; width_mm: number; height_mm: number; count: number; desc: string }>();
    for (const door of floor.doors) {
      const key = `${door.type}-${door.width_mm}-${door.height_mm}`;
      const existing = doorGroups.get(key);
      if (existing) {
        existing.count++;
      } else {
        const desc = door.width_mm >= 1050 ? "Main / Entrance" : door.width_mm <= 750 ? "Bathroom" : "Room";
        doorGroups.set(key, {
          type: door.type.replace(/_/g, " "),
          width_mm: door.width_mm,
          height_mm: door.height_mm,
          count: 1,
          desc,
        });
      }
    }
    for (const g of doorGroups.values()) {
      result.doors.push({ type: g.type, width_mm: g.width_mm, height_mm: g.height_mm, count: g.count, description: g.desc });
    }

    // Windows — group by type+size
    const winGroups = new Map<string, { type: string; width_mm: number; height_mm: number; count: number; area_sqm: number }>();
    for (const win of floor.windows) {
      const key = `${win.type}-${win.width_mm}-${win.height_mm}`;
      const existing = winGroups.get(key);
      const unitArea = (win.width_mm * win.height_mm) / 1_000_000;
      if (existing) {
        existing.count++;
        existing.area_sqm += unitArea;
      } else {
        winGroups.set(key, {
          type: win.type.replace(/_/g, " "),
          width_mm: win.width_mm,
          height_mm: win.height_mm,
          count: 1,
          area_sqm: unitArea,
        });
      }
    }
    for (const g of winGroups.values()) {
      result.windows.push(g);
    }

    // Flooring
    for (const room of floor.rooms) {
      result.flooring.total_area_sqm += room.area_sqm;
      const type = room.type.replace(/_/g, " ");
      result.flooring.by_room_type[type] = (result.flooring.by_room_type[type] ?? 0) + room.area_sqm;
      result.skirting.total_length_m += (room.perimeter_mm ?? 0) / 1000;
    }

    // Painting = plastering areas (deduct door/window openings)
    const openingArea = floor.doors.reduce((s, d) => s + (d.width_mm * d.height_mm) / 1_000_000, 0)
      + floor.windows.reduce((s, w) => s + (w.width_mm * w.height_mm) / 1_000_000, 0);
    result.painting.wall_area_sqm = result.plastering.interior_wall_area_sqm + result.plastering.exterior_wall_area_sqm - openingArea;
    result.painting.ceiling_area_sqm = result.flooring.total_area_sqm;

    // Ceiling = floor area
    result.plastering.ceiling_area_sqm = result.flooring.total_area_sqm;

    // Structural
    result.structural.columns_count += floor.columns.length;
    for (const col of floor.columns) {
      if (col.type === "circular") {
        const r = (col.diameter_mm ?? 300) / 2000;
        result.structural.columns_volume_cum += Math.PI * r * r * (floor.floor_to_floor_height_mm / 1000);
      } else {
        const w = (col.width_mm ?? 300) / 1000;
        const d = (col.depth_mm ?? 300) / 1000;
        result.structural.columns_volume_cum += w * d * (floor.floor_to_floor_height_mm / 1000);
      }
    }
    result.structural.slab_area_sqm += result.flooring.total_area_sqm;
    result.structural.slab_volume_cum += result.flooring.total_area_sqm * (floor.slab_thickness_mm / 1000);
    result.structural.stairs_count += floor.stairs.length;
  }

  // Round all values
  const round = (n: number) => Math.round(n * 100) / 100;
  result.walls.exterior.length_m = round(result.walls.exterior.length_m);
  result.walls.exterior.area_sqm = round(result.walls.exterior.area_sqm);
  result.walls.exterior.volume_cum = round(result.walls.exterior.volume_cum);
  result.walls.interior.length_m = round(result.walls.interior.length_m);
  result.walls.interior.area_sqm = round(result.walls.interior.area_sqm);
  result.walls.interior.volume_cum = round(result.walls.interior.volume_cum);
  result.walls.partition.length_m = round(result.walls.partition.length_m);
  result.walls.partition.area_sqm = round(result.walls.partition.area_sqm);
  result.walls.partition.volume_cum = round(result.walls.partition.volume_cum);
  result.flooring.total_area_sqm = round(result.flooring.total_area_sqm);
  result.plastering.interior_wall_area_sqm = round(result.plastering.interior_wall_area_sqm);
  result.plastering.ceiling_area_sqm = round(result.plastering.ceiling_area_sqm);
  result.plastering.exterior_wall_area_sqm = round(result.plastering.exterior_wall_area_sqm);
  result.skirting.total_length_m = round(result.skirting.total_length_m);
  result.painting.wall_area_sqm = round(result.painting.wall_area_sqm);
  result.painting.ceiling_area_sqm = round(result.painting.ceiling_area_sqm);

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// BOQ → EX-002 Exporter Format Converter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Converts raw BOQQuantities into a structured format for downstream nodes.
 * Outputs QUANTITIES + CSI division codes ONLY — no rates or costs.
 * Cost estimation is handled by TR-008 (BOQ/Cost Mapper) using live market rates.
 */
export interface BOQExporterLine {
  division: string;
  csiCode: string;
  description: string;
  unit: string;
  quantity: number;
  wasteFactor: number;
  adjustedQty: number;
}

export interface BOQExporterData {
  lines: BOQExporterLine[];
  projectType: string;
  note: string;
}

export function formatBOQForExporter(
  boq: BOQQuantities,
  projectType = "residential",
): BOQExporterData {
  const lines: BOQExporterLine[] = [];

  const addLine = (
    division: string, csiCode: string, description: string,
    unit: string, quantity: number, wasteFactor: number,
  ) => {
    if (quantity <= 0) return;
    const adjustedQty = Math.round(quantity * (1 + wasteFactor) * 100) / 100;
    lines.push({
      division, csiCode, description, unit,
      quantity: Math.round(quantity * 100) / 100,
      wasteFactor, adjustedQty,
    });
  };

  // ── Division 04: Masonry ──
  if (boq.walls.exterior.volume_cum > 0) {
    addLine("04 — Masonry", "04 21 13", "Exterior brick masonry (230mm)", "cum",
      boq.walls.exterior.volume_cum, 0.05);
  }
  if (boq.walls.interior.volume_cum > 0) {
    addLine("04 — Masonry", "04 21 13", "Interior brick masonry (150mm)", "cum",
      boq.walls.interior.volume_cum, 0.05);
  }
  if (boq.walls.partition.volume_cum > 0) {
    addLine("04 — Masonry", "04 22 00", "Partition drywall (100mm)", "cum",
      boq.walls.partition.volume_cum, 0.03);
  }

  // ── Division 03: Concrete (Structural) ──
  if (boq.structural.slab_volume_cum > 0) {
    addLine("03 — Concrete", "03 30 00", "RCC slab (M25 grade)", "cum",
      boq.structural.slab_volume_cum, 0.03);
  }
  if (boq.structural.columns_volume_cum > 0) {
    addLine("03 — Concrete", "03 30 00", "RCC columns (M25 grade)", "cum",
      boq.structural.columns_volume_cum, 0.02);
  }

  // ── Division 09: Finishes — Plastering ──
  if (boq.plastering.interior_wall_area_sqm > 0) {
    addLine("09 — Finishes", "09 24 00", "Interior wall plaster (12mm cement)", "sqm",
      boq.plastering.interior_wall_area_sqm, 0.05);
  }
  if (boq.plastering.exterior_wall_area_sqm > 0) {
    addLine("09 — Finishes", "09 24 00", "Exterior wall plaster (20mm cement)", "sqm",
      boq.plastering.exterior_wall_area_sqm, 0.05);
  }
  if (boq.plastering.ceiling_area_sqm > 0) {
    addLine("09 — Finishes", "09 24 00", "Ceiling plaster (10mm POP)", "sqm",
      boq.plastering.ceiling_area_sqm, 0.03);
  }

  // ── Division 09: Finishes — Flooring ──
  if (boq.flooring.total_area_sqm > 0) {
    addLine("09 — Finishes", "09 30 00", "Vitrified tile flooring (600x600)", "sqm",
      boq.flooring.total_area_sqm, 0.08);
  }

  // ── Division 09: Finishes — Skirting ──
  if (boq.skirting.total_length_m > 0) {
    addLine("09 — Finishes", "09 65 00", "Ceramic tile skirting (100mm)", "rmt",
      boq.skirting.total_length_m, 0.05);
  }

  // ── Division 09: Finishes — Painting ──
  if (boq.painting.wall_area_sqm > 0) {
    addLine("09 — Finishes", "09 91 00", "Interior wall painting (2 coats emulsion)", "sqm",
      boq.painting.wall_area_sqm, 0.05);
  }
  if (boq.painting.ceiling_area_sqm > 0) {
    addLine("09 — Finishes", "09 91 00", "Ceiling painting (2 coats emulsion)", "sqm",
      boq.painting.ceiling_area_sqm, 0.05);
  }

  // ── Division 08: Openings — Doors ──
  for (const door of boq.doors) {
    addLine("08 — Openings", "08 11 13", `${door.description} door (${door.type}, ${door.width_mm}x${door.height_mm}mm)`, "nos",
      door.count, 0);
  }

  // ── Division 08: Openings — Windows ──
  for (const win of boq.windows) {
    addLine("08 — Openings", "08 51 13", `${win.type} window (${win.width_mm}x${win.height_mm}mm)`, "nos",
      win.count, 0);
  }

  // ── Division 05: Metals — Staircase ──
  if (boq.structural.stairs_count > 0) {
    addLine("05 — Metals", "05 51 00", "Staircase railing + treads", "nos",
      boq.structural.stairs_count, 0);
  }

  return {
    lines,
    projectType,
    note: "Quantities from geometry. Rates and costs to be applied by TR-008 (BOQ/Cost Mapper) using live market rates.",
  };
}

/**
 * Generates a table-format (rows + headers) from BOQExporterData
 * for EX-002 validation compatibility (expects top-level rows/headers).
 * Outputs quantities only — TR-008 adds rates and costs downstream.
 */
export function formatBOQAsTable(boqData: BOQExporterData): {
  headers: string[];
  rows: (string | number)[][];
} {
  const headers = [
    "Division", "CSI Code", "Description", "Unit", "Qty",
    "Waste Factor", "Adjusted Qty",
  ];
  const rows = boqData.lines.map(l => [
    l.division, l.csiCode, l.description, l.unit, l.quantity,
    l.wasteFactor, l.adjustedQty,
  ]);
  return { headers, rows };
}

// ────────────────────────────────────────────────────────────────────────────
// All-in-one output builder
// ────────────────────────────────────────────────────────────────────────────

export interface NodeOutputs {
  floorPlanProject: FloorPlanProject;
  boqReport: BOQReport;
  boqQuantities: BOQQuantities;
  roomSchedule: RoomScheduleEntry[];
  svgContent: string;
  vastuReport: VastuReport;
  codeReport: CodeReport;
  summary: {
    totalRooms: number;
    totalArea_sqm: number;
    totalWalls: number;
    totalDoors: number;
    totalWindows: number;
    vastuScore: number;
    vastuGrade: string;
    codeErrors: number;
    codeWarnings: number;
  };
}

export function buildNodeOutputs(project: FloorPlanProject): NodeOutputs {
  const floor = project.floors[0];
  if (!floor) {
    throw new Error("FloorPlanProject has no floors");
  }

  const northAngle = project.settings.north_angle_deg ?? 0;
  const projectType = project.metadata.project_type ?? "residential";

  const boqReport = generateBOQ(floor);
  const boqQuantities = computeBOQQuantities(project);
  const roomSchedule = extractRoomSchedule(project);
  const vastuReport = analyzeVastuCompliance(floor, northAngle);
  const codeReport = validateBuildingCode(floor, projectType);

  const svgContent = exportFloorToSvg(floor, project.name, {
    includeRoomFills: true,
    includeDimensions: true,
    includeGrid: false,
    displayUnit: project.settings.display_unit as "mm" | "cm" | "m",
  });

  const totalArea = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);

  return {
    floorPlanProject: project,
    boqReport,
    boqQuantities,
    roomSchedule,
    svgContent,
    vastuReport,
    codeReport,
    summary: {
      totalRooms: floor.rooms.length,
      totalArea_sqm: Math.round(totalArea * 100) / 100,
      totalWalls: floor.walls.length,
      totalDoors: floor.doors.length,
      totalWindows: floor.windows.length,
      vastuScore: vastuReport.score,
      vastuGrade: vastuReport.grade,
      codeErrors: codeReport.errors,
      codeWarnings: codeReport.warnings,
    },
  };
}
