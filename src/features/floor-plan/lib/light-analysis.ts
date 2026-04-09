/**
 * Natural Light Analysis
 *
 * Analyzes daylight exposure per room based on:
 * - Window area and orientation (compass direction)
 * - Room depth relative to window wall
 * - Sun exposure for Indian latitudes (northern hemisphere)
 */

import type { Floor, Room, Wall, CadWindow, Point } from "@/types/floor-plan-cad";
import { wallLength, wallAngle, polygonBounds } from "@/features/floor-plan/lib/geometry";

// ============================================================
// TYPES
// ============================================================

export type LightGrade = "excellent" | "good" | "fair" | "poor";

export interface RoomLightScore {
  roomId: string;
  roomName: string;
  score: number; // 0-100
  grade: LightGrade;
  totalWindowArea_sqm: number;
  windowToFloorRatio: number;
  dominantOrientation: string; // "N", "S", "E", "W", "NE", etc.
  orientationScore: number;
  depthScore: number;
  details: string;
}

export interface LightAnalysisResult {
  rooms: RoomLightScore[];
  averageScore: number;
  averageGrade: LightGrade;
  recommendations: LightRecommendation[];
}

export interface LightRecommendation {
  roomId: string;
  roomName: string;
  message: string;
  severity: "info" | "warning";
}

// ============================================================
// ORIENTATION SCORING (Northern Hemisphere — India ~8-37°N)
// ============================================================

/**
 * Sun exposure multiplier by wall orientation.
 * South-facing walls receive maximum sunlight in northern hemisphere.
 * East gets morning sun, West gets harsh afternoon sun.
 */
const ORIENTATION_SCORE: Record<string, number> = {
  S:  1.0,   // Best: maximum winter sun, indirect summer sun
  SE: 0.95,  // Excellent: morning + midday sun
  SW: 0.80,  // Good but hot afternoon sun in summer
  E:  0.85,  // Good morning light
  W:  0.60,  // Harsh afternoon glare
  NE: 0.70,  // Some morning light
  NW: 0.50,  // Limited, mostly afternoon
  N:  0.40,  // Least direct sunlight (diffused)
};

// ============================================================
// WALL ORIENTATION DETECTION
// ============================================================

/**
 * Determine compass direction a wall faces (its outward normal).
 * Uses the north_angle_deg setting to rotate.
 */
export function getWallOrientation(wall: Wall, northAngleDeg: number): string {
  // Wall angle in degrees (0 = horizontal right)
  const angleDeg = wallAngle(wall) * (180 / Math.PI);

  // The outward normal of an exterior wall is perpendicular to the wall
  // For a wall running E-W (angle ~0°), the normal faces N or S
  // We determine "outward" by convention — we'll use perpendicular left
  const normalAngle = angleDeg + 90;

  // Apply north rotation
  const compassAngle = ((normalAngle - northAngleDeg) % 360 + 360) % 360;

  // Convert angle to compass direction
  if (compassAngle >= 337.5 || compassAngle < 22.5) return "N";
  if (compassAngle >= 22.5 && compassAngle < 67.5) return "NE";
  if (compassAngle >= 67.5 && compassAngle < 112.5) return "E";
  if (compassAngle >= 112.5 && compassAngle < 157.5) return "SE";
  if (compassAngle >= 157.5 && compassAngle < 202.5) return "S";
  if (compassAngle >= 202.5 && compassAngle < 247.5) return "SW";
  if (compassAngle >= 247.5 && compassAngle < 292.5) return "W";
  return "NW";
}

// ============================================================
// DEPTH SCORE
// ============================================================

/**
 * Daylight penetration rule of thumb: effective depth = 2× window head height.
 * For typical 1.2m window at 0.9m sill → head at 2.1m → penetration ~4.2m.
 * If room is deeper than this, interior areas get much less light.
 */
function computeDepthScore(room: Room, windowWalls: Wall[]): number {
  if (windowWalls.length === 0) return 0;

  const bounds = polygonBounds(room.boundary.points);

  // Find which dimension is "depth" (perpendicular to window wall)
  // Use the shorter dimension of the room for simplicity
  const roomDepth = Math.min(bounds.width, bounds.height) / 1000; // to meters
  const maxPenetration = 4.2; // meters (typical residential)

  if (roomDepth <= maxPenetration) return 1.0;
  if (roomDepth <= maxPenetration * 1.5) return 0.7;
  if (roomDepth <= maxPenetration * 2) return 0.4;
  return 0.2;
}

// ============================================================
// MAIN ANALYSIS
// ============================================================

export function analyzeNaturalLight(
  floor: Floor,
  northAngleDeg: number = 0,
): LightAnalysisResult {
  const roomScores: RoomLightScore[] = [];
  const recommendations: LightRecommendation[] = [];

  for (const room of floor.rooms) {
    // Skip non-habitable rooms
    const nonHabitable = ["corridor", "lobby", "foyer", "staircase", "elevator", "shaft", "fire_escape", "parking", "garage"];
    if (nonHabitable.includes(room.type)) continue;

    const roomWallIds = new Set(room.wall_ids);

    // Find exterior walls for this room
    const exteriorWalls = floor.walls.filter(
      (w) => w.type === "exterior" && (roomWallIds.has(w.id) || w.left_room_id === room.id || w.right_room_id === room.id)
    );

    // Find windows on this room's walls
    const roomWindows = floor.windows.filter((w) => {
      const wall = floor.walls.find((wl) => wl.id === w.wall_id);
      return wall && (roomWallIds.has(wall.id) || wall.left_room_id === room.id || wall.right_room_id === room.id);
    });

    // Calculate total window area
    const totalWindowArea = roomWindows.reduce(
      (sum, w) => sum + (w.width_mm * w.height_mm) / 1_000_000, 0
    );
    const windowToFloorRatio = room.area_sqm > 0 ? totalWindowArea / room.area_sqm : 0;

    // Calculate orientation-weighted score
    let orientationTotal = 0;
    let orientationWeight = 0;
    const orientationCounts: Record<string, number> = {};

    for (const win of roomWindows) {
      const wall = floor.walls.find((w) => w.id === win.wall_id);
      if (!wall) continue;

      const orientation = getWallOrientation(wall, northAngleDeg);
      const winArea = (win.width_mm * win.height_mm) / 1_000_000;
      const oScore = ORIENTATION_SCORE[orientation] ?? 0.5;

      orientationTotal += oScore * winArea;
      orientationWeight += winArea;
      orientationCounts[orientation] = (orientationCounts[orientation] ?? 0) + winArea;
    }

    const orientationScore = orientationWeight > 0 ? orientationTotal / orientationWeight : 0;

    // Find dominant orientation
    let dominantOrientation = "None";
    let maxArea = 0;
    for (const [dir, area] of Object.entries(orientationCounts)) {
      if (area > maxArea) {
        maxArea = area;
        dominantOrientation = dir;
      }
    }

    // Depth score
    const depthScore = computeDepthScore(room, exteriorWalls);

    // Composite score: 40% window ratio, 35% orientation, 25% depth
    const ratioScore = Math.min(1.0, windowToFloorRatio / 0.2); // 20% ratio = perfect
    const compositeScore = Math.round(
      (ratioScore * 40 + orientationScore * 35 + depthScore * 25)
    );

    const grade: LightGrade =
      compositeScore >= 75 ? "excellent" :
        compositeScore >= 55 ? "good" :
          compositeScore >= 35 ? "fair" : "poor";

    // Build details string
    let details = "";
    if (roomWindows.length === 0) {
      details = "No windows — relies on artificial lighting";
    } else {
      details = `${roomWindows.length} window(s), ${dominantOrientation}-facing, ${(windowToFloorRatio * 100).toFixed(0)}% W/F ratio`;
    }

    roomScores.push({
      roomId: room.id,
      roomName: room.name,
      score: compositeScore,
      grade,
      totalWindowArea_sqm: totalWindowArea,
      windowToFloorRatio,
      dominantOrientation,
      orientationScore,
      depthScore,
      details,
    });

    // Generate recommendations
    if (roomWindows.length === 0 && room.natural_light_required !== false) {
      recommendations.push({
        roomId: room.id,
        roomName: room.name,
        message: `${room.name} has no windows — consider adding windows on exterior walls`,
        severity: "warning",
      });
    } else if (grade === "poor") {
      if (dominantOrientation === "N" || dominantOrientation === "NW") {
        recommendations.push({
          roomId: room.id,
          roomName: room.name,
          message: `${room.name} has only north-facing windows — limited direct sunlight. Consider adding a south or east-facing window.`,
          severity: "info",
        });
      }
      if (depthScore < 0.5) {
        const bounds = polygonBounds(room.boundary.points);
        const depth = (Math.min(bounds.width, bounds.height) / 1000).toFixed(1);
        recommendations.push({
          roomId: room.id,
          roomName: room.name,
          message: `${room.name} is ${depth}m deep — daylight penetration is limited beyond 4m from the window wall`,
          severity: "info",
        });
      }
    } else if (grade === "fair" && windowToFloorRatio < 0.1) {
      recommendations.push({
        roomId: room.id,
        roomName: room.name,
        message: `${room.name} window area is only ${(windowToFloorRatio * 100).toFixed(0)}% of floor — add more windows for better natural light`,
        severity: "info",
      });
    }
  }

  // Average score
  const averageScore = roomScores.length > 0
    ? Math.round(roomScores.reduce((s, r) => s + r.score, 0) / roomScores.length)
    : 0;

  const averageGrade: LightGrade =
    averageScore >= 75 ? "excellent" :
      averageScore >= 55 ? "good" :
        averageScore >= 35 ? "fair" : "poor";

  return { rooms: roomScores, averageScore, averageGrade, recommendations };
}
