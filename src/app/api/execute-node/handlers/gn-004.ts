import { generateFloorPlan, generateId } from "./deps";
import type { NodeHandler } from "./types";

/**
 * GN-004 — Floor Plan Generator
 *
 * Phase 1 consolidation: now goes through the same Stage 1+2+3 pipeline that
 * GN-012 and the standalone /api/generate-floor-plan use. Specifically:
 *   1. programRooms(prompt, apiKey)        — Stage 1 AI parsing (regex fallback)
 *   2. generateFloorPlan(desc, key, prog)  — Stage 2 with the room program so
 *                                            the deterministic BSP layout path
 *                                            is invoked instead of the legacy
 *                                            no-program GPT-4o text→SVG.
 *   3. convertGeometryToProject(geometry)  — Stage 3 architectural detailing
 *                                            (walls, doors, windows).
 *
 * The output keeps the historical `type: "svg"` shape so existing downstream
 * consumers (GN-011 3D viewer, svg-out port wirings) continue to work. The
 * floorPlanProject is also attached to data so editor consumers can use it.
 */
export const handleGN004: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId, apiKey } = ctx;

  // Lazy imports keep the handler entry boot-cheap and match GN-012's pattern.
  const { programRooms, programRoomsFallback, programToDescription } = await import(
    "@/features/floor-plan/lib/ai-room-programmer"
  );
  const { convertGeometryToProject, convertMultiFloorToProject } = await import(
    "@/features/floor-plan/lib/pipeline-adapter"
  );
  const { layoutMultiFloor } = await import("@/features/floor-plan/lib/layout-engine");
  const { exportFloorToSvg } = await import("@/features/floor-plan/lib/export-svg");
  const { computeLayoutMetrics } = await import(
    "@/features/floor-plan/lib/layout-metrics"
  );

  // ── Extract a usable prompt string ────────────────────────────────────
  // GN-004 may receive: a plain prompt, a BuildingDescription object from
  // GN-001, or a wrapped {_raw} envelope. Mirror GN-012's extraction pattern.
  const raw = (inputData?._raw ?? inputData ?? {}) as Record<string, unknown>;
  const promptCandidates: Array<unknown> = [
    inputData?._originalPrompt,
    inputData?.prompt,
    inputData?.brief,
    inputData?.content,
    raw._originalPrompt,
    raw.prompt,
    raw.brief,
    raw.content,
  ];
  let promptForAI = "";
  for (const c of promptCandidates) {
    if (typeof c === "string" && c.trim().length > 0) {
      promptForAI = c;
      break;
    }
  }
  if (!promptForAI) {
    // Synthesize from a BuildingDescription-shaped input as a last resort.
    const desc = inputData as Record<string, unknown> | undefined;
    const parts: string[] = [];
    if (desc?.projectName) parts.push(`Project: ${String(desc.projectName)}`);
    if (desc?.buildingType) parts.push(`Type: ${String(desc.buildingType)}`);
    if (desc?.floors) parts.push(`Floors: ${String(desc.floors)}`);
    if (desc?.totalArea) parts.push(`Total area: ${String(desc.totalArea)} sqm`);
    promptForAI = parts.join(". ") || "Residential floor plan";
  }

  // ── Stage 1 — AI room programming (regex fallback) ───────────────────
  let roomProgram: import("@/features/floor-plan/lib/ai-room-programmer").EnhancedRoomProgram;
  try {
    roomProgram = await programRooms(promptForAI, apiKey);
  } catch (parseErr) {
    console.warn("[GN-004] Stage 1 AI failed, using regex fallback:", parseErr);
    roomProgram = programRoomsFallback(promptForAI);
  }
  const description = programToDescription(roomProgram);

  // ── Stages 2 + 3 — same pipeline as GN-012 ───────────────────────────
  let project: import("@/types/floor-plan-cad").FloorPlanProject;

  if (roomProgram.numFloors > 1) {
    const multiFloor = layoutMultiFloor(roomProgram);
    project = convertMultiFloorToProject(multiFloor.floors, description.projectName, promptForAI);
  } else {
    const floorPlan = await generateFloorPlan(description, apiKey, roomProgram);
    const positionedRooms = floorPlan.positionedRooms;
    const roomList = floorPlan.roomList;

    const rooms = positionedRooms
      ? positionedRooms.map((r) => ({
          name: r.name,
          type: (r.type ?? "other") as "living" | "bedroom" | "kitchen" | "dining" | "bathroom" | "hallway" | "entrance" | "utility" | "balcony" | "other",
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
            type: (((r as Record<string, unknown>).type as string) ?? "other") as "living" | "bedroom" | "kitchen" | "dining" | "bathroom" | "other",
            x: 0, y: 0, width: w, depth: d,
            center: [w / 2, d / 2] as [number, number],
            area,
          };
        });

    let bW: number, bD: number;
    if (positionedRooms && positionedRooms.length > 0) {
      bW = Math.round(Math.max(...positionedRooms.map((r) => r.x + r.width)) * 10) / 10;
      bD = Math.round(Math.max(...positionedRooms.map((r) => r.y + r.depth)) * 10) / 10;
    } else {
      const fpArea = floorPlan.totalArea / Math.max(floorPlan.floors, 1);
      const aspect = 1.33;
      bW = Math.round(Math.sqrt(fpArea * aspect) * 10) / 10;
      bD = Math.round((fpArea / bW) * 10) / 10;
    }

    const geometry: import("@/features/floor-plan/types/floor-plan").FloorPlanGeometry = {
      footprint: { width: bW, depth: bD },
      wallHeight: 3.0,
      walls: [], doors: [], windows: [],
      rooms,
    };
    project = convertGeometryToProject(geometry, description.projectName, promptForAI);
  }

  // ── Build the GN-004 historical output shape from the unified project ─
  const floor0 = project.floors[0];
  const projectRooms = floor0?.rooms ?? [];
  const SQM_TO_SQFT = 10.7639;

  // SVG: export from the assembled FloorPlanProject so the unified engine
  // is the single source of truth (replaces the legacy text→SVG output).
  let svgString = "";
  try {
    if (floor0) {
      svgString = exportFloorToSvg(floor0, project.name, {
        includeRoomFills: true,
        includeDimensions: true,
        includeGrid: false,
        displayUnit: (project.settings.display_unit as "mm" | "cm" | "m") ?? "mm",
      });
    }
  } catch { /* SVG export is best-effort — downstream may still use the project */ }

  const totalAreaSqft = projectRooms.reduce((s, r) => s + r.area_sqm * SQM_TO_SQFT, 0);
  const roomListOut = projectRooms.map((r) => ({
    name: r.name,
    area: Math.round(r.area_sqm * SQM_TO_SQFT * 10) / 10,
    unit: "sqft" as const,
    floor: floor0?.name,
  }));

  const perFloorRooms = project.floors.map((f) => ({
    floorLabel: f.name,
    rooms: f.rooms.map((r) => ({
      name: r.name,
      area: Math.round(r.area_sqm * SQM_TO_SQFT * 10) / 10,
      type: r.type as string,
    })),
  }));

  // GN-011-compatible geometry block — derive {x, y, width, depth} from each
  // room's bounding box (mm → ft).
  const MM_TO_FT = 1 / 304.8;
  const positionedFromProject = projectRooms.map((r) => {
    const xs = r.boundary.points.map((p) => p.x);
    const ys = r.boundary.points.map((p) => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const x1 = Math.max(...xs), y1 = Math.max(...ys);
    return {
      name: r.name,
      type: r.type as string,
      x: (x0) * MM_TO_FT,
      y: (y0) * MM_TO_FT,
      width: (x1 - x0) * MM_TO_FT,
      depth: (y1 - y0) * MM_TO_FT,
    };
  });

  // Building bounding box from the floor boundary polygon (or the room bbox).
  const bbX = floor0
    ? Math.max(...floor0.boundary.points.map((p) => p.x)) * MM_TO_FT
    : 0;
  const bbY = floor0
    ? Math.max(...floor0.boundary.points.map((p) => p.y)) * MM_TO_FT
    : 0;

  // 3-per-row layout for the GN-011 fallback path (no positions).
  const geometryRows: Array<Array<Record<string, unknown>>> = [];
  let currentGeoRow: Array<Record<string, unknown>> = [];
  for (const rm of positionedFromProject) {
    currentGeoRow.push({
      name: rm.name,
      type: rm.type,
      width: Math.round(rm.width * 10) / 10,
      depth: Math.round(rm.depth * 10) / 10,
    });
    if (currentGeoRow.length >= 3) {
      geometryRows.push(currentGeoRow);
      currentGeoRow = [];
    }
  }
  if (currentGeoRow.length > 0) geometryRows.push(currentGeoRow);

  const layoutMetrics = computeLayoutMetrics(project);

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "svg",
    data: {
      svg: svgString,
      label: "Floor Plan (AI Generated)",
      roomList: roomListOut,
      totalArea: Math.round(totalAreaSqft * 10) / 10,
      floors: project.floors.length,
      perFloorRooms,
      // FloorPlanProject for editor-aware downstream nodes (GN-012, EX-*)
      floorPlanProject: project,
      // Phase 1 honest metrics
      layoutMetrics,
      qualityFlags: layoutMetrics.quality_flags,
      // GN-011 3D viewer geometry block
      geometry: {
        buildingWidth: Math.round(bbX * 10) / 10,
        buildingDepth: Math.round(bbY * 10) / 10,
        rows: geometryRows,
        rooms: positionedFromProject.map((r) => ({
          name: r.name,
          type: r.type,
          width: Math.round(r.width * 10) / 10,
          depth: Math.round(r.depth * 10) / 10,
        })),
        positionedRooms: positionedFromProject.map((r) => ({
          name: r.name,
          type: r.type,
          x: Math.round(r.x * 10) / 10,
          y: Math.round(r.y * 10) / 10,
          width: Math.round(r.width * 10) / 10,
          depth: Math.round(r.depth * 10) / 10,
        })),
      },
    },
    metadata: { engine: "floor-plan-unified", model: "gpt-4o", real: true },
    createdAt: new Date(),
  };
};
