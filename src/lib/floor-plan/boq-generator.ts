/**
 * Material Takeoff — Quantity Extraction from FloorPlanProject
 *
 * Extracts accurate material QUANTITIES from floor plan geometry:
 * walls, doors, windows, flooring, painting, structural elements.
 *
 * NOTE: This module outputs QUANTITIES ONLY — no costs or rates.
 * Cost estimation is handled by the TR-008 (BOQ/Cost Mapper) node
 * which uses live market rates, IS 1200 codes, and regional factors.
 */

import type { Floor, Wall, Door, CadWindow, Room, Column, Stair } from "@/types/floor-plan-cad";
import { wallLength } from "@/lib/floor-plan/geometry";

// ============================================================
// TYPES
// ============================================================

export interface BOQItem {
  sno: number;
  category: string;
  description: string;
  quantity: number;
  unit: string;
  remarks?: string;
}

export interface BOQReport {
  items: BOQItem[];
  generated_at: string;
  floor_name: string;
}

// ============================================================
// GENERATOR
// ============================================================

export function generateBOQ(floor: Floor): BOQReport {
  const items: BOQItem[] = [];
  let sno = 0;

  // ======== 1. MASONRY / WALLS ========
  const wallGroups: Record<string, { length: number; volume: number; area: number }> = {};

  for (const wall of floor.walls) {
    const len = wallLength(wall);
    const lenM = len / 1000;
    const thickM = wall.thickness_mm / 1000;
    const heightM = wall.height_mm / 1000;
    const vol = lenM * thickM * heightM;
    const faceArea = lenM * heightM * 2; // both sides

    const key = `${wall.type}_${wall.material}`;
    if (!wallGroups[key]) wallGroups[key] = { length: 0, volume: 0, area: 0 };
    wallGroups[key].length += lenM;
    wallGroups[key].volume += vol;
    wallGroups[key].area += faceArea;
  }

  for (const [key, data] of Object.entries(wallGroups)) {
    const [type, material] = key.split("_");
    const thickLabel = type === "exterior" ? "230mm" : "150mm";

    items.push({
      sno: ++sno,
      category: "Masonry",
      description: `${capitalize(material)} masonry — ${thickLabel} ${type} walls`,
      quantity: round(data.volume, 2),
      unit: "cum",
      remarks: `${round(data.length, 1)} m total length`,
    });
  }

  // ======== 2. PLASTERING ========
  const totalWallArea = Object.values(wallGroups).reduce((s, g) => s + g.area, 0);
  // Deduct door/window openings
  const doorOpeningArea = floor.doors.reduce((s, d) => s + (d.width_mm * d.height_mm) / 1_000_000, 0);
  const windowOpeningArea = floor.windows.reduce((s, w) => s + (w.width_mm * w.height_mm) / 1_000_000, 0);
  const plasterArea = totalWallArea - doorOpeningArea - windowOpeningArea;

  if (plasterArea > 0) {
    items.push({
      sno: ++sno,
      category: "Plastering",
      description: "Internal/external wall plastering (12mm cement mortar)",
      quantity: round(plasterArea, 1),
      unit: "sqm",
    });
  }

  // ======== 3. DOORS ========
  const doorGroups: Record<string, Door[]> = {};
  for (const door of floor.doors) {
    const key = door.type;
    if (!doorGroups[key]) doorGroups[key] = [];
    doorGroups[key].push(door);
  }

  for (const [type, doors] of Object.entries(doorGroups)) {
    if (doors.length === 0) continue;
    const avgW = doors.reduce((s, d) => s + d.width_mm, 0) / doors.length;
    const avgH = doors.reduce((s, d) => s + d.height_mm, 0) / doors.length;

    items.push({
      sno: ++sno,
      category: "Doors",
      description: `${capitalize(type.replace(/_/g, " "))} door (${Math.round(avgW)}x${Math.round(avgH)}mm)`,
      quantity: doors.length,
      unit: "nos",
    });
  }

  // Door frame running length
  const totalDoorFrame = floor.doors.reduce(
    (s, d) => s + (d.width_mm + d.height_mm * 2) / 1000,
    0
  );
  if (totalDoorFrame > 0) {
    items.push({
      sno: ++sno,
      category: "Doors",
      description: "Door frame (teak/sal wood, 100x75mm section)",
      quantity: round(totalDoorFrame, 1),
      unit: "rm",
    });
  }

  // ======== 4. WINDOWS ========
  const windowGroups: Record<string, CadWindow[]> = {};
  for (const win of floor.windows) {
    const key = win.type;
    if (!windowGroups[key]) windowGroups[key] = [];
    windowGroups[key].push(win);
  }

  for (const [type, wins] of Object.entries(windowGroups)) {
    if (wins.length === 0) continue;
    items.push({
      sno: ++sno,
      category: "Windows",
      description: `${capitalize(type)} window (avg ${Math.round(wins[0].width_mm)}x${Math.round(wins[0].height_mm)}mm)`,
      quantity: wins.length,
      unit: "nos",
    });
  }

  // Total glass area
  const totalGlassArea = floor.windows.reduce(
    (s, w) => s + (w.width_mm * w.height_mm) / 1_000_000,
    0
  );
  if (totalGlassArea > 0) {
    items.push({
      sno: ++sno,
      category: "Windows",
      description: "Glass glazing (double-pane, 6mm+6mm)",
      quantity: round(totalGlassArea, 2),
      unit: "sqm",
    });
  }

  // ======== 5. FLOORING ========
  const flooringGroups: Record<string, { rooms: string[]; area: number }> = {
    tile: { rooms: [], area: 0 },
    marble: { rooms: [], area: 0 },
    wood: { rooms: [], area: 0 },
  };

  for (const room of floor.rooms) {
    const floorType = getFlooringType(room.type);
    flooringGroups[floorType].rooms.push(room.name);
    flooringGroups[floorType].area += room.area_sqm;
  }

  for (const [type, data] of Object.entries(flooringGroups)) {
    if (data.area <= 0) continue;

    items.push({
      sno: ++sno,
      category: "Flooring",
      description: `${capitalize(type)} flooring`,
      quantity: round(data.area, 1),
      unit: "sqm",
      remarks: data.rooms.join(", "),
    });
  }

  // Skirting — deduct each door opening once per room side it faces
  const totalSkirting = floor.rooms.reduce((s, r) => {
    const roomWallIds = new Set(r.wall_ids ?? []);
    const doorWidths = floor.doors
      .filter((d) => roomWallIds.has(d.wall_id))
      .reduce((ds, d) => ds + d.width_mm / 1000, 0);
    const perimeter = (r.perimeter_mm ?? 0) / 1000;
    return s + Math.max(0, perimeter - doorWidths);
  }, 0);

  if (totalSkirting > 0) {
    items.push({
      sno: ++sno,
      category: "Flooring",
      description: "Skirting (100mm height, matching floor tile)",
      quantity: round(totalSkirting, 1),
      unit: "rm",
    });
  }

  // ======== 6. PAINTING ========
  const paintWallArea = plasterArea; // same deduction
  const paintCeilingArea = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);

  if (paintWallArea > 0) {
    items.push({
      sno: ++sno,
      category: "Painting",
      description: "Wall painting (2 coats emulsion over primer)",
      quantity: round(paintWallArea, 1),
      unit: "sqm",
    });
  }

  if (paintCeilingArea > 0) {
    items.push({
      sno: ++sno,
      category: "Painting",
      description: "Ceiling painting (2 coats emulsion)",
      quantity: round(paintCeilingArea, 1),
      unit: "sqm",
    });
  }

  // ======== 7. WATERPROOFING (bathrooms) ========
  const bathrooms = floor.rooms.filter((r) =>
    ["bathroom", "toilet", "wc", "utility"].includes(r.type)
  );
  const wpArea = bathrooms.reduce((s, r) => s + r.area_sqm, 0);
  if (wpArea > 0) {
    items.push({
      sno: ++sno,
      category: "Waterproofing",
      description: "Bathroom waterproofing (APP membrane + tile bed)",
      quantity: round(wpArea, 1),
      unit: "sqm",
    });
  }

  // ======== 8. STRUCTURAL (columns, slab) ========
  for (const col of floor.columns) {
    const heightM = floor.floor_to_floor_height_mm / 1000;
    let vol: number;
    if (col.type === "circular") {
      const r = ((col.diameter_mm ?? 300) / 2) / 1000;
      vol = Math.PI * r * r * heightM;
    } else {
      const w = (col.width_mm ?? 300) / 1000;
      const d = (col.depth_mm ?? 300) / 1000;
      vol = w * d * heightM;
    }

    items.push({
      sno: ++sno,
      category: "Structural",
      description: `RCC Column ${col.grid_ref ? `(${col.grid_ref})` : ""} — ${col.type}`,
      quantity: round(vol, 3),
      unit: "cum",
    });
  }

  // Slab
  const slabArea = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);
  const slabVol = slabArea * (floor.slab_thickness_mm / 1000);
  if (slabVol > 0) {
    items.push({
      sno: ++sno,
      category: "Structural",
      description: `RCC Slab (${floor.slab_thickness_mm}mm thick)`,
      quantity: round(slabVol, 2),
      unit: "cum",
    });
  }

  // ======== 9. STAIRS ========
  for (const stair of floor.stairs) {
    const widthM = stair.width_mm / 1000;
    const treadM = stair.tread_depth_mm / 1000;
    const riserM = stair.riser_height_mm / 1000;
    const waistThick = 0.15; // 150mm waist slab
    // Step triangle + inclined waist slab (corrected from horizontal projection)
    const inclineLen = Math.sqrt(treadM * treadM + riserM * riserM);
    const vol = stair.num_risers * widthM * (treadM * riserM / 2 + inclineLen * waistThick);

    items.push({
      sno: ++sno,
      category: "Structural",
      description: `RCC Staircase (${stair.type}, ${stair.num_risers} risers)`,
      quantity: round(vol, 3),
      unit: "cum",
    });
  }

  return {
    items,
    generated_at: new Date().toISOString(),
    floor_name: floor.name,
  };
}

// ============================================================
// EXPORT
// ============================================================

export function exportBOQAsCSV(report: BOQReport): void {
  const header = "S.No,Category,Description,Quantity,Unit,Remarks\n";
  const esc = (s: string) => s.replace(/"/g, '""');
  const rows = report.items.map((i) =>
    `${i.sno},"${esc(i.category)}","${esc(i.description)}",${i.quantity},"${esc(i.unit)}","${esc(i.remarks ?? "")}"`
  ).join("\n");

  const csv = header + rows;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MaterialTakeoff_${report.floor_name.replace(/\s/g, "_")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
// HELPERS
// ============================================================

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function getFlooringType(roomType: string): "tile" | "marble" | "wood" {
  if (["bathroom", "toilet", "wc", "kitchen", "utility", "laundry"].includes(roomType)) return "tile";
  if (["living_room", "dining_room", "foyer", "lobby"].includes(roomType)) return "marble";
  if (["bedroom", "master_bedroom", "guest_bedroom", "study", "home_office"].includes(roomType)) return "wood";
  return "tile";
}
