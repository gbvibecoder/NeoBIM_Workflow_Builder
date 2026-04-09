/**
 * POST /api/generate-floor-plan
 *
 * Standalone floor plan generation from a text prompt.
 * Uses the 3-STAGE AI PIPELINE:
 *
 * Stage 1: AI Room Programming (GPT-4o-mini) — prompt → structured rooms with adjacency/zones
 * Stage 2: AI Spatial Layout (GPT-4o) — rooms → positioned layout with validation + retry
 * Stage 3: Architectural Detailing (code) — geometry → FloorPlanProject (walls, doors, windows)
 */

import { NextRequest, NextResponse } from "next/server";
import { generateFloorPlan } from "@/services/openai";
import { logger } from "@/lib/logger";
import {
  programRooms,
  programRoomsFallback,
  programToDescription,
  extractMentionedRooms,
} from "@/lib/floor-plan/ai-room-programmer";
import type { EnhancedRoomProgram } from "@/lib/floor-plan/ai-room-programmer";
import { convertGeometryToProject, convertMultiFloorToProject } from "@/lib/floor-plan/pipeline-adapter";
import { layoutMultiFloor, scoreAdjacency } from "@/lib/floor-plan/layout-engine";
import type { FloorPlanGeometry } from "@/types/floor-plan";
import type { FloorPlanProject } from "@/types/floor-plan-cad";

// ── Generation Feedback ────────────────────────────────────────────────────

interface GenerationFeedback {
  title: string;
  area_sqm: number;
  floors: Array<{ level: number; name: string; rooms: string[] }>;
  room_count: number;
  wall_count: number;
  door_count: number;
  window_count: number;
  furniture_count: number;
  has_staircase: boolean;
  adjacency_score?: { total: number; satisfied: number; percentage: number; unsatisfied: string[] };
  tips: string[];
}

function buildFeedback(project: FloorPlanProject, prompt: string): GenerationFeedback {
  const floors = project.floors.map(f => ({
    level: f.level,
    name: f.name,
    rooms: f.rooms.map(r => r.name),
  }));

  const roomCount = project.floors.reduce((s, f) => s + f.rooms.length, 0);
  const wallCount = project.floors.reduce((s, f) => s + f.walls.length, 0);
  const doorCount = project.floors.reduce((s, f) => s + f.doors.length, 0);
  const windowCount = project.floors.reduce((s, f) => s + f.windows.length, 0);
  const furnitureCount = project.floors.reduce((s, f) => s + f.furniture.length, 0);
  const hasStaircase = project.floors.some(f => f.stairs.length > 0);

  const tips: string[] = [];
  tips.push("Click any room to edit. Drag walls to resize.");
  if (project.floors.length > 1) {
    tips.push("Use the floor selector to switch between levels.");
  }
  if (hasStaircase) {
    tips.push("Staircase is vertically aligned across floors.");
  }
  if (furnitureCount > 0) {
    tips.push(`${furnitureCount} furniture items auto-placed. Drag to rearrange.`);
  }

  return {
    title: project.name,
    area_sqm: project.metadata.carpet_area_sqm ?? 0,
    floors,
    room_count: roomCount,
    wall_count: wallCount,
    door_count: doorCount,
    window_count: windowCount,
    furniture_count: furnitureCount,
    has_staircase: hasStaircase,
    tips,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = body.prompt as string;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "NO_API_KEY" }, { status: 503 });
    }

    // ── Stage 1: AI Room Programming ──────────────────────────────────
    // Primary: AI parsing (GPT-4o-mini) with adjacency + zones
    // Fallback: regex parsing (offline, no API key needed)
    let roomProgram: EnhancedRoomProgram;
    let stage1Source = "ai";
    try {
      roomProgram = await programRooms(prompt, apiKey);
    } catch (parseErr) {
      stage1Source = "fallback";
      const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      const errStack = parseErr instanceof Error ? parseErr.stack?.split("\n").slice(0, 3).join(" | ") : "";
      console.error(`[STAGE-1] AI FAILED — using regex fallback. Error: ${errMsg}`);
      console.error(`[STAGE-1] Stack: ${errStack}`);
      roomProgram = programRoomsFallback(prompt);
    }

    // ── Stage 1 Diagnostic ──
    logger.debug(`[STAGE-1] Source: ${stage1Source}, Rooms: ${roomProgram.rooms.length}`, roomProgram.rooms.map(r => `${r.name} (floor:${r.floor ?? 0})`));

    // ── Prompt faithfulness check ──
    const mentionedRooms = extractMentionedRooms(prompt);
    const roomNamesLower = roomProgram.rooms.map(r => r.name.toLowerCase());
    const missingFromPrompt = mentionedRooms.filter(mentioned => {
      const ml = mentioned.toLowerCase();
      return !roomNamesLower.some(rn => rn.includes(ml) || ml.includes(rn) ||
        ml.split(/\s+/).some(w => w.length > 3 && rn.includes(w)));
    });
    if (missingFromPrompt.length > 0) {
      console.warn(`[FAITHFULNESS] ${missingFromPrompt.length} rooms from prompt not in output: ${missingFromPrompt.join(", ")}`);
    } else if (mentionedRooms.length > 0) {
      logger.debug(`[FAITHFULNESS] All ${mentionedRooms.length} mentioned rooms present in output`);
    }

    // Convert to BuildingDescription for Stage 2
    const description = programToDescription(roomProgram);

    // ── Multi-floor: BSP layout engine per floor (single path, no fallbacks) ──
    if (roomProgram.numFloors > 1) {
      logger.debug(`[MULTI-FLOOR] ★ BSP ONLY ★ ${roomProgram.numFloors} floors`);
      const multiFloor = layoutMultiFloor(roomProgram);

      // ── Stage 2 Diagnostic ──
      const totalPlaced = multiFloor.floors.reduce((s, f) => s + f.rooms.length, 0);
      logger.debug(`[STAGE-2] BSP multi-floor: ${totalPlaced} rooms`, multiFloor.floors.map(f => `Floor ${f.level}: ${f.rooms.length} rooms`));

      const project = convertMultiFloorToProject(
        multiFloor.floors, description.projectName, prompt,
      );

      // ── Stage 3 Diagnostic ──
      const projectRoomCount = project.floors.reduce((s, f) => s + f.rooms.length, 0);
      logger.debug(`[STAGE-3] Rooms in project: ${projectRoomCount}`, project.floors.map(f => `Floor ${f.level}: ${f.rooms.map(r => r.name).join(", ")}`));

      // Return ground floor geometry for backward-compatible rendering
      const gf = multiFloor.floors.find(f => f.level === 0) ?? multiFloor.floors[0];
      const geometry: FloorPlanGeometry = {
        footprint: { width: gf.footprintWidth, depth: gf.footprintDepth },
        wallHeight: 3.0,
        walls: [], doors: [], windows: [],
        rooms: gf.rooms.map(r => ({
          name: r.name,
          type: r.type as FloorPlanGeometry["rooms"][number]["type"],
          x: r.x, y: r.y, width: r.width, depth: r.depth,
          center: [r.x + r.width / 2, r.y + r.depth / 2] as [number, number],
          area: r.area,
        })),
      };

      const feedback = buildFeedback(project, prompt);
      // Adjacency scoring across ALL floors (not just ground)
      let totalAdj = 0, satisfiedAdj = 0;
      const allUnsatisfied: string[] = [];
      for (const fl of multiFloor.floors) {
        const adj = scoreAdjacency(fl.rooms, roomProgram.adjacency);
        totalAdj += adj.total;
        satisfiedAdj += adj.satisfied;
        allUnsatisfied.push(...adj.unsatisfied.map(u => `${u.roomA} ↔ ${u.roomB}`));
      }
      if (totalAdj > 0) {
        feedback.adjacency_score = {
          total: totalAdj,
          satisfied: satisfiedAdj,
          percentage: Math.round((satisfiedAdj / totalAdj) * 100),
          unsatisfied: allUnsatisfied,
        };
        if (allUnsatisfied.length > 0) {
          feedback.tips.push(`${allUnsatisfied.length} adjacency requirement(s) not met — drag rooms to rearrange.`);
        }
      }
      // DIAGNOSTIC — trace room counts at final output
      const allRoomNames = project.floors.flatMap(f => f.rooms.map(r => r.name));
      logger.debug('=== FINAL OUTPUT (multi-floor) ===');
      logger.debug('Total rooms:', allRoomNames.length);
      logger.debug('Room names:', JSON.stringify(allRoomNames));
      logger.debug('Floors:', JSON.stringify(project.floors.map(f => ({
        level: f.level,
        rooms: f.rooms.length,
        names: f.rooms.map(r => r.name)
      }))));

      return NextResponse.json({ project, geometry, svg: null, feedback });
    }

    // ── Stage 2: AI Spatial Layout (single floor) ──────────────────
    // GPT-4o positions rooms with zone-aware placement + validation + retry
    logger.debug(`[STAGE-2] Starting single-floor layout for ${roomProgram.rooms.length} rooms`);
    const floorPlan = await generateFloorPlan(description, apiKey, roomProgram);

    // ── Stage 3: Architectural Detailing ──────────────────────────────
    // Build FloorPlanGeometry → convertGeometryToProject (walls, doors, windows)
    const positionedRooms = floorPlan.positionedRooms;
    const roomList = floorPlan.roomList;

    const rooms = positionedRooms
      ? positionedRooms.map(r => ({
          name: r.name,
          type: r.type as "living" | "bedroom" | "kitchen" | "dining" | "bathroom" | "hallway" | "entrance" | "utility" | "balcony" | "other",
          x: r.x, y: r.y, width: r.width, depth: r.depth,
          center: [r.x + r.width / 2, r.y + r.depth / 2] as [number, number],
          area: r.area,
        }))
      : roomList.map((r) => {
          const area = r.area ?? 16;
          const w = Math.round(Math.sqrt(area * 1.2) * 10) / 10;
          const d = Math.round((area / w) * 10) / 10;
          return {
            name: r.name,
            type: ((r as Record<string, unknown>).type as string ?? "other") as "living" | "bedroom" | "kitchen" | "dining" | "bathroom" | "other",
            x: 0, y: 0, width: w, depth: d,
            center: [w / 2, d / 2] as [number, number],
            area,
          };
        });

    // Compute footprint from actual room bounding box (layout engine may
    // expand footprint beyond totalArea to fit corridor/zones)
    let bW: number, bD: number;
    if (positionedRooms && positionedRooms.length > 0) {
      bW = Math.round(Math.max(...positionedRooms.map(r => r.x + r.width)) * 10) / 10;
      bD = Math.round(Math.max(...positionedRooms.map(r => r.y + r.depth)) * 10) / 10;
    } else {
      const fpArea = floorPlan.totalArea / Math.max(floorPlan.floors, 1);
      const aspect = 1.33;
      bW = Math.round(Math.sqrt(fpArea * aspect) * 10) / 10;
      bD = Math.round((fpArea / bW) * 10) / 10;
    }

    const geometry: FloorPlanGeometry = {
      footprint: { width: bW, depth: bD },
      wallHeight: 3.0,
      walls: [], doors: [], windows: [],
      rooms,
    };

    const project = convertGeometryToProject(geometry, description.projectName, prompt);
    const feedback = buildFeedback(project, prompt);

    // DIAGNOSTIC — Stage 3 output
    const f0 = project.floors[0];
    logger.debug('=== STAGE 3 OUTPUT (single-floor) ===');
    logger.debug(`[STAGE-3] rooms: ${f0?.rooms.length}, walls: ${f0?.walls.length}, doors: ${f0?.doors.length}, windows: ${f0?.windows.length}`);
    logger.debug(`[STAGE-3] room areas: ${f0?.rooms.map(r => `${r.name}: ${r.area_sqm.toFixed(1)}m²`).join(', ')}`);
    if (f0 && f0.doors.length < 6) {
      console.warn(`[STAGE-3] ⚠️ Only ${f0.doors.length} doors for ${f0.rooms.length} rooms — may indicate gaps between rooms`);
    }
    logger.debug('=== FLOOR PLAN GENERATION COMPLETE ===');

    return NextResponse.json({ project, geometry, svg: floorPlan.svg, feedback });
  } catch (err) {
    console.error("[generate-floor-plan] Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
