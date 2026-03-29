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
import {
  programRooms,
  programRoomsFallback,
  programToDescription,
} from "@/lib/floor-plan/ai-room-programmer";
import type { EnhancedRoomProgram } from "@/lib/floor-plan/ai-room-programmer";
import { convertGeometryToProject } from "@/lib/floor-plan/pipeline-adapter";
import type { FloorPlanGeometry } from "@/types/floor-plan";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = body.prompt as string;

    if (!prompt || typeof prompt !== "string") {
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
    try {
      roomProgram = await programRooms(prompt, apiKey);
      console.log(`[generate-floor-plan] Stage 1: ${roomProgram.rooms.length} rooms, ${roomProgram.totalAreaSqm}sqm, type=${roomProgram.buildingType}, adjacencies=${roomProgram.adjacency.length}`);
    } catch (parseErr) {
      console.warn("[generate-floor-plan] Stage 1 AI failed, using regex fallback:", parseErr);
      roomProgram = programRoomsFallback(prompt);
    }

    // Convert to BuildingDescription for Stage 2
    const description = programToDescription(roomProgram);

    // ── Stage 2: AI Spatial Layout ────────────────────────────────────
    // GPT-4o positions rooms with zone-aware placement + validation + retry
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

    return NextResponse.json({ project, geometry, svg: floorPlan.svg });
  } catch (err) {
    console.error("[generate-floor-plan] Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
