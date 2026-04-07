import { generateFloorPlan, generateId } from "./deps";
import type { NodeHandler } from "./types";

/**
 * GN-004 — Floor Plan Generator (GPT-4o SVG generation)
 * Pure copy from execute-node/route.ts (lines 1242-1320 of the pre-decomposition file).
 */
export const handleGN004: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId, apiKey } = ctx;
  // Floor Plan Generator — GPT-4o SVG generation
  const description = inputData?._raw ?? inputData ?? {};
  const floorPlan = await generateFloorPlan(description, apiKey);

  // Build geometry data for GN-011 consumption
  // Use the first floor's rooms for the 3D viewer, with proper per-floor data
  const floorRoomsForGeometry = floorPlan.perFloorRooms ?? [{ floorLabel: "Ground Floor", rooms: floorPlan.roomList.map(r => ({ name: r.name, area: r.area, type: "living" })) }];
  const primaryFloorRooms = floorRoomsForGeometry[0]?.rooms ?? [];

  // Estimate building dimensions from total area / floors
  const fpArea = floorPlan.totalArea / Math.max(floorPlan.floors, 1);
  const bAspect = 1.33;
  const bW = Math.sqrt(fpArea * bAspect);
  const bD = fpArea / bW;

  // Create room layout for GN-011 3D viewer
  // Use AI-positioned rooms if available, otherwise fall back to row-based layout
  const geometryRows: Array<Array<Record<string, unknown>>> = [];
  let currentGeoRow: Array<Record<string, unknown>> = [];
  for (const rm of primaryFloorRooms) {
    const roomArea = rm.area;
    const roomW = Math.sqrt(roomArea * 1.2);
    const roomD = roomArea / roomW;
    currentGeoRow.push({
      name: rm.name,
      type: rm.type,
      width: Math.round(roomW * 10) / 10,
      depth: Math.round(roomD * 10) / 10,
    });
    if (currentGeoRow.length >= 3) {
      geometryRows.push(currentGeoRow);
      currentGeoRow = [];
    }
  }
  if (currentGeoRow.length > 0) geometryRows.push(currentGeoRow);

  // If AI returned positioned rooms, include them for accurate 3D placement
  const positionedRoomsData = floorPlan.positionedRooms
    ? floorPlan.positionedRooms.map(r => ({
        name: r.name,
        type: r.type,
        x: r.x,
        y: r.y,
        width: r.width,
        depth: r.depth,
      }))
    : undefined;

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "svg",
    data: {
      svg: floorPlan.svg,
      label: "Floor Plan (AI Generated)",
      roomList: floorPlan.roomList,
      totalArea: floorPlan.totalArea,
      floors: floorPlan.floors,
      perFloorRooms: floorPlan.perFloorRooms,
      // Provide geometry data so GN-011 can build accurate 3D
      geometry: {
        buildingWidth: Math.round(bW * 10) / 10,
        buildingDepth: Math.round(bD * 10) / 10,
        rows: geometryRows,
        rooms: positionedRoomsData ?? primaryFloorRooms.map(r => ({
          name: r.name,
          type: r.type,
          width: Math.round(Math.sqrt(r.area * 1.2) * 10) / 10,
          depth: Math.round((r.area / Math.sqrt(r.area * 1.2)) * 10) / 10,
        })),
        positionedRooms: positionedRoomsData,
      },
    },
    metadata: { model: "gpt-4o", real: true },
    createdAt: new Date(),
  };
};
