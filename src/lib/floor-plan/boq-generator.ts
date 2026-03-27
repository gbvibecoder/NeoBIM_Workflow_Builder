/**
 * BOQ Generator — Bill of Quantities from FloorPlanProject
 *
 * Computes accurate material quantities directly from floor plan geometry:
 * walls, doors, windows, flooring, painting, structural elements.
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
  rate_inr?: number;
  amount_inr?: number;
  remarks?: string;
}

export interface BOQReport {
  items: BOQItem[];
  total_estimated_cost: number;
  generated_at: string;
  floor_name: string;
}

// ============================================================
// APPROXIMATE RATES (INR, 2024 Pune metro)
// ============================================================

const RATES: Record<string, number> = {
  "brick_masonry_cum": 6500,
  "concrete_masonry_cum": 8500,
  "plastering_sqm": 350,
  "painting_sqm": 180,
  "flooring_tile_sqm": 1200,
  "flooring_marble_sqm": 2800,
  "flooring_wood_sqm": 3500,
  "skirting_rm": 250,
  "door_wooden_nos": 12000,
  "door_main_nos": 25000,
  "door_bath_nos": 8000,
  "window_casement_nos": 8000,
  "window_sliding_nos": 6500,
  "window_awning_nos": 4500,
  "column_concrete_cum": 9500,
  "slab_concrete_cum": 8000,
  "stair_concrete_cum": 9000,
  "waterproofing_sqm": 600,
  "ceiling_sqm": 450,
};

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
    const rate = material === "concrete" ? RATES.concrete_masonry_cum : RATES.brick_masonry_cum;

    items.push({
      sno: ++sno,
      category: "Masonry",
      description: `${capitalize(material)} masonry — ${thickLabel} ${type} walls`,
      quantity: round(data.volume, 2),
      unit: "cum",
      rate_inr: rate,
      amount_inr: round(data.volume * rate, 0),
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
      rate_inr: RATES.plastering_sqm,
      amount_inr: round(plasterArea * RATES.plastering_sqm, 0),
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
    const rate = type === "main_entrance" ? RATES.door_main_nos
      : type.includes("bath") ? RATES.door_bath_nos
      : RATES.door_wooden_nos;
    const avgW = doors.reduce((s, d) => s + d.width_mm, 0) / doors.length;
    const avgH = doors.reduce((s, d) => s + d.height_mm, 0) / doors.length;

    items.push({
      sno: ++sno,
      category: "Doors",
      description: `${capitalize(type.replace(/_/g, " "))} door (${Math.round(avgW)}x${Math.round(avgH)}mm)`,
      quantity: doors.length,
      unit: "nos",
      rate_inr: rate,
      amount_inr: round(doors.length * rate, 0),
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
      rate_inr: 850,
      amount_inr: round(totalDoorFrame * 850, 0),
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
    const rate = type === "sliding" ? RATES.window_sliding_nos
      : type === "awning" ? RATES.window_awning_nos
      : RATES.window_casement_nos;

    items.push({
      sno: ++sno,
      category: "Windows",
      description: `${capitalize(type)} window (avg ${Math.round(wins[0].width_mm)}x${Math.round(wins[0].height_mm)}mm)`,
      quantity: wins.length,
      unit: "nos",
      rate_inr: rate,
      amount_inr: round(wins.length * rate, 0),
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
      rate_inr: 2500,
      amount_inr: round(totalGlassArea * 2500, 0),
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
    const rateKey = `flooring_${type}_sqm` as keyof typeof RATES;
    const rate = RATES[rateKey] ?? 1200;

    items.push({
      sno: ++sno,
      category: "Flooring",
      description: `${capitalize(type)} flooring`,
      quantity: round(data.area, 1),
      unit: "sqm",
      rate_inr: rate,
      amount_inr: round(data.area * rate, 0),
      remarks: data.rooms.join(", "),
    });
  }

  // Skirting
  const totalSkirting = floor.rooms.reduce((s, r) => {
    // Perimeter minus door widths on walls
    const doorWidths = floor.doors
      .filter((d) => r.wall_ids.includes(d.wall_id))
      .reduce((ds, d) => ds + d.width_mm / 1000, 0);
    return s + r.perimeter_mm / 1000 - doorWidths;
  }, 0);

  if (totalSkirting > 0) {
    items.push({
      sno: ++sno,
      category: "Flooring",
      description: "Skirting (100mm height, matching floor tile)",
      quantity: round(totalSkirting, 1),
      unit: "rm",
      rate_inr: RATES.skirting_rm,
      amount_inr: round(totalSkirting * RATES.skirting_rm, 0),
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
      rate_inr: RATES.painting_sqm,
      amount_inr: round(paintWallArea * RATES.painting_sqm, 0),
    });
  }

  if (paintCeilingArea > 0) {
    items.push({
      sno: ++sno,
      category: "Painting",
      description: "Ceiling painting (2 coats emulsion)",
      quantity: round(paintCeilingArea, 1),
      unit: "sqm",
      rate_inr: RATES.ceiling_sqm,
      amount_inr: round(paintCeilingArea * RATES.ceiling_sqm, 0),
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
      rate_inr: RATES.waterproofing_sqm,
      amount_inr: round(wpArea * RATES.waterproofing_sqm, 0),
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
      rate_inr: RATES.column_concrete_cum,
      amount_inr: round(vol * RATES.column_concrete_cum, 0),
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
      rate_inr: RATES.slab_concrete_cum,
      amount_inr: round(slabVol * RATES.slab_concrete_cum, 0),
    });
  }

  // ======== 9. STAIRS ========
  for (const stair of floor.stairs) {
    const widthM = stair.width_mm / 1000;
    const treadM = stair.tread_depth_mm / 1000;
    const riserM = stair.riser_height_mm / 1000;
    const waistThick = 0.15; // 150mm waist slab
    const vol = stair.num_risers * treadM * widthM * (riserM / 2 + waistThick);

    items.push({
      sno: ++sno,
      category: "Structural",
      description: `RCC Staircase (${stair.type}, ${stair.num_risers} risers)`,
      quantity: round(vol, 3),
      unit: "cum",
      rate_inr: RATES.stair_concrete_cum,
      amount_inr: round(vol * RATES.stair_concrete_cum, 0),
    });
  }

  // Total
  const total = items.reduce((s, i) => s + (i.amount_inr ?? 0), 0);

  return {
    items,
    total_estimated_cost: total,
    generated_at: new Date().toISOString(),
    floor_name: floor.name,
  };
}

// ============================================================
// EXPORT
// ============================================================

export function exportBOQAsCSV(report: BOQReport): void {
  const header = "S.No,Category,Description,Quantity,Unit,Rate (INR),Amount (INR),Remarks\n";
  const rows = report.items.map((i) =>
    `${i.sno},"${i.category}","${i.description}",${i.quantity},"${i.unit}",${i.rate_inr ?? ""},${i.amount_inr ?? ""},"${i.remarks ?? ""}"`
  ).join("\n");
  const footer = `\n,,TOTAL,,,,${report.total_estimated_cost},`;

  const csv = header + rows + footer;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `BOQ_${report.floor_name.replace(/\s/g, "_")}.csv`;
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
