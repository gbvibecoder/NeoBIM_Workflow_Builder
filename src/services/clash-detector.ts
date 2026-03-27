/**
 * Clash Detection Service
 *
 * Detects spatial overlaps between IFC building elements using AABB
 * (Axis-Aligned Bounding Box) intersection analysis. Uses web-ifc
 * to stream mesh geometry and compute per-element bounding boxes,
 * then a uniform spatial grid for efficient O(N) clash detection.
 */

import {
  IfcAPI,
  IFCBUILDINGSTOREY,
  IFCWALL,
  IFCWALLSTANDARDCASE,
  IFCWINDOW,
  IFCDOOR,
  IFCSLAB,
  IFCCOLUMN,
  IFCBEAM,
  IFCSTAIR,
  IFCRAILING,
  IFCCOVERING,
  IFCROOF,
  IFCFOOTING,
  IFCBUILDINGELEMENTPROXY,
  IFCMEMBER,
  IFCPLATE,
  IFCCURTAINWALL,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
} from "web-ifc";

// ─── IFC type constants not exported by web-ifc ─────────────────────
const IFCSTAIRFLIGHT = 4252922144;
const IFCFURNISHINGELEMENT = 263784265;
const IFCFLOWSEGMENT = 987401354;
const IFCFLOWTERMINAL = 2058353004;
const IFCFLOWFITTING = 4278956645;
const IFCSPACE = 3856911033;
const IFCOPENINGELEMENT = 3588315303;

// ─── Building element types to analyze ──────────────────────────────
const BUILDING_ELEMENTS = [
  IFCWALL, IFCWALLSTANDARDCASE, IFCWINDOW, IFCDOOR, IFCSLAB,
  IFCCOLUMN, IFCBEAM, IFCSTAIR, IFCSTAIRFLIGHT, IFCRAILING,
  IFCCOVERING, IFCROOF, IFCFOOTING, IFCBUILDINGELEMENTPROXY,
  IFCMEMBER, IFCPLATE, IFCCURTAINWALL, IFCFURNISHINGELEMENT,
  IFCFLOWSEGMENT, IFCFLOWTERMINAL, IFCFLOWFITTING,
];

// Readable names for IFC type IDs
const TYPE_NAMES: Record<number, string> = {
  [IFCWALL]: "Wall",
  [IFCWALLSTANDARDCASE]: "Wall",
  [IFCWINDOW]: "Window",
  [IFCDOOR]: "Door",
  [IFCSLAB]: "Slab",
  [IFCCOLUMN]: "Column",
  [IFCBEAM]: "Beam",
  [IFCSTAIR]: "Stair",
  [IFCSTAIRFLIGHT]: "Stair Flight",
  [IFCRAILING]: "Railing",
  [IFCCOVERING]: "Covering",
  [IFCROOF]: "Roof",
  [IFCFOOTING]: "Footing",
  [IFCBUILDINGELEMENTPROXY]: "Building Element",
  [IFCMEMBER]: "Member",
  [IFCPLATE]: "Plate",
  [IFCCURTAINWALL]: "Curtain Wall",
  [IFCFURNISHINGELEMENT]: "Furnishing",
  [IFCFLOWSEGMENT]: "Pipe/Duct",
  [IFCFLOWTERMINAL]: "Terminal",
  [IFCFLOWFITTING]: "Fitting",
  [IFCSPACE]: "Space",
  [IFCOPENINGELEMENT]: "Opening",
};

// MEP element types (for severity classification)
const MEP_TYPES = new Set([IFCFLOWSEGMENT, IFCFLOWTERMINAL, IFCFLOWFITTING]);

// Structural element types
const STRUCTURAL_TYPES = new Set([IFCCOLUMN, IFCBEAM, IFCSLAB, IFCFOOTING, IFCMEMBER, IFCPLATE]);

// ─── Types ──────────────────────────────────────────────────────────

export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

export interface ElementBBox {
  expressID: number;
  typeID: number;
  type: string;
  name: string;
  storey: string;
  aabb: AABB;
}

export type ClashSeverity = "hard" | "soft" | "clearance";

export interface ClashResult {
  id: string;
  elementA: { expressID: number; type: string; name: string; storey: string };
  elementB: { expressID: number; type: string; name: string; storey: string };
  severity: ClashSeverity;
  overlapVolume: number;
  overlapCenter: [number, number, number];
  description: string;
}

export interface ClashDetectionResult {
  meta: {
    totalElements: number;
    elementsWithGeometry: number;
    processingTimeMs: number;
    clashesFound: number;
    hardClashes: number;
    softClashes: number;
    clearanceClashes: number;
  };
  clashes: ClashResult[];
}

export interface ClashDetectionOptions {
  tolerance?: number;     // Minimum overlap in meters on each axis (default 0.025 = 25mm)
  maxClashes?: number;    // Cap on reported clashes (default 5000)
  cellSize?: number;      // Spatial grid cell size in meters (default 2.0)
  timeoutMs?: number;     // Processing timeout in ms (default 120000)
}

// ─── AABB Utility Functions ─────────────────────────────────────────

/** Check if two AABBs overlap by more than tolerance on all 3 axes */
export function aabbOverlap(
  a: AABB,
  b: AABB,
  tolerance: number
): { volume: number; center: [number, number, number] } | null {
  const overlapX = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const overlapY = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const overlapZ = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);

  if (overlapX <= tolerance || overlapY <= tolerance || overlapZ <= tolerance) {
    return null;
  }

  const volume = overlapX * overlapY * overlapZ;
  const center: [number, number, number] = [
    (Math.max(a.min[0], b.min[0]) + Math.min(a.max[0], b.max[0])) / 2,
    (Math.max(a.min[1], b.min[1]) + Math.min(a.max[1], b.max[1])) / 2,
    (Math.max(a.min[2], b.min[2]) + Math.min(a.max[2], b.max[2])) / 2,
  ];

  return { volume, center };
}

/** Classify clash severity based on element types and overlap volume */
export function classifySeverity(
  a: ElementBBox,
  b: ElementBBox,
  overlapVolume: number
): ClashSeverity {
  // MEP vs structural = always hard
  const aIsMEP = MEP_TYPES.has(a.typeID);
  const bIsMEP = MEP_TYPES.has(b.typeID);
  const aIsStructural = STRUCTURAL_TYPES.has(a.typeID);
  const bIsStructural = STRUCTURAL_TYPES.has(b.typeID);

  if ((aIsMEP && bIsStructural) || (bIsMEP && aIsStructural)) {
    return "hard";
  }

  // MEP vs MEP = hard (two pipes can't occupy same space)
  if (aIsMEP && bIsMEP) {
    return "hard";
  }

  // Volume-based classification for other pairs
  if (overlapVolume > 0.1) return "hard";
  if (overlapVolume > 0.001) return "soft";
  return "clearance";
}

// ─── False Positive Filtering ───────────────────────────────────────

/** Returns true if the element pair should be filtered out (not a real clash) */
export function shouldFilter(a: ElementBBox, b: ElementBBox): boolean {
  const typeA = a.typeID;
  const typeB = b.typeID;

  // Helper: check if pair contains specific types (order-independent)
  const pairHas = (t1: number | number[], t2: number | number[]): boolean => {
    const set1 = Array.isArray(t1) ? t1 : [t1];
    const set2 = Array.isArray(t2) ? t2 : [t2];
    return (set1.includes(typeA) && set2.includes(typeB)) ||
           (set1.includes(typeB) && set2.includes(typeA));
  };

  const wallTypes = [IFCWALL, IFCWALLSTANDARDCASE];

  // 1. Wall↔Wall same storey (T-junctions, corners)
  if (wallTypes.includes(typeA) && wallTypes.includes(typeB) && a.storey === b.storey) {
    return true;
  }

  // 2. Wall↔Slab (walls sit on slabs)
  if (pairHas(wallTypes, IFCSLAB)) return true;

  // 3. Column↔Slab (columns penetrate slabs)
  if (pairHas(IFCCOLUMN, IFCSLAB)) return true;

  // 4. Column↔Beam (beam-column joints)
  if (pairHas(IFCCOLUMN, IFCBEAM)) return true;

  // 5. Column↔Wall (columns embedded in walls at corners/intersections)
  if (pairHas(IFCCOLUMN, wallTypes)) return true;

  // 6. Beam↔Slab (beams support slabs)
  if (pairHas(IFCBEAM, IFCSLAB)) return true;

  // 6. Door/Window↔Wall (openings in walls)
  if (pairHas([IFCDOOR, IFCWINDOW], wallTypes)) return true;

  // 7. Covering↔Wall/Slab (finishes on surfaces)
  if (pairHas(IFCCOVERING, [...wallTypes, IFCSLAB])) return true;

  // 8. Footing↔Column (foundation connections)
  if (pairHas(IFCFOOTING, IFCCOLUMN)) return true;

  // 9. Stair↔Slab (stair connections)
  if (pairHas([IFCSTAIR, IFCSTAIRFLIGHT], IFCSLAB)) return true;

  // 11. Beam↔Wall (beams sit on top of or span across walls)
  if (pairHas(IFCBEAM, wallTypes)) return true;

  // 12. Roof↔Wall (roof structure rests on walls)
  if (pairHas(IFCROOF, wallTypes)) return true;

  // 13. Railing↔Slab (railings mounted on slabs)
  if (pairHas(IFCRAILING, IFCSLAB)) return true;

  // 14. IfcOpeningElement — virtual, always skip
  if (typeA === IFCOPENINGELEMENT || typeB === IFCOPENINGELEMENT) return true;

  // 15. IfcSpace — virtual spatial zones, always skip
  if (typeA === IFCSPACE || typeB === IFCSPACE) return true;

  return false;
}

// ─── Spatial Grid ───────────────────────────────────────────────────

type GridKey = string;

export function buildSpatialGrid(
  elements: ElementBBox[],
  cellSize: number = 2.0
): Map<GridKey, number[]> {
  const grid = new Map<GridKey, number[]>();

  for (let idx = 0; idx < elements.length; idx++) {
    const { aabb } = elements[idx];
    const minIX = Math.floor(aabb.min[0] / cellSize);
    const minIY = Math.floor(aabb.min[1] / cellSize);
    const minIZ = Math.floor(aabb.min[2] / cellSize);
    const maxIX = Math.floor(aabb.max[0] / cellSize);
    const maxIY = Math.floor(aabb.max[1] / cellSize);
    const maxIZ = Math.floor(aabb.max[2] / cellSize);

    for (let ix = minIX; ix <= maxIX; ix++) {
      for (let iy = minIY; iy <= maxIY; iy++) {
        for (let iz = minIZ; iz <= maxIZ; iz++) {
          const key = `${ix},${iy},${iz}`;
          let cell = grid.get(key);
          if (!cell) {
            cell = [];
            grid.set(key, cell);
          }
          cell.push(idx);
        }
      }
    }
  }

  return grid;
}

// ─── Core Detection ─────────────────────────────────────────────────

export function detectClashes(
  elements: ElementBBox[],
  options: ClashDetectionOptions = {}
): ClashResult[] {
  const {
    tolerance = 0.025,
    maxClashes = 5000,
    cellSize = 2.0,
    timeoutMs = 120_000,
  } = options;

  const grid = buildSpatialGrid(elements, cellSize);
  const seen = new Set<string>();
  const clashes: ClashResult[] = [];
  const startTime = Date.now();

  for (const indices of grid.values()) {
    if (clashes.length >= maxClashes) break;
    if (Date.now() - startTime > timeoutMs) break;

    for (let i = 0; i < indices.length; i++) {
      if (clashes.length >= maxClashes) break;

      for (let j = i + 1; j < indices.length; j++) {
        const idxA = indices[i];
        const idxB = indices[j];
        const pairKey = idxA < idxB ? `${idxA}-${idxB}` : `${idxB}-${idxA}`;

        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const a = elements[idxA];
        const b = elements[idxB];

        if (shouldFilter(a, b)) continue;

        const overlap = aabbOverlap(a.aabb, b.aabb, tolerance);
        if (!overlap) continue;

        const severity = classifySeverity(a, b, overlap.volume);

        clashes.push({
          id: `clash-${clashes.length + 1}`,
          elementA: { expressID: a.expressID, type: a.type, name: a.name, storey: a.storey },
          elementB: { expressID: b.expressID, type: b.type, name: b.name, storey: b.storey },
          severity,
          overlapVolume: Math.round(overlap.volume * 1_000_000) / 1_000_000, // 6 decimal places
          overlapCenter: overlap.center.map(v => Math.round(v * 1000) / 1000) as [number, number, number],
          description: `${a.type} "${a.name}" clashes with ${b.type} "${b.name}"`,
        });

        if (clashes.length >= maxClashes) break;
      }
    }
  }

  return clashes;
}

// ─── AABB Extraction from IFC Buffer ────────────────────────────────

/**
 * Apply a 4x4 column-major transformation matrix to a 3D point
 */
function transformPoint(
  x: number, y: number, z: number,
  m: number[]
): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export async function computeElementAABBs(buffer: Uint8Array): Promise<ElementBBox[]> {
  const ifcAPI = new IfcAPI();
  const path = await import("path");
  const wasmDir = path.resolve(process.cwd(), "node_modules", "web-ifc") + "/";
  ifcAPI.SetWasmPath(wasmDir, true);
  await ifcAPI.Init();

  const modelID = ifcAPI.OpenModel(buffer, {
    COORDINATE_TO_ORIGIN: true,
  });

  try {
    // ── Build storey map ──
    const storeyMap = new Map<number, string>();
    const storeyIDs = ifcAPI.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY);
    for (let i = 0; i < storeyIDs.size(); i++) {
      const storeyID = storeyIDs.get(i);
      try {
        const storey = ifcAPI.GetLine(modelID, storeyID, false);
        storeyMap.set(storeyID, storey?.Name?.value || `Level ${i + 1}`);
      } catch { /* skip */ }
    }

    // ── Build element → storey lookup ──
    const elementStoreyLookup = new Map<number, string>();
    try {
      const relContIds = ifcAPI.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE);
      for (let i = 0; i < relContIds.size(); i++) {
        try {
          const rel = ifcAPI.GetLine(modelID, relContIds.get(i), false);
          const storeyRef = rel?.RelatingStructure?.value;
          if (typeof storeyRef !== "number") continue;
          const storeyName = storeyMap.get(storeyRef) || "Unassigned";
          const relatedElements = rel?.RelatedElements;
          const refs = Array.isArray(relatedElements) ? relatedElements : [relatedElements];
          for (const ref of refs) {
            const elId = (ref as { value?: number })?.value;
            if (typeof elId === "number") elementStoreyLookup.set(elId, storeyName);
          }
        } catch { /* skip malformed relationship */ }
      }
    } catch { /* skip */ }

    // ── Build type map ──
    const typeMap = new Map<number, number>();
    for (const tid of BUILDING_ELEMENTS) {
      try {
        const ids = ifcAPI.GetLineIDsWithType(modelID, tid);
        for (let i = 0; i < ids.size(); i++) {
          typeMap.set(ids.get(i), tid);
        }
      } catch { /* skip */ }
    }

    // ── Build name map ──
    const nameMap = new Map<number, string>();
    for (const [expressID] of typeMap) {
      try {
        const line = ifcAPI.GetLine(modelID, expressID, false);
        if (line?.Name?.value) {
          nameMap.set(expressID, line.Name.value);
        }
      } catch { /* skip */ }
    }

    // ── Stream meshes and compute AABBs ──
    const aabbMap = new Map<number, AABB>();

    ifcAPI.StreamAllMeshes(modelID, (mesh: {
      expressID: number;
      geometries: {
        size: () => number;
        get: (i: number) => {
          color: { x: number; y: number; z: number; w: number };
          geometryExpressID: number;
          flatTransformation: number[];
        };
      };
    }) => {
      const expressID = mesh.expressID;
      // Only process building elements we care about
      if (!typeMap.has(expressID)) return;

      const geoCount = mesh.geometries.size();

      for (let i = 0; i < geoCount; i++) {
        const pg = mesh.geometries.get(i);
        let geom;
        try {
          geom = ifcAPI.GetGeometry(modelID, pg.geometryExpressID);
        } catch {
          continue;
        }

        const verts = ifcAPI.GetVertexArray(
          geom.GetVertexData(),
          geom.GetVertexDataSize()
        );

        if (verts.length === 0) {
          geom.delete();
          continue;
        }

        const transform = pg.flatTransformation;
        let current = aabbMap.get(expressID);
        if (!current) {
          current = {
            min: [Infinity, Infinity, Infinity],
            max: [-Infinity, -Infinity, -Infinity],
          };
          aabbMap.set(expressID, current);
        }

        // Stride = 6 (x, y, z, nx, ny, nz)
        const vertexCount = verts.length / 6;
        for (let v = 0; v < vertexCount; v++) {
          const lx = verts[v * 6];
          const ly = verts[v * 6 + 1];
          const lz = verts[v * 6 + 2];

          // Apply 4x4 transformation (column-major)
          const [wx, wy, wz] = transformPoint(lx, ly, lz, transform);

          current.min[0] = Math.min(current.min[0], wx);
          current.min[1] = Math.min(current.min[1], wy);
          current.min[2] = Math.min(current.min[2], wz);
          current.max[0] = Math.max(current.max[0], wx);
          current.max[1] = Math.max(current.max[1], wy);
          current.max[2] = Math.max(current.max[2], wz);
        }

        geom.delete();
      }
    });

    // ── Build result array ──
    const elements: ElementBBox[] = [];
    for (const [expressID, aabb] of aabbMap) {
      // Skip elements with degenerate AABBs (no real geometry)
      if (aabb.min[0] === Infinity) continue;

      const typeID = typeMap.get(expressID) || 0;
      elements.push({
        expressID,
        typeID,
        type: TYPE_NAMES[typeID] || "Unknown",
        name: nameMap.get(expressID) || `#${expressID}`,
        storey: elementStoreyLookup.get(expressID) || "Unassigned",
        aabb,
      });
    }

    return elements;
  } finally {
    ifcAPI.CloseModel(modelID);
  }
}

// ─── Main Entry Point ───────────────────────────────────────────────

export async function detectClashesFromBuffer(
  buffer: Uint8Array,
  options: ClashDetectionOptions = {}
): Promise<ClashDetectionResult> {
  const startTime = Date.now();

  // Step 1: Extract element AABBs from IFC geometry
  const elements = await computeElementAABBs(buffer);

  // Step 2: Run clash detection
  const clashes = detectClashes(elements, options);

  // Step 3: Compute statistics
  const hardClashes = clashes.filter(c => c.severity === "hard").length;
  const softClashes = clashes.filter(c => c.severity === "soft").length;
  const clearanceClashes = clashes.filter(c => c.severity === "clearance").length;

  return {
    meta: {
      totalElements: elements.length,
      elementsWithGeometry: elements.length,
      processingTimeMs: Date.now() - startTime,
      clashesFound: clashes.length,
      hardClashes,
      softClashes,
      clearanceClashes,
    },
    clashes,
  };
}
