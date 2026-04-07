import { generateId, generateFloorPlan } from "./deps";
import type { NodeHandler } from "./types";

/**
 * GN-012 — Floor Plan Editor (Interactive CAD) — 3-Stage AI Pipeline
 * Pure copy from execute-node/route.ts (lines 4975-5195 of the pre-decomposition file).
 */
export const handleGN012: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId, apiKey } = ctx;
  // ── Floor Plan Editor (Interactive CAD) — 3-Stage AI Pipeline ──
  // Stage 1: AI Room Programming (GPT-4o-mini) → rooms + adjacency + zones
  // Stage 2: AI Spatial Layout (GPT-4o) → positioned rooms + validation + retry
  // Stage 3: Architectural Detailing → walls, doors, windows (pipeline-adapter)
  // Falls back to adaptNodeInput() if AI generation fails entirely.

  const { adaptNodeInput } = await import("@/lib/floor-plan/node-input-adapter");
  const { convertGeometryToProject } = await import("@/lib/floor-plan/pipeline-adapter");
  const { computeBOQQuantities, extractRoomSchedule, formatBOQForExporter, formatBOQAsTable } = await import("@/lib/floor-plan/node-output-adapter");
  const { convertFloorPlanToMassing } = await import("@/lib/floor-plan/floorplan-to-massing");
  const { exportFloorToSvg } = await import("@/lib/floor-plan/export-svg");

  // ── Extract text sources ──
  const originalPrompt = (typeof inputData?._originalPrompt === "string" ? inputData._originalPrompt : "")
    || (typeof inputData?.prompt === "string" ? inputData.prompt : "")
    || (typeof (inputData?._raw as Record<string, unknown>)?._originalPrompt === "string"
        ? (inputData._raw as Record<string, unknown>)._originalPrompt as string : "");
  const designBrief = typeof inputData?.brief === "string" ? inputData.brief
    : typeof inputData?.content === "string" ? inputData.content
    : typeof (inputData?._raw as Record<string, unknown>)?.content === "string"
      ? (inputData._raw as Record<string, unknown>).content as string
    : originalPrompt || undefined;

  let project: import("@/types/floor-plan-cad").FloorPlanProject | null = null;
  let sourceType: string = "ai-generated";
  const warnings: string[] = [];

  if (designBrief || originalPrompt) {
    const floorPlanApiKey = apiKey ?? process.env.OPENAI_API_KEY;
    if (floorPlanApiKey) {
      try {
        const promptForAI = originalPrompt || designBrief || "";

        // Stage 1: AI Room Programming (adjacency + zones)
        const { programRooms, programRoomsFallback, programToDescription } = await import("@/lib/floor-plan/ai-room-programmer");
        let roomProgram: import("@/lib/floor-plan/ai-room-programmer").EnhancedRoomProgram;
        try {
          roomProgram = await programRooms(promptForAI, floorPlanApiKey);
        } catch (parseErr) {
          console.warn("[GN-012] Stage 1 AI failed, using regex fallback:", parseErr);
          roomProgram = programRoomsFallback(promptForAI);
        }

        console.log(`[GN-012][STAGE-1] Rooms from AI: ${roomProgram.rooms.length}`, roomProgram.rooms.map(r => `${r.name} (floor:${r.floor ?? 0})`));

        const description = programToDescription(roomProgram);

        // Multi-floor: use BSP layout engine per floor (same as standalone API)
        if (roomProgram.numFloors > 1) {
          const { layoutMultiFloor } = await import("@/lib/floor-plan/layout-engine");
          const { convertMultiFloorToProject } = await import("@/lib/floor-plan/pipeline-adapter");
          const multiFloor = layoutMultiFloor(roomProgram);
          console.log(`[GN-012][STAGE-2] Multi-floor: ${multiFloor.floors.reduce((s, f) => s + f.rooms.length, 0)} rooms placed`);
          project = convertMultiFloorToProject(multiFloor.floors, description.projectName, designBrief);
          sourceType = "ai-generated";
        } else {
          // Stage 2: AI Spatial Layout (GPT-4o with validation + retry)
          const floorPlan = await generateFloorPlan(description, floorPlanApiKey, roomProgram);

          // Stage 3: Build geometry → FloorPlanProject
          const positionedRooms = floorPlan.positionedRooms;
          const roomList = floorPlan.roomList;

          const rooms = positionedRooms
            ? positionedRooms.map((r: Record<string, unknown>) => ({
                name: r.name as string,
                type: (r.type as string ?? "other") as "living" | "bedroom" | "kitchen" | "dining" | "bathroom" | "hallway" | "entrance" | "utility" | "balcony" | "other",
                x: r.x as number, y: r.y as number,
                width: r.width as number, depth: r.depth as number,
                center: [(r.x as number) + (r.width as number) / 2, (r.y as number) + (r.depth as number) / 2] as [number, number],
                area: r.area as number,
              }))
            : roomList.map((r: Record<string, unknown>) => {
                const area = (r.area as number) ?? 16;
                const w = Math.round(Math.sqrt(area * 1.2) * 10) / 10;
                const d = Math.round((area / w) * 10) / 10;
                return {
                  name: r.name as string,
                  type: ((r.type as string) ?? "other") as "living" | "bedroom" | "kitchen" | "dining" | "bathroom" | "other",
                  x: 0, y: 0, width: w, depth: d,
                  center: [w / 2, d / 2] as [number, number],
                  area,
                };
              });

          console.log(`[GN-012][STAGE-2] Single-floor: ${rooms.length} rooms placed`);

          // Compute footprint from actual room bounding box (layout engine may
          // expand footprint beyond totalArea to fit corridor/zones)
          let bW: number, bD: number;
          if (positionedRooms && positionedRooms.length > 0) {
            bW = Math.round(Math.max(...positionedRooms.map((r: Record<string, unknown>) => (r.x as number) + (r.width as number))) * 10) / 10;
            bD = Math.round(Math.max(...positionedRooms.map((r: Record<string, unknown>) => (r.y as number) + (r.depth as number))) * 10) / 10;
          } else {
            const fpArea = floorPlan.totalArea / Math.max(floorPlan.floors, 1);
            const aspect = 1.33;
            bW = Math.round(Math.sqrt(fpArea * aspect) * 10) / 10;
            bD = Math.round((fpArea / bW) * 10) / 10;
          }

          const geometry: import("@/types/floor-plan").FloorPlanGeometry = {
            footprint: { width: bW, depth: bD },
            wallHeight: 3.0,
            walls: [], doors: [], windows: [],
            rooms,
          };

          project = convertGeometryToProject(geometry, description.projectName, designBrief);
          sourceType = "ai-generated";
        }
      } catch (aiErr) {
        console.warn("[GN-012] AI generation failed:", aiErr);
        warnings.push(`AI generation failed (${aiErr instanceof Error ? aiErr.message : String(aiErr)}), using fallback.`);
      }
    } else {
      warnings.push("No OpenAI API key — using upstream geometry or sample layout.");
    }
  }

  // ── Fallback: parse upstream geometry via adaptNodeInput ──
  if (!project) {
    const hasUpstreamGeometry = inputData?.geometry && typeof inputData.geometry === "object";
    const hasUpstreamRoomList = Array.isArray(inputData?.roomList);
    const adaptInput = (hasUpstreamGeometry || hasUpstreamRoomList)
      ? (inputData ?? {}) as Record<string, unknown>
      : (inputData?._raw ?? inputData ?? {}) as Record<string, unknown>;
    const adapted = adaptNodeInput(adaptInput, designBrief);
    project = adapted.project;
    sourceType = adapted.sourceType;
    warnings.push(...adapted.warnings);
  }

  const floor = project.floors[0];
  if (!floor) throw new Error("FloorPlanProject has no floors");

  // Compute all outputs
  const boqQuantities = computeBOQQuantities(project);
  const roomSchedule = extractRoomSchedule(project);
  const massingGeometry = convertFloorPlanToMassing(project);
  const boqExporterData = formatBOQForExporter(boqQuantities, project.metadata.project_type ?? "residential");

  let svgContent = "";
  try {
    svgContent = exportFloorToSvg(floor, project.name, {
      includeRoomFills: true,
      includeDimensions: true,
      includeGrid: false,
      displayUnit: (project.settings.display_unit as "mm" | "cm" | "m") ?? "mm",
    });
  } catch { /* SVG export is non-critical */ }

  const totalArea = floor.rooms.reduce((s, r) => s + r.area_sqm, 0);
  const boqTable = formatBOQAsTable(boqExporterData);

  return {
    id: `art_${generateId()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      label: `Floor Plan Editor — ${project.name}`,
      interactive: true,
      sourceType,
      warnings,

      // Full project for the interactive editor
      floorPlanProject: project,

      // Structured outputs for downstream nodes
      boqQuantities,
      roomSchedule,
      massingGeometry,
      svgContent,

      // EX-002 compatible: _boqData for XLSX generation
      _boqData: boqExporterData,
      _currency: "INR",
      _currencySymbol: "₹",
      _region: "India",
      _gfa: Math.round(totalArea * 100) / 100,

      // EX-002 compatible: rows + headers for validation
      rows: boqTable.rows,
      headers: boqTable.headers,
      _totalCost: null, // Costing handled by TR-008 downstream

      // Summary metrics
      summary: {
        totalRooms: floor.rooms.length,
        totalArea_sqm: Math.round(totalArea * 100) / 100,
        totalWalls: floor.walls.length,
        totalDoors: floor.doors.length,
        totalWindows: floor.windows.length,
        totalColumns: floor.columns.length,
        totalStairs: floor.stairs.length,
        floorCount: project.floors.length,
        buildingType: project.metadata.project_type ?? "residential",
      },

      // Port outputs (keyed by output port ID for downstream consumption)
      _outputs: {
        "project-out": project,
        "geo-out": massingGeometry,
        "schedule-out": roomSchedule,
        "boq-out": {
          ...boqQuantities,
          _boqData: boqExporterData,
          _currency: "INR",
          _currencySymbol: "₹",
          _region: "India",
          _gfa: Math.round(totalArea * 100) / 100,
          rows: boqTable.rows,
          headers: boqTable.headers,
        },
        "svg-out": svgContent,
      },
    },
    metadata: { engine: "floor-plan-cad", real: true, interactive: true },
    createdAt: new Date(),
  };
};
