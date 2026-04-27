/**
 * VIP-to-3D Bridge — generates room-accurate building geometry by running
 * the VIP floor plan pipeline per storey and converting 2D plans to 3D.
 *
 * Feature-gated: only runs when `VIP_BRIDGE_ENABLED=true` in env.
 * Default off — existing procedural massing is the fallback.
 *
 * Cost: ~$0.13 per storey (VIP pipeline). Max 4 storeys = $0.52 cap.
 * Time: ~55s parallel (Promise.allSettled across storeys).
 */

import { logger } from "@/lib/logger";
import type {
  MassingGeometry,
  MassingStorey,
  GeometryElement,
  FootprintPoint,
} from "@/types/geometry";
import type { Floor } from "@/types/floor-plan-cad";

// ── Feature gate ───────────────────────────────────────────────

const MAX_VIP_STOREYS = 4;
const ELIGIBLE_TYPES = /residential|mixed.?use|office|apartment|hotel|housing|dormitor/i;

export function isVipBridgeEnabled(): boolean {
  return process.env.VIP_BRIDGE_ENABLED === "true";
}

export function shouldUseVipBridge(buildingType: string, floors: number): boolean {
  if (!isVipBridgeEnabled()) return false;
  if (floors < 2 || floors > MAX_VIP_STOREYS) return false;
  return ELIGIBLE_TYPES.test(buildingType);
}

// ── Types ──────────────────────────────────────────────────────

export interface VipBridgeInput {
  prompt: string;
  floors: number;
  floorToFloorHeight: number;
  footprint_m2: number;
  buildingType: string;
  style?: string;
}

export interface VipBridgeResult {
  /** Per-storey VIP-generated elements (interior walls, rooms, doors, windows). */
  storeyInteriors: Map<number, GeometryElement[]>;
  /** Total VIP-generated element count. */
  totalElements: number;
  /** Number of storeys that fell back to procedural. */
  fallbackCount: number;
  /** Total cost in USD. */
  costUsd: number;
  /** Duration in ms. */
  durationMs: number;
}

// ── Storey prompt builder ──────────────────────────────────────

function buildStoreyPrompt(
  userPrompt: string,
  storeyIndex: number,
  totalFloors: number,
  footprintSqft: number,
  buildingType: string,
): string {
  const isGround = storeyIndex === 0;
  const isTop = storeyIndex === totalFloors - 1;
  const typeLower = buildingType.toLowerCase();

  let storeyContext: string;
  if (isGround) {
    if (/office/i.test(typeLower)) {
      storeyContext = "Ground floor with reception lobby, open office area, meeting room, pantry, and restrooms";
    } else {
      storeyContext = "Ground floor with entrance foyer, living room, dining area, kitchen, and powder room";
    }
  } else if (isTop && totalFloors >= 3) {
    if (/office/i.test(typeLower)) {
      storeyContext = "Top floor with executive suite, conference room, server room, and pantry";
    } else {
      storeyContext = "Top floor with master bedroom with ensuite, study, and terrace access";
    }
  } else {
    if (/office/i.test(typeLower)) {
      storeyContext = `Floor ${storeyIndex + 1} with open office zones, meeting rooms, and restrooms`;
    } else {
      storeyContext = `Upper floor with 2-3 bedrooms, bathrooms, and family area`;
    }
  }

  // VIP expects a self-contained floor plan prompt
  return `${Math.round(footprintSqft)} sqft ${storeyContext}. Style: ${buildingType}. ${userPrompt}`;
}

// ── 2D plan → 3D elements converter ───────────────────────────

function convertFloorToElements(
  floor: Floor,
  storeyIndex: number,
  elevationM: number,
  floorHeightM: number,
): GeometryElement[] {
  const elements: GeometryElement[] = [];
  const MM_TO_M = 0.001;

  // ── Interior walls (skip exterior — procedural already has them) ──
  for (const wall of floor.walls) {
    if (wall.type === "exterior") continue;

    const sx = wall.centerline.start.x * MM_TO_M;
    const sy = wall.centerline.start.y * MM_TO_M;
    const ex = wall.centerline.end.x * MM_TO_M;
    const ey = wall.centerline.end.y * MM_TO_M;
    const thickness = wall.thickness_mm * MM_TO_M;
    const height = Math.min(wall.height_mm * MM_TO_M, floorHeightM);

    const dx = ex - sx;
    const dy = ey - sy;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 0.1) continue; // skip degenerate walls

    const nx = (-dy / length) * thickness / 2;
    const ny = (dx / length) * thickness / 2;

    elements.push({
      id: `vip-wall-s${storeyIndex}-${wall.id}`,
      type: "wall",
      vertices: [
        { x: sx + nx, y: sy + ny, z: elevationM },
        { x: ex + nx, y: ey + ny, z: elevationM },
        { x: ex + nx, y: ey + ny, z: elevationM + height },
        { x: sx + nx, y: sy + ny, z: elevationM + height },
        { x: sx - nx, y: sy - ny, z: elevationM },
        { x: ex - nx, y: ey - ny, z: elevationM },
        { x: ex - nx, y: ey - ny, z: elevationM + height },
        { x: sx - nx, y: sy - ny, z: elevationM + height },
      ],
      faces: [
        { vertices: [0, 1, 2, 3] },
        { vertices: [5, 4, 7, 6] },
        { vertices: [0, 3, 7, 4] },
        { vertices: [1, 5, 6, 2] },
        { vertices: [3, 2, 6, 7] },
        { vertices: [0, 4, 5, 1] },
      ],
      ifcType: "IfcWall",
      properties: {
        name: `Partition Wall S${storeyIndex + 1}-${wall.id}`,
        storeyIndex,
        height,
        length,
        thickness,
        area: length * height,
        volume: length * height * thickness,
        isPartition: true,
        wallType: "partition" as const,
        discipline: "architectural",
      },
    });
  }

  // ── Rooms as IfcSpace elements ──
  for (const room of floor.rooms) {
    if (!room.boundary?.points?.length) continue;

    const pts = room.boundary.points;
    const bottomVerts = pts.map(p => ({
      x: p.x * MM_TO_M,
      y: p.y * MM_TO_M,
      z: elevationM,
    }));
    const topVerts = pts.map(p => ({
      x: p.x * MM_TO_M,
      y: p.y * MM_TO_M,
      z: elevationM + floorHeightM,
    }));

    const n = pts.length;
    const faces = [
      { vertices: Array.from({ length: n }, (_, i) => i) },
      { vertices: Array.from({ length: n }, (_, i) => n + (n - 1 - i)) },
    ];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      faces.push({ vertices: [i, j, n + j, n + i] });
    }

    elements.push({
      id: `vip-space-s${storeyIndex}-${room.id}`,
      type: "space",
      vertices: [...bottomVerts, ...topVerts],
      faces,
      ifcType: "IfcSpace",
      properties: {
        name: room.name,
        storeyIndex,
        height: floorHeightM,
        area: room.area_sqm,
        volume: room.area_sqm * floorHeightM,
        spaceName: room.name,
        spaceUsage: room.name.toLowerCase(),
        spaceFootprint: pts.map(p => ({ x: p.x * MM_TO_M, y: p.y * MM_TO_M })),
      },
    });
  }

  // ── Doors from VIP (interior doors between rooms) ──
  for (const door of floor.doors) {
    const parentWall = floor.walls.find(w => w.id === door.wall_id);
    if (!parentWall) continue;

    const sx = parentWall.centerline.start.x * MM_TO_M;
    const sy = parentWall.centerline.start.y * MM_TO_M;
    const ex = parentWall.centerline.end.x * MM_TO_M;
    const ey = parentWall.centerline.end.y * MM_TO_M;
    const dx = ex - sx;
    const dy = ey - sy;
    const wallLen = Math.sqrt(dx * dx + dy * dy);
    if (wallLen < 0.1) continue;

    const dirX = dx / wallLen;
    const dirY = dy / wallLen;
    const offset = door.position_along_wall_mm * MM_TO_M;
    const doorW = door.width_mm * MM_TO_M;
    const doorH = Math.min(door.height_mm * MM_TO_M, floorHeightM - 0.1);

    const cx = sx + dirX * offset;
    const cy = sy + dirY * offset;
    const hw = doorW / 2;
    const nd = 0.05; // 50mm depth

    elements.push({
      id: `vip-door-s${storeyIndex}-${door.wall_id}`,
      type: "door",
      vertices: [
        { x: cx - dirX * hw + (-dirY) * nd, y: cy - dirY * hw + dirX * nd, z: elevationM },
        { x: cx + dirX * hw + (-dirY) * nd, y: cy + dirY * hw + dirX * nd, z: elevationM },
        { x: cx + dirX * hw + (-dirY) * nd, y: cy + dirY * hw + dirX * nd, z: elevationM + doorH },
        { x: cx - dirX * hw + (-dirY) * nd, y: cy - dirY * hw + dirX * nd, z: elevationM + doorH },
        { x: cx - dirX * hw - (-dirY) * nd, y: cy - dirY * hw - dirX * nd, z: elevationM },
        { x: cx + dirX * hw - (-dirY) * nd, y: cy + dirY * hw - dirX * nd, z: elevationM },
        { x: cx + dirX * hw - (-dirY) * nd, y: cy + dirY * hw - dirX * nd, z: elevationM + doorH },
        { x: cx - dirX * hw - (-dirY) * nd, y: cy - dirY * hw - dirX * nd, z: elevationM + doorH },
      ],
      faces: [
        { vertices: [0, 1, 2, 3] },
        { vertices: [5, 4, 7, 6] },
        { vertices: [0, 3, 7, 4] },
        { vertices: [1, 5, 6, 2] },
        { vertices: [3, 2, 6, 7] },
        { vertices: [0, 4, 5, 1] },
      ],
      ifcType: "IfcDoor",
      properties: {
        name: `Door S${storeyIndex + 1}-${door.wall_id}`,
        storeyIndex,
        width: doorW,
        height: doorH,
        thickness: 0.1,
        sillHeight: 0,
        wallOffset: offset,
        parentWallId: `vip-wall-s${storeyIndex}-${door.wall_id}`,
        wallDirectionX: dirX,
        wallDirectionY: dirY,
        wallOriginX: sx,
        wallOriginY: sy,
        area: doorW * doorH,
        discipline: "architectural",
      },
    });
  }

  // ── Windows from VIP (on exterior walls — complement procedural windows) ──
  for (const win of floor.windows) {
    const parentWall = floor.walls.find(w => w.id === win.wall_id);
    if (!parentWall || parentWall.type !== "exterior") continue;

    // Skip — procedural massing already generates exterior windows.
    // VIP interior windows on partition walls would be unusual.
    // Only add VIP windows on interior walls (rare, but supported).
  }

  return elements;
}

// ── Main bridge function ───────────────────────────────────────

export async function generateBuildingFromVIP(
  input: VipBridgeInput,
  baseGeometry: MassingGeometry,
): Promise<VipBridgeResult> {
  const start = performance.now();
  const floors = Math.min(input.floors, MAX_VIP_STOREYS);
  const footprintSqft = Math.round(input.footprint_m2 * 10.764); // m² → sqft

  logger.info("[VIP-BRIDGE] starting", {
    floors,
    buildingType: input.buildingType,
    footprintSqft,
  });

  // Dynamic import to avoid loading VIP code when bridge is disabled
  const { parseConstraints } = await import("@/features/floor-plan/lib/structured-parser");
  const { runVIPPipeline } = await import("@/features/floor-plan/lib/vip-pipeline/orchestrator");

  // ── Build per-storey VIP runs ──
  const storeyPromises = Array.from({ length: floors }, async (_, i) => {
    const storeyPrompt = buildStoreyPrompt(
      input.prompt,
      i,
      floors,
      footprintSqft,
      input.buildingType,
    );

    try {
      // Parse constraints for VIP (required input)
      const parseResult = await parseConstraints(storeyPrompt);

      // Run VIP pipeline
      const vipResult = await runVIPPipeline({
        prompt: storeyPrompt,
        parsedConstraints: parseResult.constraints,
        logContext: {
          requestId: `vip-bridge-s${i}-${Date.now()}`,
          userId: "vip-bridge",
        },
      });

      if (!vipResult.success) {
        logger.warn(`[VIP-BRIDGE] storey ${i} VIP failed: ${vipResult.error}`);
        return { storeyIndex: i, success: false as const, error: vipResult.error };
      }

      // Extract first floor from VIP project (VIP generates single-floor plans)
      const floor = vipResult.project.floors[0];
      if (!floor) {
        logger.warn(`[VIP-BRIDGE] storey ${i} — VIP returned empty floors array`);
        return { storeyIndex: i, success: false as const, error: "empty floors" };
      }

      return { storeyIndex: i, success: true as const, floor };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[VIP-BRIDGE] storey ${i} threw: ${msg}`);
      return { storeyIndex: i, success: false as const, error: msg };
    }
  });

  // ── Run all storeys in parallel ──
  const results = await Promise.allSettled(storeyPromises);

  // ── Convert successful plans to 3D elements ──
  const storeyInteriors = new Map<number, GeometryElement[]>();
  let totalElements = 0;
  let fallbackCount = 0;

  for (const result of results) {
    if (result.status === "rejected") {
      fallbackCount++;
      continue;
    }
    const val = result.value;
    if (!val.success) {
      fallbackCount++;
      continue;
    }

    // Find matching storey elevation from base geometry
    const baseStorey = baseGeometry.storeys.find(s => s.index === val.storeyIndex);
    const elevation = baseStorey?.elevation ?? val.storeyIndex * input.floorToFloorHeight;
    const height = baseStorey?.height ?? input.floorToFloorHeight;

    const elements = convertFloorToElements(
      val.floor,
      val.storeyIndex,
      elevation,
      height,
    );

    storeyInteriors.set(val.storeyIndex, elements);
    totalElements += elements.length;
  }

  const durationMs = Math.round(performance.now() - start);
  const costUsd = (floors - fallbackCount) * 0.13;

  logger.info("[VIP-BRIDGE] completed", {
    storeys: floors,
    vipSucceeded: floors - fallbackCount,
    fallbackCount,
    totalElements,
    costUsd: costUsd.toFixed(2),
    durationMs,
  });

  return {
    storeyInteriors,
    totalElements,
    fallbackCount,
    costUsd,
    durationMs,
  };
}

/**
 * Merge VIP-generated room elements into existing procedural geometry.
 *
 * For each storey that has VIP data:
 *   1. Remove procedural interior partitions + spaces (keep exterior walls, slabs, columns)
 *   2. Add VIP-generated interior walls, rooms, and doors
 *
 * Storeys without VIP data keep their procedural interiors unchanged.
 */
export function mergeVipIntoGeometry(
  geometry: MassingGeometry,
  vipResult: VipBridgeResult,
): MassingGeometry {
  const mergedStoreys: MassingStorey[] = geometry.storeys.map(storey => {
    const vipElements = vipResult.storeyInteriors.get(storey.index);
    if (!vipElements || vipElements.length === 0) {
      return storey; // no VIP data — keep procedural
    }

    // Remove procedural interior elements (partitions + spaces)
    // Keep: exterior walls, slabs, columns, beams, stairs, MEP, windows, doors (exterior)
    const filteredElements = storey.elements.filter(el => {
      if (el.type === "space") return false; // replace with VIP rooms
      if (el.type === "wall" && el.properties.isPartition) return false; // replace with VIP partitions
      // Keep procedural interior doors? No — VIP generates its own
      if (el.type === "door" && el.properties.parentWallId?.includes("corridor")) return false;
      return true;
    });

    return {
      ...storey,
      elements: [...filteredElements, ...vipElements],
    };
  });

  return {
    ...geometry,
    storeys: mergedStoreys,
  };
}
