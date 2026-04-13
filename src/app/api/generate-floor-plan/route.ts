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
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit, isAdminUser } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { generateFloorPlan } from "@/features/ai/services/openai";
import { logger } from "@/lib/logger";
import {
  programRooms,
  programRoomsFallback,
  programToDescription,
  extractMentionedRooms,
} from "@/features/floor-plan/lib/ai-room-programmer";
import type { EnhancedRoomProgram } from "@/features/floor-plan/lib/ai-room-programmer";
import {
  convertGeometryToProject,
  convertMultiFloorToProject,
  buildGeometryFromGrid,
  convertGridToProject,
  convertGridFloorCoordinationToProject,
} from "@/features/floor-plan/lib/pipeline-adapter";
import { layoutFloorPlan, layoutMultiFloor, scoreAdjacency } from "@/features/floor-plan/lib/layout-engine";
import { computeGridFromRooms, mapBSPRoomsToGridCells } from "@/features/floor-plan/lib/snap-to-grid";
import type { FloorPlanGeometry } from "@/features/floor-plan/types/floor-plan";
import type { FloorPlanProject } from "@/types/floor-plan-cad";

// Grid-first pipeline imports
import { generateStructuralGrid, optimizeBayDimensions } from "@/features/floor-plan/lib/grid-generator";
import { assignRoomsToGrid } from "@/features/floor-plan/lib/grid-room-assigner";
import { generateWallsFromGrid } from "@/features/floor-plan/lib/grid-wall-generator";
import {
  validateGrid,
  validateRoomAssignment,
  validateWallSystem,
  validateOpenings,
  validateFinal,
  shouldRetry,
  type ValidationFixAction,
} from "@/features/floor-plan/lib/generation-validator";
import { coordinateFloors } from "@/features/floor-plan/lib/multi-floor-coordinator";
import { checkDesignQuality, type DesignFix } from "@/features/floor-plan/lib/design-quality-checker";
import { validateInterpretation } from "@/features/floor-plan/lib/ai-room-programmer";

// Template + Optimizer pipeline imports
import { matchTypology } from "@/features/floor-plan/lib/typology-matcher";
import { optimizeLayout } from "@/features/floor-plan/lib/layout-optimizer";
import type { PlacedRoom as OptimizerPlacedRoom } from "@/features/floor-plan/lib/energy-function";
import { getRoomRule } from "@/features/floor-plan/lib/architectural-rules";
import { classifyRoom } from "@/features/floor-plan/lib/room-sizer";

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

/** Record a standalone tool use as an Execution so it appears in admin + billing.
 *  Uses a per-user hidden workflow (name starts with "__") that stays alive
 *  (deletedAt = null) so execution counts aren't filtered out by the dashboard
 *  and billing APIs which exclude soft-deleted workflows. */
async function recordToolExecution(userId: string, toolName: string) {
  try {
    let wf = await prisma.workflow.findFirst({
      where: { ownerId: userId, name: "__standalone_tools__" },
      select: { id: true },
    });
    if (!wf) {
      wf = await prisma.workflow.create({
        data: {
          ownerId: userId,
          name: "__standalone_tools__",
          description: "Auto-created for standalone tool usage tracking",
        },
        select: { id: true },
      });
    }
    await prisma.execution.create({
      data: {
        workflowId: wf.id,
        userId,
        status: "SUCCESS",
        startedAt: new Date(),
        completedAt: new Date(),
        tileResults: [],
        metadata: { tool: toolName },
      },
    });
  } catch (err) {
    console.error("[recordToolExecution] Failed:", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    // ── Auth ──
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const userRole = ((session.user as { role?: string }).role) || "FREE";
    const userEmail = session.user.email || "";
    const isAdmin = isAdminUser(userEmail) || userRole === "PLATFORM_ADMIN" || userRole === "TEAM_ADMIN";

    // ── Rate limit: 5 floor plan generations per minute ──
    if (!isAdmin) {
      const rl = await checkEndpointRateLimit(userId, "generate-floor-plan", 5, "1 m");
      if (!rl.success) {
        return NextResponse.json(
          { error: "Too many floor plan requests. Please wait a moment." },
          { status: 429 }
        );
      }
    }

    // ── FREE tier lifetime gate (counts against 3 lifetime executions) ──
    if (!isAdmin && userRole === "FREE") {
      const lifetimeCompleted = await prisma.execution.count({
        where: { userId, status: { in: ["SUCCESS", "PARTIAL"] } },
      });
      if (lifetimeCompleted >= 3) {
        return NextResponse.json(
          formatErrorResponse({
            title: "Free executions used",
            message: "You've used all 3 free executions. Upgrade to keep building!",
            code: "RATE_001",
            action: "View Plans",
            actionUrl: "/dashboard/billing",
          }),
          { status: 429 }
        );
      }
    }

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

    // ── Agent 1 Self-Check: validate interpretation ──
    const interpretation = validateInterpretation(roomProgram, prompt);
    logger.debug(`[AGENT-1] Confidence: ${(interpretation.confidence * 100).toFixed(0)}%, BHK match: ${interpretation.bedroomCountMatch}, fixes: ${interpretation.fixes.length}`);
    if (interpretation.fixes.length > 0) {
      logger.debug(`[AGENT-1] Applied fixes: ${interpretation.fixes.join('; ')}`);
    }

    // Convert to BuildingDescription for Stage 2
    const description = programToDescription(roomProgram);

    // ═══════════════════════════════════════════════════════════════════
    // MULTI-AGENT PIPELINE (primary path)
    // Agent 2 (Designer) + Agent 3 (Checker) in a feedback loop.
    // Falls back to BSP/AI pipeline on failure for backward compatibility.
    // ═══════════════════════════════════════════════════════════════════
    try {
      const gridResult = await runGridFirstPipeline(roomProgram, description.projectName, prompt);
      if (gridResult) {
        logger.debug('[GRID-FIRST] Pipeline succeeded — returning grid-based floor plan');
        return NextResponse.json(gridResult);
      }
      logger.debug('[GRID-FIRST] Pipeline returned null — falling back to BSP/AI pipeline');
    } catch (gridErr) {
      const msg = gridErr instanceof Error ? gridErr.message : String(gridErr);
      console.warn(`[GRID-FIRST] Pipeline failed — falling back to BSP/AI pipeline. Error: ${msg}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // LEGACY BSP/AI PIPELINE (fallback)
    // ═══════════════════════════════════════════════════════════════════

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

      await recordToolExecution(userId, "floor-plan");
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

    await recordToolExecution(userId, "floor-plan");
    return NextResponse.json({ project, geometry, svg: floorPlan.svg, feedback });
  } catch (err) {
    console.error("[generate-floor-plan] Error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════════
// GRID-FIRST PIPELINE IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Multi-agent grid-first pipeline with feedback loop.
 *
 * Agent 2 (Designer): grid → assign → optimize bays → walls → project
 * Agent 3 (Checker): code validation + design quality
 * Coordinator: if critical issues, apply fixes and re-run Agent 2 (max 3 loops)
 */
async function runGridFirstPipeline(
  roomProgram: EnhancedRoomProgram,
  projectName: string,
  originalPrompt: string,
): Promise<{
  project: FloorPlanProject;
  geometry: FloorPlanGeometry;
  svg: null;
  feedback: ReturnType<typeof buildFeedback>;
} | null> {
  const MAX_GRID_RETRIES = 3;
  const MAX_DESIGN_LOOPS = 3;

  // Multi-floor path
  if (roomProgram.numFloors > 1) {
    return runGridMultiFloor(roomProgram, projectName, originalPrompt);
  }

  let bestProject: FloorPlanProject | null = null;
  let bestGeometry: FloorPlanGeometry | null = null;
  let bestScore = 0;
  let bestFeedback: ReturnType<typeof buildFeedback> | null = null;
  let bestDesignReport: ReturnType<typeof checkDesignQuality> | null = null;

  // ── Coordinator outer loop: design iterations ──
  for (let designLoop = 0; designLoop < MAX_DESIGN_LOOPS; designLoop++) {
    logger.debug(`[COORDINATOR] Design loop ${designLoop + 1}/${MAX_DESIGN_LOOPS}`);

    // ── Agent 2: Designer — Template + Optimizer → snap to grid ──
    // Primary path: typology template → SA optimizer → grid snap
    // Fallback: BSP → grid snap (existing path)

    let layoutRooms: Array<{ name: string; type: string; x: number; y: number; width: number; depth: number }>;
    let fpWidth: number;
    let fpDepth: number;
    let designerSource = 'template';

    const templateMatch = matchTypology(roomProgram);

    if (templateMatch && templateMatch.confidence >= 0.5) {
      // ── Template path ──
      logger.debug(`[AGENT-2] Template: ${templateMatch.template.id} (confidence ${templateMatch.confidence.toFixed(2)})`);

      // Convert ScaledRoom[] to PlacedRoom[] for the optimizer
      const placedRooms: OptimizerPlacedRoom[] = templateMatch.scaledRooms.map(sr => {
        const spec = roomProgram.rooms.find(r => r.name === sr.name);
        const cls = classifyRoom(sr.type, sr.name);
        const rule = getRoomRule(cls);
        return {
          id: sr.slotId,
          name: sr.name,
          type: sr.type,
          x: sr.x,
          y: sr.y,
          width: sr.width,
          depth: sr.depth,
          zone: sr.zone as OptimizerPlacedRoom['zone'],
          targetArea: spec?.areaSqm ?? sr.width * sr.depth,
          mustHaveExteriorWall: rule.exteriorWall === 'required',
        };
      });

      fpWidth = templateMatch.footprint.width;
      fpDepth = templateMatch.footprint.depth;

      // Add overflow rooms (rooms in program but not in any template slot)
      if (templateMatch.overflowRooms.length > 0) {
        for (const overflowName of templateMatch.overflowRooms) {
          const spec = roomProgram.rooms.find(r => r.name === overflowName);
          if (!spec) continue;
          const cls = classifyRoom(spec.type, spec.name);
          const rule = getRoomRule(cls);
          const w = Math.max(rule.width.min, Math.sqrt(spec.areaSqm));
          const d = Math.max(rule.depth.min, spec.areaSqm / w);
          placedRooms.push({
            id: `overflow_${overflowName.toLowerCase().replace(/\s+/g, '_')}`,
            name: overflowName,
            type: cls,
            x: 0,
            y: 0,
            width: Math.round(w * 10) / 10,
            depth: Math.round(d * 10) / 10,
            zone: (spec.zone as OptimizerPlacedRoom['zone']) ?? 'service',
            targetArea: spec.areaSqm,
            mustHaveExteriorWall: rule.exteriorWall === 'required',
          });
        }
        // Expand footprint if needed to fit overflow rooms
        const totalNeeded = placedRooms.reduce((s, r) => s + r.targetArea, 0);
        const currentArea = fpWidth * fpDepth;
        if (totalNeeded > currentArea * 0.9) {
          const scale = Math.sqrt(totalNeeded / (currentArea * 0.85));
          fpWidth = Math.round(fpWidth * scale * 10) / 10;
          fpDepth = Math.round(fpDepth * scale * 10) / 10;
        }
      }

      // Run optimizer
      const optResult = optimizeLayout(placedRooms, { width: fpWidth, depth: fpDepth }, roomProgram);
      const improvement = optResult.initialEnergy > 0
        ? ((1 - optResult.energy.total / optResult.initialEnergy) * 100).toFixed(0)
        : '0';
      logger.debug(`[AGENT-2] Optimizer: ${optResult.initialEnergy.toFixed(0)} → ${optResult.energy.total.toFixed(0)} (${improvement}% improvement, ${optResult.timeMs.toFixed(0)}ms)`);

      layoutRooms = optResult.rooms.map(r => ({
        name: r.name, type: r.type, x: r.x, y: r.y, width: r.width, depth: r.depth,
      }));
    } else {
      // ── BSP fallback path ──
      designerSource = 'bsp';
      logger.debug(`[AGENT-2] No template match — using BSP seed`);
      const bspRooms = layoutFloorPlan(roomProgram);
      if (bspRooms.length === 0) {
        return bestProject ? { project: bestProject, geometry: bestGeometry!, svg: null, feedback: bestFeedback! } : null;
      }

      fpWidth = Math.max(...bspRooms.map(r => r.x + r.width));
      fpDepth = Math.max(...bspRooms.map(r => r.y + r.depth));
      logger.debug(`[AGENT-2] BSP: ${bspRooms.length} rooms, ${fpWidth.toFixed(1)}m × ${fpDepth.toFixed(1)}m`);

      // Optimize BSP output
      const placedRooms: OptimizerPlacedRoom[] = bspRooms.map(r => {
        const cls = classifyRoom(r.type, r.name);
        const rule = getRoomRule(cls);
        return {
          id: r.name.toLowerCase().replace(/\s+/g, '_'),
          name: r.name,
          type: cls,
          x: r.x, y: r.y, width: r.width, depth: r.depth,
          zone: inferZoneFromType(cls),
          targetArea: r.area ?? r.width * r.depth,
          mustHaveExteriorWall: rule.exteriorWall === 'required',
        };
      });

      const optResult = optimizeLayout(placedRooms, { width: fpWidth, depth: fpDepth }, roomProgram);
      logger.debug(`[AGENT-2] BSP+Optimizer: ${optResult.initialEnergy.toFixed(0)} → ${optResult.energy.total.toFixed(0)} (${optResult.timeMs.toFixed(0)}ms)`);

      layoutRooms = optResult.rooms.map(r => ({
        name: r.name, type: r.type, x: r.x, y: r.y, width: r.width, depth: r.depth,
      }));
    }

    // Step B: Snap optimized rooms to structural grid
    const grid = computeGridFromRooms(layoutRooms, fpWidth, fpDepth);
    const assignment = mapBSPRoomsToGridCells(grid, layoutRooms);
    logger.debug(`[AGENT-2] Grid: ${grid.gridCols}×${grid.gridRows} (${grid.cells.length} cells), mapped ${assignment.roomOrder.length} rooms, source: ${designerSource}`);

    // Step C: Generate walls from the structural grid (guaranteed continuous)
    const wallSystem = generateWallsFromGrid(grid, assignment);

    // Step D: Build geometry + project
    const geometry = buildGeometryFromGrid(grid, assignment, wallSystem);
    const project = convertGridToProject(
      grid, assignment, wallSystem, projectName, originalPrompt,
      templateMatch?.template.connections,
    );

    const optimizedGrid = grid; // For feedback

    if (!project) {
      return bestProject ? { project: bestProject, geometry: bestGeometry!, svg: null, feedback: bestFeedback! } : null;
    }

    // ── Agent 3: Checker — code compliance + design quality ──
    const codeReport = validateFinal(project);
    const designReport = checkDesignQuality(project);
    const combinedScore = Math.round(codeReport.score * 0.6 + designReport.score * 0.4);

    logger.debug(`[AGENT-3] Code: ${codeReport.score}, Design: ${designReport.score} (${designReport.grade}), Combined: ${combinedScore}`);
    if (designReport.issues.length > 0) {
      const criticals = designReport.issues.filter(i => i.severity === 'critical');
      const warnings = designReport.issues.filter(i => i.severity === 'warning');
      logger.debug(`[AGENT-3] Design issues: ${criticals.length} critical, ${warnings.length} warnings`);
    }

    // Track best result
    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestProject = project;
      bestGeometry = geometry;
      bestDesignReport = designReport;
      bestFeedback = buildFeedback(project, originalPrompt);
      bestFeedback.tips.push(`Grid-first layout: ${optimizedGrid.gridCols}×${optimizedGrid.gridRows} structural grid`);
      bestFeedback.tips.push(`Design quality: ${designReport.grade} (${designReport.score}/100)`);
      if (codeReport.warnings.length > 0) {
        bestFeedback.tips.push(`${codeReport.warnings.length} code warning(s) — review in Code panel`);
      }
      // Adjacency scoring
      if (roomProgram.adjacency.length > 0) {
        const placedRooms = geometry.rooms.map(r => ({
          name: r.name, type: r.type,
          x: r.x ?? r.center[0] - r.width / 2,
          y: r.y ?? r.center[1] - r.depth / 2,
          width: r.width, depth: r.depth,
          area: r.area ?? r.width * r.depth,
        }));
        const adjScore = scoreAdjacency(placedRooms, roomProgram.adjacency);
        if (adjScore.total > 0) {
          bestFeedback.adjacency_score = {
            total: adjScore.total, satisfied: adjScore.satisfied,
            percentage: Math.round((adjScore.satisfied / adjScore.total) * 100),
            unsatisfied: adjScore.unsatisfied.map(u => `${u.roomA} ↔ ${u.roomB}`),
          };
        }
      }
    }

    // ── Coordinator: check if good enough or apply fixes ──
    if (codeReport.critical.length === 0 && designReport.score >= 70) {
      logger.debug(`[COORDINATOR] Score ${combinedScore} meets threshold — accepting`);
      break;
    }

    // Collect fix actions from both reports
    const fixes: Array<ValidationFixAction | DesignFix> = [];
    for (const issue of codeReport.critical) {
      if (issue.fixAction) fixes.push(issue.fixAction);
    }
    for (const issue of designReport.issues) {
      if (issue.severity === 'critical' && issue.fixAction) fixes.push(issue.fixAction);
    }

    if (fixes.length === 0) {
      logger.debug(`[COORDINATOR] No actionable fixes — using best result`);
      break;
    }

    // Apply fixes to room program for next design iteration
    logger.debug(`[COORDINATOR] Applying ${fixes.length} fixes for next iteration`);
    for (const fix of fixes) {
      applyFixToProgram(roomProgram, fix);
    }
  }

  if (!bestProject || !bestGeometry || !bestFeedback) return null;

  // Add design issues to feedback if any
  if (bestDesignReport) {
    const critDesign = bestDesignReport.issues.filter(i => i.severity === 'critical');
    for (const issue of critDesign) {
      bestFeedback.tips.push(`Design: ${issue.message}`);
    }
  }

  return { project: bestProject, geometry: bestGeometry, svg: null, feedback: bestFeedback };
}

/**
 * Apply a fix action to the room program for the next design iteration.
 */
function applyFixToProgram(
  program: EnhancedRoomProgram,
  fix: ValidationFixAction | DesignFix,
): void {
  switch (fix.type) {
    case 'resize_room': {
      const roomName = fix.params.room as string | undefined;
      const targetArea = fix.params.targetArea as number | undefined;
      if (roomName && targetArea) {
        const room = program.rooms.find(r => r.name === roomName);
        if (room && room.areaSqm < targetArea) {
          room.areaSqm = targetArea;
          // Update total area if needed
          const newTotal = program.rooms.reduce((s, r) => s + r.areaSqm, 0);
          if (newTotal > program.totalAreaSqm) program.totalAreaSqm = newTotal;
        }
      }
      break;
    }
    case 'add_bay':
      // Inflate total area to force larger grid on next attempt
      program.totalAreaSqm *= 1.2;
      break;
    case 'swap_rooms':
      // Swap rooms' zone preferences so the Designer places them differently
      // The room needing perimeter gets zone 'public' (placed near entrance/perimeter)
      {
        const roomName = fix.params.room as string | undefined;
        if (roomName) {
          const room = program.rooms.find(r => r.name === roomName);
          if (room) room.mustHaveExteriorWall = true;
        }
      }
      break;
    case 'add_adjacency': {
      const roomA = fix.params.roomA as string | undefined;
      const roomB = fix.params.roomB as string | undefined;
      const reason = (fix.params.reason as string) ?? 'design quality fix';
      if (roomA && roomB) {
        const exists = program.adjacency.some(
          a => (a.roomA === roomA && a.roomB === roomB) || (a.roomA === roomB && a.roomB === roomA)
        );
        if (!exists) {
          program.adjacency.push({ roomA, roomB, reason });
        }
      }
      break;
    }
    case 'move_room_to_perimeter': {
      const roomName = fix.params.room as string | undefined;
      if (roomName) {
        const room = program.rooms.find(r => r.name === roomName);
        if (room) room.mustHaveExteriorWall = true;
      }
      break;
    }
    case 'change_bay_size':
      // Already handled by area inflation in the inner retry loop
      break;
  }
}

/**
 * Grid-first pipeline for multi-floor buildings.
 */
function runGridMultiFloor(
  roomProgram: EnhancedRoomProgram,
  projectName: string,
  originalPrompt: string,
): {
  project: FloorPlanProject;
  geometry: FloorPlanGeometry;
  svg: null;
  feedback: ReturnType<typeof buildFeedback>;
} | null {
  try {
    const coordination = coordinateFloors(roomProgram);

    // Optimize bay dimensions per floor, then generate walls
    const optimizedGrids: typeof coordination.grid[] = [];
    const wallSystems = coordination.floors.map(fl => {
      const optGrid = optimizeBayDimensions(coordination.grid, fl.assignment);
      optimizedGrids.push(optGrid);
      return generateWallsFromGrid(optGrid, fl.assignment);
    });
    // Use the ground floor's optimized grid as the reference
    const refGrid = optimizedGrids[0] ?? coordination.grid;
    coordination.grid = refGrid;

    // Convert to project
    const project = convertGridFloorCoordinationToProject(
      coordination,
      wallSystems,
      projectName,
      originalPrompt,
    );

    // Build ground floor geometry for backward-compatible rendering
    const gf = coordination.floors.find(f => f.level === 0) ?? coordination.floors[0];
    const geometry = buildGeometryFromGrid(refGrid, gf.assignment, wallSystems[0]);

    const feedback = buildFeedback(project, originalPrompt);
    feedback.tips.push(`Grid-first layout: ${coordination.grid.gridCols}×${coordination.grid.gridRows} structural grid, ${coordination.floors.length} floors`);

    const finalValidation = validateFinal(project);
    if (finalValidation.warnings.length > 0) {
      feedback.tips.push(`${finalValidation.warnings.length} validation warning(s)`);
    }

    logger.debug('=== GRID-FIRST MULTI-FLOOR OUTPUT ===');
    logger.debug(`Floors: ${project.floors.length}, Total rooms: ${project.floors.reduce((s, f) => s + f.rooms.length, 0)}`);

    return { project, geometry, svg: null, feedback };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[GRID-FIRST] Multi-floor pipeline failed: ${msg}`);
    return null;
  }
}

/**
 * Infer room zone from classified type (for BSP fallback path).
 */
function inferZoneFromType(cls: string): OptimizerPlacedRoom['zone'] {
  if (['living_room', 'dining_room', 'drawing_room', 'foyer', 'entrance_lobby'].includes(cls)) return 'public';
  if (['bedroom', 'master_bedroom', 'guest_bedroom', 'children_bedroom', 'study', 'home_office'].includes(cls)) return 'private';
  if (['corridor', 'hallway', 'passage', 'staircase', 'lift'].includes(cls)) return 'circulation';
  if (['balcony', 'verandah', 'terrace', 'garden', 'parking', 'car_porch'].includes(cls)) return 'outdoor';
  return 'service';
}
