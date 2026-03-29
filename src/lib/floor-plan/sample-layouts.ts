/**
 * Pre-built sample floor plan layouts for different BHK configurations.
 * Used as fallback when AI generation is unavailable.
 * All coordinates in meters, Y-down (top-left origin) — same as GN-004 output.
 * Rooms tile perfectly within the footprint (zero gaps, zero overlaps).
 */

import type { FloorPlanGeometry } from "@/types/floor-plan";
import { convertGeometryToProject } from "./pipeline-adapter";
import type { FloorPlanProject } from "@/types/floor-plan-cad";

// ============================================================
// 1 BHK — 50 sqm (7.5m × 6.7m)
// ============================================================
const SAMPLE_1BHK: FloorPlanGeometry = {
  footprint: { width: 7.5, depth: 6.7 },
  wallHeight: 3.0,
  walls: [
    { start: [0, 0], end: [7.5, 0], thickness: 0.23, type: "exterior" },
    { start: [7.5, 0], end: [7.5, 6.7], thickness: 0.23, type: "exterior" },
    { start: [7.5, 6.7], end: [0, 6.7], thickness: 0.23, type: "exterior" },
    { start: [0, 6.7], end: [0, 0], thickness: 0.23, type: "exterior" },
    // Interior walls
    { start: [4.2, 0], end: [4.2, 4.0], thickness: 0.15, type: "interior" },
    { start: [0, 4.0], end: [7.5, 4.0], thickness: 0.15, type: "interior" },
    { start: [4.5, 4.0], end: [4.5, 6.7], thickness: 0.15, type: "interior" },
  ],
  doors: [
    { position: [3.0, 6.7], width: 1.05, wallId: 2, type: "single" },
    { position: [4.2, 2.0], width: 0.9, wallId: 4, type: "single" },
    { position: [2.0, 4.0], width: 0.9, wallId: 5, type: "single" },
    { position: [6.0, 4.0], width: 0.75, wallId: 5, type: "single" },
    { position: [4.5, 5.5], width: 0.9, wallId: 6, type: "single" },
  ],
  windows: [
    { position: [2.0, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [5.8, 0], width: 1.2, height: 1.2, sillHeight: 0.9 },
    { position: [0, 2.0], width: 1.2, height: 1.2, sillHeight: 0.9 },
    { position: [7.5, 2.0], width: 1.2, height: 1.2, sillHeight: 0.9 },
    { position: [2.0, 6.7], width: 0.6, height: 0.45, sillHeight: 1.8 },
  ],
  rooms: [
    { name: "Living + Dining", type: "living", x: 0, y: 0, width: 4.2, depth: 4.0, center: [2.1, 2.0] },
    { name: "Bedroom",         type: "bedroom", x: 4.2, y: 0, width: 3.3, depth: 4.0, center: [5.85, 2.0] },
    { name: "Kitchen",         type: "kitchen", x: 0, y: 4.0, width: 4.5, depth: 2.7, center: [2.25, 5.35] },
    { name: "Bathroom",        type: "bathroom", x: 4.5, y: 4.0, width: 3.0, depth: 2.7, center: [6.0, 5.35] },
  ],
};

// ============================================================
// 2 BHK — 90 sqm (10.0m × 9.0m)
// Top: Master(4.5×4.5) + Bed2(3.5×4.5) + Bath1(2.0×2.0) + Bath2(2.0×2.5)
// Bot: Living+Dining(6.0×4.5) + Kitchen(4.0×2.5) + Corridor(4.0×2.0)
// ============================================================
const SAMPLE_2BHK: FloorPlanGeometry = {
  footprint: { width: 10.0, depth: 9.0 },
  wallHeight: 3.0,
  walls: [
    { start: [0, 0], end: [10.0, 0], thickness: 0.23, type: "exterior" },
    { start: [10.0, 0], end: [10.0, 9.0], thickness: 0.23, type: "exterior" },
    { start: [10.0, 9.0], end: [0, 9.0], thickness: 0.23, type: "exterior" },
    { start: [0, 9.0], end: [0, 0], thickness: 0.23, type: "exterior" },
    // Horizontal main split
    { start: [0, 4.5], end: [10.0, 4.5], thickness: 0.15, type: "interior" },
    // Top row splits
    { start: [4.5, 0], end: [4.5, 4.5], thickness: 0.15, type: "interior" },
    { start: [8.0, 0], end: [8.0, 4.5], thickness: 0.15, type: "interior" },
    { start: [8.0, 2.0], end: [10.0, 2.0], thickness: 0.15, type: "interior" },
    // Bottom row splits
    { start: [6.0, 4.5], end: [6.0, 9.0], thickness: 0.15, type: "interior" },
    { start: [6.0, 7.0], end: [10.0, 7.0], thickness: 0.15, type: "interior" },
  ],
  doors: [
    { position: [3.0, 9.0], width: 1.05, wallId: 2, type: "single" },
    { position: [2.0, 4.5], width: 0.9, wallId: 4, type: "single" },
    { position: [5.5, 4.5], width: 0.9, wallId: 4, type: "single" },
    { position: [8.0, 1.0], width: 0.75, wallId: 6, type: "single" },
    { position: [8.0, 3.0], width: 0.75, wallId: 6, type: "single" },
    { position: [6.0, 5.5], width: 0.9, wallId: 8, type: "single" },
    { position: [8.0, 7.0], width: 0.9, wallId: 9, type: "single" },
  ],
  windows: [
    { position: [1.5, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [6.0, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [0, 2.0], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [0, 6.5], width: 1.2, height: 1.2, sillHeight: 0.9 },
    { position: [10.0, 1.0], width: 0.6, height: 0.45, sillHeight: 1.8 },
    { position: [2.0, 9.0], width: 1.5, height: 1.2, sillHeight: 0.9 },
  ],
  rooms: [
    { name: "Master Bedroom", type: "bedroom",  x: 0,   y: 0,   width: 4.5, depth: 4.5, center: [2.25, 2.25] },
    { name: "Bedroom 2",      type: "bedroom",  x: 4.5, y: 0,   width: 3.5, depth: 4.5, center: [6.25, 2.25] },
    { name: "Bathroom 1",     type: "bathroom", x: 8.0, y: 0,   width: 2.0, depth: 2.0, center: [9.0, 1.0] },
    { name: "Bathroom 2",     type: "bathroom", x: 8.0, y: 2.0, width: 2.0, depth: 2.5, center: [9.0, 3.25] },
    { name: "Living + Dining",type: "living",   x: 0,   y: 4.5, width: 6.0, depth: 4.5, center: [3.0, 6.75] },
    { name: "Kitchen",        type: "kitchen",  x: 6.0, y: 4.5, width: 4.0, depth: 2.5, center: [8.0, 5.75] },
    { name: "Corridor",       type: "hallway",  x: 6.0, y: 7.0, width: 4.0, depth: 2.0, center: [8.0, 8.0] },
  ],
};

// ============================================================
// 3 BHK — 140 sqm (14.0m × 10.0m)
// ============================================================
const SAMPLE_3BHK: FloorPlanGeometry = {
  footprint: { width: 14.0, depth: 10.0 },
  wallHeight: 3.0,
  walls: [
    { start: [0, 0], end: [14.0, 0], thickness: 0.23, type: "exterior" },
    { start: [14.0, 0], end: [14.0, 10.0], thickness: 0.23, type: "exterior" },
    { start: [14.0, 10.0], end: [0, 10.0], thickness: 0.23, type: "exterior" },
    { start: [0, 10.0], end: [0, 0], thickness: 0.23, type: "exterior" },
    // Horizontal splits
    { start: [0, 5.5], end: [14.0, 5.5], thickness: 0.15, type: "interior" },
    // Top row vertical splits
    { start: [5.0, 0], end: [5.0, 5.5], thickness: 0.15, type: "interior" },
    { start: [10.0, 0], end: [10.0, 5.5], thickness: 0.15, type: "interior" },
    { start: [12.0, 0], end: [12.0, 5.5], thickness: 0.15, type: "interior" },
    // Bottom row vertical splits
    { start: [6.0, 5.5], end: [6.0, 10.0], thickness: 0.15, type: "interior" },
    { start: [10.0, 5.5], end: [10.0, 10.0], thickness: 0.15, type: "interior" },
    { start: [12.0, 5.5], end: [12.0, 10.0], thickness: 0.15, type: "interior" },
  ],
  doors: [
    { position: [3.0, 10.0], width: 1.05, wallId: 2, type: "single" },
    { position: [5.0, 2.5], width: 0.9, wallId: 5, type: "single" },
    { position: [10.0, 2.5], width: 0.9, wallId: 6, type: "single" },
    { position: [12.0, 1.5], width: 0.75, wallId: 7, type: "single" },
    { position: [12.0, 3.5], width: 0.75, wallId: 7, type: "single" },
    { position: [3.0, 5.5], width: 0.9, wallId: 4, type: "single" },
    { position: [8.0, 5.5], width: 0.9, wallId: 4, type: "single" },
    { position: [10.0, 7.5], width: 0.9, wallId: 9, type: "single" },
    { position: [12.0, 7.5], width: 0.75, wallId: 10, type: "single" },
  ],
  windows: [
    { position: [2.0, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [7.0, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [0, 2.5], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [0, 7.5], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [14.0, 2.5], width: 1.2, height: 1.2, sillHeight: 0.9 },
    { position: [14.0, 7.5], width: 1.2, height: 1.2, sillHeight: 0.9 },
    { position: [8.0, 10.0], width: 1.5, height: 1.2, sillHeight: 0.9 },
  ],
  rooms: [
    { name: "Master Bedroom", type: "bedroom",  x: 0,    y: 0,   width: 5.0, depth: 5.5, center: [2.5, 2.75] },
    { name: "Bedroom 2",      type: "bedroom",  x: 5.0,  y: 0,   width: 5.0, depth: 5.5, center: [7.5, 2.75] },
    { name: "Bedroom 3",      type: "bedroom",  x: 10.0, y: 0,   width: 2.0, depth: 5.5, center: [11.0, 2.75] },
    { name: "Bathroom 1",     type: "bathroom", x: 12.0, y: 0,   width: 2.0, depth: 2.5, center: [13.0, 1.25] },
    { name: "Bathroom 2",     type: "bathroom", x: 12.0, y: 2.5, width: 2.0, depth: 3.0, center: [13.0, 4.0] },
    { name: "Living + Dining",type: "living",   x: 0,    y: 5.5, width: 6.0, depth: 4.5, center: [3.0, 7.75] },
    { name: "Kitchen",        type: "kitchen",  x: 6.0,  y: 5.5, width: 4.0, depth: 4.5, center: [8.0, 7.75] },
    { name: "Corridor",       type: "hallway",  x: 10.0, y: 5.5, width: 2.0, depth: 4.5, center: [11.0, 7.75] },
    { name: "Bathroom 3",     type: "bathroom", x: 12.0, y: 5.5, width: 2.0, depth: 4.5, center: [13.0, 7.75] },
  ],
};

// ============================================================
// 4 BHK — 200 sqm (16.0m × 12.5m)
// ============================================================
const SAMPLE_4BHK: FloorPlanGeometry = {
  footprint: { width: 16.0, depth: 12.5 },
  wallHeight: 3.0,
  walls: [
    { start: [0, 0], end: [16.0, 0], thickness: 0.23, type: "exterior" },
    { start: [16.0, 0], end: [16.0, 12.5], thickness: 0.23, type: "exterior" },
    { start: [16.0, 12.5], end: [0, 12.5], thickness: 0.23, type: "exterior" },
    { start: [0, 12.5], end: [0, 0], thickness: 0.23, type: "exterior" },
    // Horizontal main split
    { start: [0, 6.5], end: [16.0, 6.5], thickness: 0.15, type: "interior" },
    // Top row splits
    { start: [5.5, 0], end: [5.5, 6.5], thickness: 0.15, type: "interior" },
    { start: [11.0, 0], end: [11.0, 6.5], thickness: 0.15, type: "interior" },
    { start: [13.5, 0], end: [13.5, 6.5], thickness: 0.15, type: "interior" },
    // Bottom row splits
    { start: [6.5, 6.5], end: [6.5, 12.5], thickness: 0.15, type: "interior" },
    { start: [11.5, 6.5], end: [11.5, 12.5], thickness: 0.15, type: "interior" },
    { start: [14.0, 6.5], end: [14.0, 12.5], thickness: 0.15, type: "interior" },
  ],
  doors: [
    { position: [3.0, 12.5], width: 1.05, wallId: 2, type: "single" },
    { position: [5.5, 3.0], width: 0.9, wallId: 5, type: "single" },
    { position: [11.0, 3.0], width: 0.9, wallId: 6, type: "single" },
    { position: [13.5, 1.5], width: 0.75, wallId: 7, type: "single" },
    { position: [13.5, 4.5], width: 0.75, wallId: 7, type: "single" },
    { position: [3.0, 6.5], width: 0.9, wallId: 4, type: "single" },
    { position: [8.5, 6.5], width: 0.9, wallId: 4, type: "single" },
    { position: [6.5, 9.0], width: 0.9, wallId: 8, type: "single" },
    { position: [11.5, 9.0], width: 0.9, wallId: 9, type: "single" },
    { position: [14.0, 9.0], width: 0.75, wallId: 10, type: "single" },
  ],
  windows: [
    { position: [2.5, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [8.0, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [0, 3.0], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [0, 9.0], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [16.0, 3.0], width: 1.2, height: 1.2, sillHeight: 0.9 },
    { position: [16.0, 9.0], width: 1.2, height: 1.2, sillHeight: 0.9 },
    { position: [3.0, 12.5], width: 1.5, height: 1.2, sillHeight: 0.9 },
    { position: [9.0, 12.5], width: 1.5, height: 1.2, sillHeight: 0.9 },
  ],
  rooms: [
    { name: "Master Bedroom", type: "bedroom",  x: 0,    y: 0,   width: 5.5,  depth: 6.5, center: [2.75, 3.25] },
    { name: "Bedroom 2",      type: "bedroom",  x: 5.5,  y: 0,   width: 5.5,  depth: 6.5, center: [8.25, 3.25] },
    { name: "Bathroom 1",     type: "bathroom", x: 11.0, y: 0,   width: 2.5,  depth: 3.0, center: [12.25, 1.5] },
    { name: "Bathroom 2",     type: "bathroom", x: 13.5, y: 0,   width: 2.5,  depth: 3.0, center: [14.75, 1.5] },
    { name: "Bedroom 3",      type: "bedroom",  x: 11.0, y: 3.0, width: 2.5,  depth: 3.5, center: [12.25, 4.75] },
    { name: "Bedroom 4",      type: "bedroom",  x: 13.5, y: 3.0, width: 2.5,  depth: 3.5, center: [14.75, 4.75] },
    { name: "Living + Dining",type: "living",   x: 0,    y: 6.5, width: 6.5,  depth: 6.0, center: [3.25, 9.5] },
    { name: "Kitchen",        type: "kitchen",  x: 6.5,  y: 6.5, width: 5.0,  depth: 6.0, center: [9.0, 9.5] },
    { name: "Corridor",       type: "hallway",  x: 11.5, y: 6.5, width: 2.5,  depth: 6.0, center: [12.75, 9.5] },
    { name: "Bathroom 3",     type: "bathroom", x: 14.0, y: 6.5, width: 2.0,  depth: 3.0, center: [15.0, 8.0] },
    { name: "Utility",        type: "utility",  x: 14.0, y: 9.5, width: 2.0,  depth: 3.0, center: [15.0, 11.0] },
  ],
};

// ============================================================
// EXPORTS
// ============================================================

const SAMPLES: Record<number, FloorPlanGeometry> = {
  1: SAMPLE_1BHK,
  2: SAMPLE_2BHK,
  3: SAMPLE_3BHK,
  4: SAMPLE_4BHK,
};

/**
 * Parse a prompt to extract the BHK count.
 */
export function parseBhkFromPrompt(prompt: string): number {
  const p = prompt.toLowerCase().trim();
  const match = p.match(/(\d)\s*bhk/);
  if (match) return parseInt(match[1], 10);
  if (p.includes("studio") || p.includes("1 room")) return 1;
  return 2; // default
}

/**
 * Get sample FloorPlanGeometry for a given BHK count.
 */
export function getSampleGeometry(bhk: number): FloorPlanGeometry {
  return SAMPLES[Math.min(4, Math.max(1, bhk))] ?? SAMPLES[2];
}

/**
 * Get a sample FloorPlanProject for a given prompt.
 * Used as fallback when AI generation is unavailable.
 */
export function getSampleProjectForPrompt(prompt: string): FloorPlanProject {
  const bhk = parseBhkFromPrompt(prompt);
  const geometry = getSampleGeometry(bhk);
  const name = `Sample ${bhk}BHK Layout`;
  return convertGeometryToProject(geometry, name, prompt);
}
