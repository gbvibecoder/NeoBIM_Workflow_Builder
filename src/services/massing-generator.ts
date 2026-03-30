/**
 * Massing Generator — produces real 3D geometry from building description.
 * Generates extruded polygon geometry programmatically using math.
 */

import type {
  MassingGeometry,
  MassingStorey,
  GeometryElement,
  FootprintPoint,
  ProgrammeEntry,
  Vertex,
  Face,
} from "@/types/geometry";

interface BuildingDescriptionInput {
  floors?: number;
  height?: number;
  footprint_m2?: number;
  footprint?: number;
  building_type?: string;
  buildingType?: string;
  total_gfa_m2?: number;
  gfa?: number;
  content?: string;
  prompt?: string;
  programme?: ProgrammeEntry[];
  _raw?: Record<string, unknown>;
}

// ─── Shape Detection ─────────────────────────────────────────────────────────

type FootprintShape = "circular" | "hexagonal" | "octagonal" | "triangular" | "l-shape" | "rectangular";

const CIRCULAR_PATTERNS = /\b(circular|round|cylindrical|rotunda|disc[\s-]?shaped|ring[\s-]?shaped|dome|silo|observatory|planetarium|amphitheatre|amphitheater)\b/i;
const HEXAGONAL_PATTERNS = /\b(hexagonal|hex[\s-]?shaped|honeycomb)\b/i;
const OCTAGONAL_PATTERNS = /\b(octagonal|oct[\s-]?shaped)\b/i;
const TRIANGULAR_PATTERNS = /\b(triangular|tri[\s-]?shaped|pyramid)\b/i;

/**
 * Detect the footprint shape from text description and building type.
 */
function detectFootprintShape(buildingType: string, content: string): FootprintShape {
  const combined = `${buildingType} ${content}`.toLowerCase();

  // Check content first — explicit shape descriptions take priority
  if (CIRCULAR_PATTERNS.test(combined)) return "circular";
  if (HEXAGONAL_PATTERNS.test(combined)) return "hexagonal";
  if (OCTAGONAL_PATTERNS.test(combined)) return "octagonal";
  if (TRIANGULAR_PATTERNS.test(combined)) return "triangular";
  // L-shape only from buildingType or explicit "l-shape"/"courtyard" keywords — not from content alone
  const lowerType = buildingType.toLowerCase();
  if (/l-shape|courtyard/i.test(combined) || /mixed/i.test(lowerType)) return "l-shape";
  return "rectangular";
}

/**
 * Extract explicit dimensions from text content.
 * Returns diameter or radius in meters if found, otherwise null.
 */
function extractDimensionsFromContent(content: string): { diameter?: number; width?: number; depth?: number } {
  if (!content) return {};

  // Diameter: "diameter of approximately 30 meters", "30m diameter", "diameter: 30m"
  const diameterPatterns = [
    /diameter\s*(?:of\s+)?(?:approx(?:imately)?\s+)?(\d+(?:\.\d+)?)\s*(?:m(?:et(?:er|re)s?)?)\b/i,
    /(\d+(?:\.\d+)?)\s*(?:m(?:et(?:er|re)s?)?)\s*(?:in\s+)?diameter/i,
    /diameter[:\s]+(\d+(?:\.\d+)?)\s*m?\b/i,
  ];
  for (const pat of diameterPatterns) {
    const m = content.match(pat);
    if (m) {
      const d = parseFloat(m[1]);
      if (d > 0) return { diameter: d };
    }
  }

  // Radius: "radius of 15 meters", "15m radius"
  const radiusPatterns = [
    /radius\s*(?:of\s+)?(?:approx(?:imately)?\s+)?(\d+(?:\.\d+)?)\s*(?:m(?:et(?:er|re)s?)?)\b/i,
    /(\d+(?:\.\d+)?)\s*(?:m(?:et(?:er|re)s?)?)\s*radius/i,
  ];
  for (const pat of radiusPatterns) {
    const m = content.match(pat);
    if (m) {
      const r = parseFloat(m[1]);
      if (r > 0) return { diameter: r * 2 };
    }
  }

  // Width x depth: "40m x 25m", "40 meters wide and 25 meters deep"
  const wxdPattern = /(\d+(?:\.\d+)?)\s*m?\s*[x×]\s*(\d+(?:\.\d+)?)\s*m/i;
  const wxdMatch = content.match(wxdPattern);
  if (wxdMatch) {
    return { width: parseFloat(wxdMatch[1]), depth: parseFloat(wxdMatch[2]) };
  }

  // Side length for regular polygons: "side length of 10m"
  // (converted to diameter of circumscribed circle by caller)

  return {};
}

/**
 * Generate a regular polygon footprint centered at (cx, cy) with N sides.
 */
function generateRegularPolygon(n: number, radius: number): FootprintPoint[] {
  const cx = radius;
  const cy = radius;
  const points: FootprintPoint[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2; // start from top
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return points;
}

/**
 * Compute a footprint polygon based on area, building type, and content description.
 * Supports: circular, hexagonal, octagonal, triangular, L-shaped, rectangular.
 */
function computeFootprint(area: number, buildingType: string, content: string = ""): FootprintPoint[] {
  const shape = detectFootprintShape(buildingType, content);
  const dims = extractDimensionsFromContent(content);

  // If explicit diameter was found, override the area calculation
  if (dims.diameter && (shape === "circular" || shape === "hexagonal" || shape === "octagonal")) {
    const r = dims.diameter / 2;
    if (shape === "circular") {
      // Circle area = πr², but we use the polygon approximation
      return generateRegularPolygon(32, r);
    }
    if (shape === "hexagonal") return generateRegularPolygon(6, r);
    if (shape === "octagonal") return generateRegularPolygon(8, r);
  }

  switch (shape) {
    case "circular": {
      // Compute radius from area: A = πr² → r = √(A/π)
      const r = Math.sqrt(area / Math.PI);
      return generateRegularPolygon(32, r);
    }
    case "hexagonal": {
      // Regular hexagon: A = (3√3/2)r² → r = √(2A / 3√3)
      const r = Math.sqrt((2 * area) / (3 * Math.sqrt(3)));
      return generateRegularPolygon(6, r);
    }
    case "octagonal": {
      // Regular octagon: A = 2(1+√2)r² → r = √(A / (2(1+√2)))
      const r = Math.sqrt(area / (2 * (1 + Math.sqrt(2))));
      return generateRegularPolygon(8, r);
    }
    case "triangular": {
      // Equilateral triangle: A = (√3/4)s² → s = √(4A/√3), r = s/√3
      const s = Math.sqrt((4 * area) / Math.sqrt(3));
      const r = s / Math.sqrt(3);
      return generateRegularPolygon(3, r);
    }
    case "l-shape": {
      if (area <= 200) break; // fall through to rectangular for small L-shapes
      const totalSide = Math.sqrt(area * 1.3);
      const mainW = totalSide;
      const mainD = totalSide * 0.6;
      const wingW = totalSide * 0.4;
      const wingD = totalSide * 0.4;
      return [
        { x: 0, y: 0 },
        { x: mainW, y: 0 },
        { x: mainW, y: mainD },
        { x: wingW, y: mainD },
        { x: wingW, y: mainD + wingD },
        { x: 0, y: mainD + wingD },
      ];
    }
  }

  // Rectangular fallback — use explicit width×depth if available
  if (dims.width && dims.depth) {
    return [
      { x: 0, y: 0 },
      { x: dims.width, y: 0 },
      { x: dims.width, y: dims.depth },
      { x: 0, y: dims.depth },
    ];
  }

  // Default rectangle with golden ratio proportions
  const ratio = 1.618;
  const width = Math.sqrt(area * ratio);
  const depth = area / width;

  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: depth },
    { x: 0, y: depth },
  ];
}

/**
 * Calculate the area of a polygon using the shoelace formula.
 */
function polygonArea(points: FootprintPoint[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Create an extruded box (wall segment) between two footprint points.
 */
function createWallElement(
  p1: FootprintPoint,
  p2: FootprintPoint,
  baseZ: number,
  wallHeight: number,
  wallThickness: number,
  storeyIndex: number,
  wallIndex: number
): GeometryElement {
  // Calculate wall direction and normal
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / length * wallThickness / 2;
  const ny = dx / length * wallThickness / 2;

  const vertices: Vertex[] = [
    // Outer face bottom
    { x: p1.x + nx, y: p1.y + ny, z: baseZ },
    { x: p2.x + nx, y: p2.y + ny, z: baseZ },
    { x: p2.x + nx, y: p2.y + ny, z: baseZ + wallHeight },
    { x: p1.x + nx, y: p1.y + ny, z: baseZ + wallHeight },
    // Inner face bottom
    { x: p1.x - nx, y: p1.y - ny, z: baseZ },
    { x: p2.x - nx, y: p2.y - ny, z: baseZ },
    { x: p2.x - nx, y: p2.y - ny, z: baseZ + wallHeight },
    { x: p1.x - nx, y: p1.y - ny, z: baseZ + wallHeight },
  ];

  const faces: Face[] = [
    { vertices: [0, 1, 2, 3] }, // outer face
    { vertices: [5, 4, 7, 6] }, // inner face
    { vertices: [0, 3, 7, 4] }, // left cap
    { vertices: [1, 5, 6, 2] }, // right cap
    { vertices: [3, 2, 6, 7] }, // top
    { vertices: [0, 4, 5, 1] }, // bottom
  ];

  const area = length * wallHeight;
  const volume = area * wallThickness;

  return {
    id: `wall-s${storeyIndex}-w${wallIndex}`,
    type: "wall",
    vertices,
    faces,
    ifcType: "IfcWall",
    properties: {
      name: `Wall S${storeyIndex + 1}-W${wallIndex + 1}`,
      storeyIndex,
      height: wallHeight,
      length,
      thickness: wallThickness,
      area,
      volume,
    },
  };
}

/**
 * Create a floor slab from the footprint polygon.
 */
function createSlabElement(
  footprint: FootprintPoint[],
  elevation: number,
  slabThickness: number,
  storeyIndex: number,
  isRoof: boolean
): GeometryElement {
  const topZ = elevation;
  const bottomZ = elevation - slabThickness;

  // Create top and bottom face vertices
  const topVerts: Vertex[] = footprint.map(p => ({ x: p.x, y: p.y, z: topZ }));
  const bottomVerts: Vertex[] = footprint.map(p => ({ x: p.x, y: p.y, z: bottomZ }));
  const vertices = [...topVerts, ...bottomVerts];

  const n = footprint.length;
  const faces: Face[] = [
    // Top face
    { vertices: Array.from({ length: n }, (_, i) => i) },
    // Bottom face (reversed winding)
    { vertices: Array.from({ length: n }, (_, i) => n + (n - 1 - i)) },
  ];

  // Side faces
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ vertices: [i, j, n + j, n + i] });
  }

  const area = polygonArea(footprint);

  return {
    id: isRoof ? `roof-slab` : `slab-s${storeyIndex}`,
    type: isRoof ? "roof" : "slab",
    vertices,
    faces,
    ifcType: "IfcSlab",
    properties: {
      name: isRoof ? "Roof Slab" : `Floor Slab Level ${storeyIndex + 1}`,
      storeyIndex,
      thickness: slabThickness,
      area,
      volume: area * slabThickness,
    },
  };
}

/**
 * Extract floor count from text content as a fallback.
 */
function extractFloorsFromContent(content: string): number | null {
  if (!content) return null;
  const patterns = [
    /(\d+)\s*(?:floors?|stor(?:ey|ies)|levels?)\b/i,
    /(\d+)[-\s]?stor(?:ey|y)\b/i,
    /\b(?:single|one)[\s-]?stor(?:ey|y)/i,
    /\b(?:two|2)[\s-]?stor(?:ey|y)/i,
    /\b(?:three|3)[\s-]?stor(?:ey|y)/i,
  ];
  const m1 = content.match(patterns[0]);
  if (m1) return parseInt(m1[1], 10);
  const m2 = content.match(patterns[1]);
  if (m2) return parseInt(m2[1], 10);
  if (patterns[2].test(content)) return 1;
  if (patterns[3].test(content)) return 2;
  if (patterns[4].test(content)) return 3;
  return null;
}

// ─── Interior Element Generation ─────────────────────────────────────────────

/**
 * Default programme for a building type when no programme data is provided.
 */
function getDefaultProgramme(buildingType: string, floors: number): ProgrammeEntry[] {
  const type = buildingType.toLowerCase();
  if (/office/i.test(type)) {
    const rooms: ProgrammeEntry[] = [];
    for (let i = 0; i < floors; i++) {
      const floorLabel = i === 0 ? "Ground" : `Level ${i + 1}`;
      rooms.push(
        { space: "Open Office", area_m2: undefined, floor: floorLabel },
        { space: "Meeting Room", area_m2: undefined, floor: floorLabel },
        { space: "Break Room", area_m2: undefined, floor: floorLabel },
        { space: "Corridor", area_m2: undefined, floor: floorLabel },
      );
      if (i === 0) rooms.push({ space: "Reception", area_m2: undefined, floor: floorLabel });
    }
    return rooms;
  }
  if (/residential|apartment/i.test(type)) {
    const rooms: ProgrammeEntry[] = [];
    for (let i = 0; i < floors; i++) {
      const floorLabel = i === 0 ? "Ground" : `Level ${i + 1}`;
      rooms.push(
        { space: "Living Room", area_m2: undefined, floor: floorLabel },
        { space: "Bedroom", area_m2: undefined, floor: floorLabel },
        { space: "Kitchen", area_m2: undefined, floor: floorLabel },
        { space: "Bathroom", area_m2: undefined, floor: floorLabel },
        { space: "Corridor", area_m2: undefined, floor: floorLabel },
      );
    }
    return rooms;
  }
  // Generic fallback
  const rooms: ProgrammeEntry[] = [];
  for (let i = 0; i < floors; i++) {
    const floorLabel = i === 0 ? "Ground" : `Level ${i + 1}`;
    rooms.push(
      { space: "Main Hall", area_m2: undefined, floor: floorLabel },
      { space: "Service Room", area_m2: undefined, floor: floorLabel },
      { space: "Storage", area_m2: undefined, floor: floorLabel },
      { space: "Corridor", area_m2: undefined, floor: floorLabel },
    );
  }
  return rooms;
}

/**
 * Calculate centroid of a polygon.
 */
function centroid(points: FootprintPoint[]): FootprintPoint {
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  return { x: cx / points.length, y: cy / points.length };
}

/**
 * Calculate bounding box of a polygon.
 */
function polygonBounds(points: FootprintPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Detect if a footprint is circular (many-sided polygon like 32-gon).
 */
function isCircularFootprint(footprint: FootprintPoint[]): boolean {
  return footprint.length >= 16; // 32-gon is circular
}

/**
 * For circular footprints, compute the center and radius.
 */
function getCircularFootprintParams(footprint: FootprintPoint[]): { cx: number; cy: number; radius: number } {
  const c = centroid(footprint);
  const radius = Math.sqrt(
    Math.pow(footprint[0].x - c.x, 2) + Math.pow(footprint[0].y - c.y, 2)
  );
  return { cx: c.x, cy: c.y, radius };
}

/**
 * Check if a point (px, py) is inside the footprint polygon.
 * Uses ray-casting algorithm for general polygons,
 * fast circle-distance check for circular footprints.
 */
function isPointInsideFootprint(footprint: FootprintPoint[], px: number, py: number, margin: number = 0): boolean {
  if (isCircularFootprint(footprint)) {
    const { cx, cy, radius } = getCircularFootprintParams(footprint);
    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    return dist <= radius - margin;
  }
  // Ray-casting for general polygons
  let inside = false;
  const n = footprint.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = footprint[i].x, yi = footprint[i].y;
    const xj = footprint[j].x, yj = footprint[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Generate interior elements for a circular building storey.
 * Creates: central core walls, radial partition walls, wedge-shaped spaces, ring of columns.
 */
function generateCircularInterior(
  footprint: FootprintPoint[],
  elevation: number,
  floorHeight: number,
  storeyIndex: number,
  programme: ProgrammeEntry[],
  floorLabel: string,
): GeometryElement[] {
  const elements: GeometryElement[] = [];
  const c = centroid(footprint);
  const wallThickness = 0.15;

  // Calculate outer radius from centroid to footprint
  const outerRadius = Math.sqrt(
    Math.pow(footprint[0].x - c.x, 2) + Math.pow(footprint[0].y - c.y, 2)
  );

  // ── Core walls (inner 25% radius ring) ──
  const coreRadius = outerRadius * 0.25;
  const coreSegments = 16;
  for (let i = 0; i < coreSegments; i++) {
    const a1 = (2 * Math.PI * i) / coreSegments;
    const a2 = (2 * Math.PI * (i + 1)) / coreSegments;
    const p1: FootprintPoint = { x: c.x + coreRadius * Math.cos(a1), y: c.y + coreRadius * Math.sin(a1) };
    const p2: FootprintPoint = { x: c.x + coreRadius * Math.cos(a2), y: c.y + coreRadius * Math.sin(a2) };
    const wall = createWallElement(p1, p2, elevation, floorHeight, wallThickness, storeyIndex, 100 + i);
    wall.properties.isPartition = true;
    wall.properties.name = `Core Wall S${storeyIndex + 1}-${i + 1}`;
    wall.id = `core-wall-s${storeyIndex}-${i}`;
    elements.push(wall);
  }

  // ── Core space (elevator/stair core) ──
  const coreFootprint: FootprintPoint[] = [];
  for (let i = 0; i < coreSegments; i++) {
    const a = (2 * Math.PI * i) / coreSegments;
    coreFootprint.push({ x: c.x + coreRadius * Math.cos(a), y: c.y + coreRadius * Math.sin(a) });
  }
  elements.push(createSpaceElement(coreFootprint, elevation, floorHeight, storeyIndex, "Core / Circulation", "circulation", `core-space-s${storeyIndex}`));

  // ── Radial partition walls + wedge spaces ──
  const floorProgramme = programme.filter(p =>
    !p.floor || p.floor.toLowerCase() === floorLabel.toLowerCase() || p.floor === "all"
  ).filter(p => p.space?.toLowerCase() !== "corridor");

  const numPartitions = Math.max(floorProgramme.length, 4); // at least 4 rooms per floor
  for (let i = 0; i < numPartitions; i++) {
    const angle = (2 * Math.PI * i) / numPartitions;
    const nextAngle = (2 * Math.PI * (i + 1)) / numPartitions;

    // Radial wall from core to outer wall
    const innerPt: FootprintPoint = { x: c.x + coreRadius * Math.cos(angle), y: c.y + coreRadius * Math.sin(angle) };
    const outerPt: FootprintPoint = { x: c.x + (outerRadius - 0.3) * Math.cos(angle), y: c.y + (outerRadius - 0.3) * Math.sin(angle) };
    const wall = createWallElement(innerPt, outerPt, elevation, floorHeight, wallThickness, storeyIndex, 200 + i);
    wall.properties.isPartition = true;
    wall.properties.name = `Partition Wall S${storeyIndex + 1}-${i + 1}`;
    wall.id = `partition-wall-s${storeyIndex}-${i}`;
    elements.push(wall);

    // Wedge-shaped space between this wall and the next
    const midAngle = (angle + nextAngle) / 2;
    const spaceName = floorProgramme[i % floorProgramme.length]?.space ?? `Room ${i + 1}`;
    const spacePoints: FootprintPoint[] = [];
    const arcSteps = 4;

    // Inner arc (from core)
    for (let s = 0; s <= arcSteps; s++) {
      const a = angle + (nextAngle - angle) * (s / arcSteps);
      spacePoints.push({ x: c.x + coreRadius * Math.cos(a), y: c.y + coreRadius * Math.sin(a) });
    }
    // Outer arc (towards outer wall, reversed)
    for (let s = arcSteps; s >= 0; s--) {
      const a = angle + (nextAngle - angle) * (s / arcSteps);
      spacePoints.push({ x: c.x + (outerRadius - 0.3) * Math.cos(a), y: c.y + (outerRadius - 0.3) * Math.sin(a) });
    }

    elements.push(createSpaceElement(
      spacePoints, elevation, floorHeight, storeyIndex,
      spaceName, spaceName.toLowerCase(),
      `space-s${storeyIndex}-r${i}`
    ));
  }

  // ── Columns around core (structural ring at 60% radius) ──
  const columnRadius = outerRadius * 0.6;
  const numColumns = Math.max(6, Math.min(numPartitions, 12));
  for (let i = 0; i < numColumns; i++) {
    const angle = (2 * Math.PI * i) / numColumns;
    const cx = c.x + columnRadius * Math.cos(angle);
    const cy = c.y + columnRadius * Math.sin(angle);
    elements.push(createColumnElement(cx, cy, elevation, floorHeight, 0.3, storeyIndex, i));
  }

  return elements;
}

/**
 * Generate interior elements for a rectangular/L-shaped building storey.
 * Creates: corridor walls, room partitions, rectangular room spaces, column grid.
 */
function generateRectangularInterior(
  footprint: FootprintPoint[],
  elevation: number,
  floorHeight: number,
  storeyIndex: number,
  programme: ProgrammeEntry[],
  floorLabel: string,
): GeometryElement[] {
  const elements: GeometryElement[] = [];
  const bounds = polygonBounds(footprint);
  const wallThickness = 0.15;
  const bW = bounds.maxX - bounds.minX;
  const bD = bounds.maxY - bounds.minY;

  // Determine corridor position (middle of the building along the longer axis)
  const corridorWidth = 2.0; // 2m corridor
  const isWideLongAxis = bW >= bD;

  // ── Central corridor walls ──
  if (isWideLongAxis) {
    const corridorY1 = bounds.minY + bD / 2 - corridorWidth / 2;
    const corridorY2 = bounds.minY + bD / 2 + corridorWidth / 2;

    // Corridor wall 1 (south side)
    elements.push((() => {
      const w = createWallElement(
        { x: bounds.minX + wallThickness, y: corridorY1 },
        { x: bounds.maxX - wallThickness, y: corridorY1 },
        elevation, floorHeight, wallThickness, storeyIndex, 100
      );
      w.properties.isPartition = true;
      w.properties.name = `Corridor Wall S${storeyIndex + 1}-South`;
      w.id = `corridor-wall-s${storeyIndex}-south`;
      return w;
    })());

    // Corridor wall 2 (north side)
    elements.push((() => {
      const w = createWallElement(
        { x: bounds.minX + wallThickness, y: corridorY2 },
        { x: bounds.maxX - wallThickness, y: corridorY2 },
        elevation, floorHeight, wallThickness, storeyIndex, 101
      );
      w.properties.isPartition = true;
      w.properties.name = `Corridor Wall S${storeyIndex + 1}-North`;
      w.id = `corridor-wall-s${storeyIndex}-north`;
      return w;
    })());

    // Corridor space
    elements.push(createSpaceElement(
      [
        { x: bounds.minX + wallThickness, y: corridorY1 },
        { x: bounds.maxX - wallThickness, y: corridorY1 },
        { x: bounds.maxX - wallThickness, y: corridorY2 },
        { x: bounds.minX + wallThickness, y: corridorY2 },
      ],
      elevation, floorHeight, storeyIndex,
      "Corridor", "circulation",
      `corridor-space-s${storeyIndex}`
    ));

    // ── Room partitions (perpendicular to corridor on both sides) ──
    const floorProgramme = programme.filter(p =>
      !p.floor || p.floor.toLowerCase() === floorLabel.toLowerCase() || p.floor === "all"
    ).filter(p => p.space?.toLowerCase() !== "corridor");

    const numRoomsPerSide = Math.max(Math.ceil(floorProgramme.length / 2), 2);
    const roomWidth = (bW - 2 * wallThickness) / numRoomsPerSide;

    for (let side = 0; side < 2; side++) {
      const yStart = side === 0 ? bounds.minY + wallThickness : corridorY2;
      const yEnd = side === 0 ? corridorY1 : bounds.maxY - wallThickness;

      for (let r = 0; r < numRoomsPerSide; r++) {
        const xStart = bounds.minX + wallThickness + r * roomWidth;
        const xEnd = xStart + roomWidth;

        // Partition wall between rooms (skip first room — outer wall serves as boundary)
        if (r > 0) {
          const w = createWallElement(
            { x: xStart, y: yStart },
            { x: xStart, y: yEnd },
            elevation, floorHeight, wallThickness, storeyIndex, 200 + side * 50 + r
          );
          w.properties.isPartition = true;
          w.properties.name = `Partition S${storeyIndex + 1}-${side === 0 ? "S" : "N"}${r}`;
          w.id = `partition-s${storeyIndex}-${side}-${r}`;
          elements.push(w);
        }

        // Room space
        const progIdx = side * numRoomsPerSide + r;
        const spaceName = floorProgramme[progIdx % Math.max(floorProgramme.length, 1)]?.space ?? `Room ${progIdx + 1}`;
        elements.push(createSpaceElement(
          [
            { x: xStart, y: yStart },
            { x: xEnd, y: yStart },
            { x: xEnd, y: yEnd },
            { x: xStart, y: yEnd },
          ],
          elevation, floorHeight, storeyIndex,
          spaceName, spaceName.toLowerCase(),
          `space-s${storeyIndex}-${side}-${r}`
        ));
      }
    }
  } else {
    // Building is deeper than wide — corridor runs along Y
    const corridorX1 = bounds.minX + bW / 2 - corridorWidth / 2;
    const corridorX2 = bounds.minX + bW / 2 + corridorWidth / 2;

    elements.push((() => {
      const w = createWallElement(
        { x: corridorX1, y: bounds.minY + wallThickness },
        { x: corridorX1, y: bounds.maxY - wallThickness },
        elevation, floorHeight, wallThickness, storeyIndex, 100
      );
      w.properties.isPartition = true;
      w.properties.name = `Corridor Wall S${storeyIndex + 1}-West`;
      w.id = `corridor-wall-s${storeyIndex}-west`;
      return w;
    })());

    elements.push((() => {
      const w = createWallElement(
        { x: corridorX2, y: bounds.minY + wallThickness },
        { x: corridorX2, y: bounds.maxY - wallThickness },
        elevation, floorHeight, wallThickness, storeyIndex, 101
      );
      w.properties.isPartition = true;
      w.properties.name = `Corridor Wall S${storeyIndex + 1}-East`;
      w.id = `corridor-wall-s${storeyIndex}-east`;
      return w;
    })());

    elements.push(createSpaceElement(
      [
        { x: corridorX1, y: bounds.minY + wallThickness },
        { x: corridorX2, y: bounds.minY + wallThickness },
        { x: corridorX2, y: bounds.maxY - wallThickness },
        { x: corridorX1, y: bounds.maxY - wallThickness },
      ],
      elevation, floorHeight, storeyIndex,
      "Corridor", "circulation",
      `corridor-space-s${storeyIndex}`
    ));

    const floorProgramme = programme.filter(p =>
      !p.floor || p.floor.toLowerCase() === floorLabel.toLowerCase() || p.floor === "all"
    ).filter(p => p.space?.toLowerCase() !== "corridor");

    const numRoomsPerSide = Math.max(Math.ceil(floorProgramme.length / 2), 2);
    const roomDepth = (bD - 2 * wallThickness) / numRoomsPerSide;

    for (let side = 0; side < 2; side++) {
      const xStart = side === 0 ? bounds.minX + wallThickness : corridorX2;
      const xEnd = side === 0 ? corridorX1 : bounds.maxX - wallThickness;

      for (let r = 0; r < numRoomsPerSide; r++) {
        const yStart = bounds.minY + wallThickness + r * roomDepth;
        const yEnd = yStart + roomDepth;

        if (r > 0) {
          const w = createWallElement(
            { x: xStart, y: yStart },
            { x: xEnd, y: yStart },
            elevation, floorHeight, wallThickness, storeyIndex, 200 + side * 50 + r
          );
          w.properties.isPartition = true;
          w.properties.name = `Partition S${storeyIndex + 1}-${side === 0 ? "W" : "E"}${r}`;
          w.id = `partition-s${storeyIndex}-${side}-${r}`;
          elements.push(w);
        }

        const progIdx = side * numRoomsPerSide + r;
        const spaceName = floorProgramme[progIdx % Math.max(floorProgramme.length, 1)]?.space ?? `Room ${progIdx + 1}`;
        elements.push(createSpaceElement(
          [
            { x: xStart, y: yStart },
            { x: xEnd, y: yStart },
            { x: xEnd, y: yEnd },
            { x: xStart, y: yEnd },
          ],
          elevation, floorHeight, storeyIndex,
          spaceName, spaceName.toLowerCase(),
          `space-s${storeyIndex}-${side}-${r}`
        ));
      }
    }
  }

  // ── Structural columns (grid) ──
  const colSpacing = Math.max(6, Math.min(bW / 3, 8)); // 6-8m grid
  const colSpacingY = Math.max(6, Math.min(bD / 3, 8));
  const numColsX = Math.max(2, Math.floor(bW / colSpacing) + 1);
  const numColsY = Math.max(2, Math.floor(bD / colSpacingY) + 1);
  const stepX = bW / (numColsX - 1);
  const stepY = bD / (numColsY - 1);
  let colIdx = 0;

  for (let ix = 0; ix < numColsX; ix++) {
    for (let iy = 0; iy < numColsY; iy++) {
      const cx = bounds.minX + ix * stepX;
      const cy = bounds.minY + iy * stepY;
      elements.push(createColumnElement(cx, cy, elevation, floorHeight, 0.4, storeyIndex, colIdx));
      colIdx++;
    }
  }

  return elements;
}

/**
 * Create an IfcSpace element from a footprint polygon.
 */
function createSpaceElement(
  spaceFootprint: FootprintPoint[],
  elevation: number,
  height: number,
  storeyIndex: number,
  spaceName: string,
  spaceUsage: string,
  elementId: string,
): GeometryElement {
  const topZ = elevation + height;
  const topVerts: Vertex[] = spaceFootprint.map(p => ({ x: p.x, y: p.y, z: topZ }));
  const bottomVerts: Vertex[] = spaceFootprint.map(p => ({ x: p.x, y: p.y, z: elevation }));
  const vertices = [...bottomVerts, ...topVerts];

  const n = spaceFootprint.length;
  const faces: Face[] = [
    { vertices: Array.from({ length: n }, (_, i) => i) },
    { vertices: Array.from({ length: n }, (_, i) => n + (n - 1 - i)) },
  ];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ vertices: [i, j, n + j, n + i] });
  }

  const area = polygonArea(spaceFootprint);

  return {
    id: elementId,
    type: "space",
    vertices,
    faces,
    ifcType: "IfcSpace",
    properties: {
      name: spaceName,
      storeyIndex,
      height,
      area,
      volume: area * height,
      spaceName,
      spaceUsage,
      spaceFootprint,
    },
  };
}

/**
 * Create a structural column element at a given position.
 */
function createColumnElement(
  cx: number,
  cy: number,
  elevation: number,
  height: number,
  radius: number,
  storeyIndex: number,
  colIndex: number,
): GeometryElement {
  // Approximate column as octagon for vertices
  const n = 8;
  const bottomVerts: Vertex[] = [];
  const topVerts: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    bottomVerts.push({ x, y, z: elevation });
    topVerts.push({ x, y, z: elevation + height });
  }

  const vertices = [...bottomVerts, ...topVerts];
  const faces: Face[] = [
    { vertices: Array.from({ length: n }, (_, i) => i) },
    { vertices: Array.from({ length: n }, (_, i) => n + (n - 1 - i)) },
  ];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ vertices: [i, j, n + j, n + i] });
  }

  return {
    id: `column-s${storeyIndex}-c${colIndex}`,
    type: "column",
    vertices,
    faces,
    ifcType: "IfcColumn",
    properties: {
      name: `Column S${storeyIndex + 1}-C${colIndex + 1}`,
      storeyIndex,
      height,
      radius,
      area: Math.PI * radius * radius,
      volume: Math.PI * radius * radius * height,
    },
  };
}

/**
 * Generate interior elements for a storey based on footprint shape and programme.
 */
function generateInteriorElements(
  footprint: FootprintPoint[],
  elevation: number,
  floorHeight: number,
  storeyIndex: number,
  programme: ProgrammeEntry[],
  floorLabel: string,
): GeometryElement[] {
  if (isCircularFootprint(footprint)) {
    return generateCircularInterior(footprint, elevation, floorHeight, storeyIndex, programme, floorLabel);
  }
  return generateRectangularInterior(footprint, elevation, floorHeight, storeyIndex, programme, floorLabel);
}

// ─── Window Element Generation ────────────────────────────────────────────

/**
 * Generate window elements along an exterior wall.
 * Places windows at regular intervals with realistic sizing based on building type.
 */
function generateWindowsForWall(
  p1: FootprintPoint,
  p2: FootprintPoint,
  elevation: number,
  floorHeight: number,
  storeyIndex: number,
  wallIndex: number,
  buildingType: string,
): GeometryElement[] {
  const windows: GeometryElement[] = [];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const wallLength = Math.sqrt(dx * dx + dy * dy);

  if (wallLength < 2.0) return windows; // too short for windows

  // Window dimensions based on building type
  const type = buildingType.toLowerCase();
  let winWidth = 1.2;
  let winHeight = 1.5;
  let sillHeight = 0.9;
  let spacing = 3.0; // center-to-center

  if (/office/i.test(type)) {
    winWidth = 1.8; winHeight = 2.2; sillHeight = 0.8; spacing = 2.7;
  } else if (/residential|apartment/i.test(type)) {
    winWidth = 1.2; winHeight = 1.5; sillHeight = 0.9; spacing = 3.0;
  } else if (/hotel/i.test(type)) {
    winWidth = 1.4; winHeight = 1.8; sillHeight = 0.8; spacing = 3.2;
  } else if (/warehouse|industrial/i.test(type)) {
    winWidth = 2.0; winHeight = 1.0; sillHeight = 2.5; spacing = 5.0;
  } else if (/museum|gallery/i.test(type)) {
    winWidth = 2.5; winHeight = 3.0; sillHeight = 0.6; spacing = 4.0;
  } else if (/school/i.test(type)) {
    winWidth = 1.8; winHeight = 1.8; sillHeight = 0.9; spacing = 2.4;
  }

  // Ensure windows fit within floor height
  if (sillHeight + winHeight > floorHeight - 0.3) {
    winHeight = floorHeight - sillHeight - 0.3;
  }
  if (winHeight < 0.5) return windows;

  // Calculate number of windows that fit
  const edgeMargin = 0.8; // margin from wall corners
  const usableLength = wallLength - 2 * edgeMargin;
  if (usableLength < winWidth) return windows;

  const numWindows = Math.max(1, Math.floor(usableLength / spacing));
  const actualSpacing = usableLength / numWindows;

  const dirX = dx / wallLength;
  const dirY = dy / wallLength;

  for (let i = 0; i < numWindows; i++) {
    const offset = edgeMargin + (i + 0.5) * actualSpacing;
    const cx = p1.x + dirX * offset;
    const cy = p1.y + dirY * offset;
    const baseZ = elevation + sillHeight;

    // Window vertices (simplified box for geometry)
    const hw = winWidth / 2;
    const nx = -dirY * 0.05; // 50mm depth (normal to wall)
    const ny = dirX * 0.05;

    const vertices: Vertex[] = [
      { x: cx - dirX * hw + nx, y: cy - dirY * hw + ny, z: baseZ },
      { x: cx + dirX * hw + nx, y: cy + dirY * hw + ny, z: baseZ },
      { x: cx + dirX * hw + nx, y: cy + dirY * hw + ny, z: baseZ + winHeight },
      { x: cx - dirX * hw + nx, y: cy - dirY * hw + ny, z: baseZ + winHeight },
      { x: cx - dirX * hw - nx, y: cy - dirY * hw - ny, z: baseZ },
      { x: cx + dirX * hw - nx, y: cy + dirY * hw - ny, z: baseZ },
      { x: cx + dirX * hw - nx, y: cy + dirY * hw - ny, z: baseZ + winHeight },
      { x: cx - dirX * hw - nx, y: cy - dirY * hw - ny, z: baseZ + winHeight },
    ];

    const faces: Face[] = [
      { vertices: [0, 1, 2, 3] },
      { vertices: [5, 4, 7, 6] },
      { vertices: [0, 3, 7, 4] },
      { vertices: [1, 5, 6, 2] },
      { vertices: [3, 2, 6, 7] },
      { vertices: [0, 4, 5, 1] },
    ];

    windows.push({
      id: `window-s${storeyIndex}-w${wallIndex}-${i}`,
      type: "window",
      vertices,
      faces,
      ifcType: "IfcWindow",
      properties: {
        name: `Window S${storeyIndex + 1}-W${wallIndex + 1}-${i + 1}`,
        storeyIndex,
        width: winWidth,
        height: winHeight,
        thickness: 0.1,
        sillHeight,
        wallOffset: offset,
        parentWallId: `wall-s${storeyIndex}-w${wallIndex}`,
        wallDirectionX: dirX,
        wallDirectionY: dirY,
        wallOriginX: p1.x,
        wallOriginY: p1.y,
        area: winWidth * winHeight,
      },
    });
  }

  return windows;
}

// ─── Door Element Generation ──────────────────────────────────────────────

/**
 * Generate entrance doors on ground floor exterior walls.
 * Places a main entrance door on the longest wall, and secondary doors on other long walls.
 */
function generateDoorsForWall(
  p1: FootprintPoint,
  p2: FootprintPoint,
  elevation: number,
  floorHeight: number,
  storeyIndex: number,
  wallIndex: number,
  isMainEntrance: boolean,
): GeometryElement[] {
  if (storeyIndex !== 0) return []; // doors only on ground floor

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const wallLength = Math.sqrt(dx * dx + dy * dy);

  if (wallLength < 3.0) return []; // too short for a door

  const doorWidth = isMainEntrance ? 2.4 : 1.0; // double door for main entrance
  const doorHeight = isMainEntrance ? 2.8 : 2.1;

  const dirX = dx / wallLength;
  const dirY = dy / wallLength;
  const offset = wallLength / 2; // center of wall

  const cx = p1.x + dirX * offset;
  const cy = p1.y + dirY * offset;
  const hw = doorWidth / 2;
  const nx = -dirY * 0.1;
  const ny = dirX * 0.1;

  const vertices: Vertex[] = [
    { x: cx - dirX * hw + nx, y: cy - dirY * hw + ny, z: elevation },
    { x: cx + dirX * hw + nx, y: cy + dirY * hw + ny, z: elevation },
    { x: cx + dirX * hw + nx, y: cy + dirY * hw + ny, z: elevation + doorHeight },
    { x: cx - dirX * hw + nx, y: cy - dirY * hw + ny, z: elevation + doorHeight },
    { x: cx - dirX * hw - nx, y: cy - dirY * hw - ny, z: elevation },
    { x: cx + dirX * hw - nx, y: cy + dirY * hw - ny, z: elevation },
    { x: cx + dirX * hw - nx, y: cy + dirY * hw - ny, z: elevation + doorHeight },
    { x: cx - dirX * hw - nx, y: cy - dirY * hw - ny, z: elevation + doorHeight },
  ];

  const faces: Face[] = [
    { vertices: [0, 1, 2, 3] },
    { vertices: [5, 4, 7, 6] },
    { vertices: [0, 3, 7, 4] },
    { vertices: [1, 5, 6, 2] },
    { vertices: [3, 2, 6, 7] },
    { vertices: [0, 4, 5, 1] },
  ];

  return [{
    id: `door-s${storeyIndex}-w${wallIndex}`,
    type: "door",
    vertices,
    faces,
    ifcType: "IfcDoor",
    properties: {
      name: isMainEntrance ? "Main Entrance Door" : `Door S1-W${wallIndex + 1}`,
      storeyIndex,
      width: doorWidth,
      height: doorHeight,
      thickness: 0.2,
      sillHeight: 0,
      wallOffset: offset,
      parentWallId: `wall-s${storeyIndex}-w${wallIndex}`,
      wallDirectionX: dirX,
      wallDirectionY: dirY,
      wallOriginX: p1.x,
      wallOriginY: p1.y,
      area: doorWidth * doorHeight,
    },
  }];
}

// ─── Beam Element Generation ──────────────────────────────────────────────

/**
 * Generate structural beams along the column grid lines for each storey.
 */
function generateBeamsForStorey(
  footprint: FootprintPoint[],
  elevation: number,
  floorHeight: number,
  storeyIndex: number,
): GeometryElement[] {
  const beams: GeometryElement[] = [];
  const bounds = polygonBounds(footprint);
  const bW = bounds.maxX - bounds.minX;
  const bD = bounds.maxY - bounds.minY;

  const beamWidth = 0.3;
  const beamDepth = 0.5; // beam hangs below slab
  const beamTopZ = elevation + floorHeight; // flush with top of storey (bottom of slab above)

  // Beams along X-direction (spanning depth)
  const colSpacingX = Math.max(6, Math.min(bW / 3, 8));
  const numBeamsX = Math.max(2, Math.floor(bW / colSpacingX) + 1);
  const stepX = bW / (numBeamsX - 1);

  for (let i = 0; i < numBeamsX; i++) {
    const x = bounds.minX + i * stepX;
    const y1 = bounds.minY;
    const y2 = bounds.maxY;
    const length = y2 - y1;

    beams.push({
      id: `beam-x-s${storeyIndex}-${i}`,
      type: "beam",
      vertices: [
        { x: x - beamWidth / 2, y: y1, z: beamTopZ - beamDepth },
        { x: x + beamWidth / 2, y: y1, z: beamTopZ - beamDepth },
        { x: x + beamWidth / 2, y: y2, z: beamTopZ - beamDepth },
        { x: x - beamWidth / 2, y: y2, z: beamTopZ - beamDepth },
        { x: x - beamWidth / 2, y: y1, z: beamTopZ },
        { x: x + beamWidth / 2, y: y1, z: beamTopZ },
        { x: x + beamWidth / 2, y: y2, z: beamTopZ },
        { x: x - beamWidth / 2, y: y2, z: beamTopZ },
      ],
      faces: [
        { vertices: [0, 1, 2, 3] },
        { vertices: [4, 7, 6, 5] },
        { vertices: [0, 4, 5, 1] },
        { vertices: [2, 6, 7, 3] },
        { vertices: [0, 3, 7, 4] },
        { vertices: [1, 5, 6, 2] },
      ],
      ifcType: "IfcBeam",
      properties: {
        name: `Beam X-${i + 1} S${storeyIndex + 1}`,
        storeyIndex,
        width: beamWidth,
        height: beamDepth,
        length,
        area: beamWidth * length,
        volume: beamWidth * beamDepth * length,
        material: "reinforced_concrete",
      },
    });
  }

  // Beams along Y-direction (spanning width)
  const colSpacingY = Math.max(6, Math.min(bD / 3, 8));
  const numBeamsY = Math.max(2, Math.floor(bD / colSpacingY) + 1);
  const stepY = bD / (numBeamsY - 1);

  for (let j = 0; j < numBeamsY; j++) {
    const y = bounds.minY + j * stepY;
    const x1 = bounds.minX;
    const x2 = bounds.maxX;
    const length = x2 - x1;

    beams.push({
      id: `beam-y-s${storeyIndex}-${j}`,
      type: "beam",
      vertices: [
        { x: x1, y: y - beamWidth / 2, z: beamTopZ - beamDepth },
        { x: x2, y: y - beamWidth / 2, z: beamTopZ - beamDepth },
        { x: x2, y: y + beamWidth / 2, z: beamTopZ - beamDepth },
        { x: x1, y: y + beamWidth / 2, z: beamTopZ - beamDepth },
        { x: x1, y: y - beamWidth / 2, z: beamTopZ },
        { x: x2, y: y - beamWidth / 2, z: beamTopZ },
        { x: x2, y: y + beamWidth / 2, z: beamTopZ },
        { x: x1, y: y + beamWidth / 2, z: beamTopZ },
      ],
      faces: [
        { vertices: [0, 1, 2, 3] },
        { vertices: [4, 7, 6, 5] },
        { vertices: [0, 4, 5, 1] },
        { vertices: [2, 6, 7, 3] },
        { vertices: [0, 3, 7, 4] },
        { vertices: [1, 5, 6, 2] },
      ],
      ifcType: "IfcBeam",
      properties: {
        name: `Beam Y-${j + 1} S${storeyIndex + 1}`,
        storeyIndex,
        width: beamWidth,
        height: beamDepth,
        length,
        area: beamWidth * length,
        volume: beamWidth * beamDepth * length,
        material: "reinforced_concrete",
      },
    });
  }

  return beams;
}

// ─── Stair Element Generation ─────────────────────────────────────────────

/**
 * Generate a staircase element in the core area of the building.
 */
function generateStairElement(
  footprint: FootprintPoint[],
  elevation: number,
  floorHeight: number,
  storeyIndex: number,
): GeometryElement | null {
  if (floorHeight <= 0) return null; // roof level has no stairs

  const bounds = polygonBounds(footprint);
  const bW = bounds.maxX - bounds.minX;
  const bD = bounds.maxY - bounds.minY;

  // Place stair near center-left of building (in core area)
  const stairWidth = 1.2;
  const stairLength = 3.0;
  const riserHeight = 0.17;
  const treadDepth = 0.28;
  const riserCount = Math.round(floorHeight / riserHeight);

  let sx: number, sy: number;
  if (isCircularFootprint(footprint)) {
    // For circular buildings, place stair inside the core (near center)
    const { cx, cy } = getCircularFootprintParams(footprint);
    sx = cx - stairWidth / 2 - 1.5; // offset slightly from center
    sy = cy - stairLength / 2;
  } else {
    sx = bounds.minX + bW * 0.15; // 15% from left edge
    sy = bounds.minY + bD * 0.5 - stairLength / 2;
  }

  const vertices: Vertex[] = [
    { x: sx, y: sy, z: elevation },
    { x: sx + stairWidth, y: sy, z: elevation },
    { x: sx + stairWidth, y: sy + stairLength, z: elevation },
    { x: sx, y: sy + stairLength, z: elevation },
    { x: sx, y: sy, z: elevation + floorHeight },
    { x: sx + stairWidth, y: sy, z: elevation + floorHeight },
    { x: sx + stairWidth, y: sy + stairLength, z: elevation + floorHeight },
    { x: sx, y: sy + stairLength, z: elevation + floorHeight },
  ];

  const faces: Face[] = [
    { vertices: [0, 1, 2, 3] },
    { vertices: [4, 7, 6, 5] },
    { vertices: [0, 4, 5, 1] },
    { vertices: [2, 6, 7, 3] },
    { vertices: [0, 3, 7, 4] },
    { vertices: [1, 5, 6, 2] },
  ];

  return {
    id: `stair-s${storeyIndex}`,
    type: "stair",
    vertices,
    faces,
    ifcType: "IfcStairFlight",
    properties: {
      name: `Stair Flight S${storeyIndex + 1}`,
      storeyIndex,
      width: stairWidth,
      length: stairLength,
      height: floorHeight,
      riserCount,
      riserHeight,
      treadDepth,
      area: stairWidth * stairLength,
      volume: stairWidth * stairLength * floorHeight * 0.5, // approximate
    },
  };
}

/**
 * Generate complete massing geometry from a building description.
 */
export function generateMassingGeometry(input: BuildingDescriptionInput): MassingGeometry {
  const content = input.content ?? input.prompt ?? "";
  const buildingType = input.building_type ?? input.buildingType ?? "Mixed-Use Building";

  // Extract parameters with defaults — use content as fallback source
  const contentFloors = extractFloorsFromContent(content);
  const floors = Math.max(1, Math.min(input.floors ?? contentFloors ?? 5, 50));

  const floorHeight = (() => {
    if (input.height && input.floors) return input.height / input.floors;
    const type = (input.building_type ?? input.buildingType ?? "").toLowerCase();
    if (/warehouse|industrial/i.test(type)) return 5.0;
    if (/museum|gallery|cultural/i.test(type)) return 4.5;
    if (/commercial|retail/i.test(type)) return 4.2;
    if (/office/i.test(type)) return 3.8;
    if (/residential/i.test(type)) return 3.0;
    return 3.6;
  })();

  const totalHeight = input.height ?? floors * floorHeight;

  // Compute footprint area — prefer explicit value, but also check content for dimensions
  let footprintArea = input.footprint_m2 ?? input.footprint ?? 0;
  if (footprintArea <= 0) {
    // Try to derive from content dimensions (diameter → πr²)
    const dims = extractDimensionsFromContent(content);
    if (dims.diameter) {
      const r = dims.diameter / 2;
      footprintArea = Math.PI * r * r;
    } else if (dims.width && dims.depth) {
      footprintArea = dims.width * dims.depth;
    } else {
      footprintArea = 500; // final fallback
    }
  }

  const gfa = input.total_gfa_m2 ?? input.gfa ?? Math.round(floors * footprintArea * 0.95);

  // Generate footprint polygon — pass content so shape detection works
  const footprint = computeFootprint(footprintArea, buildingType, content);
  const actualFootprintArea = polygonArea(footprint);

  // Wall and slab parameters
  const wallThickness = 0.25; // 250mm
  const slabThickness = 0.3;  // 300mm

  // Resolve programme data for interior generation
  const rawProgramme = input.programme ?? (input._raw?.programme as ProgrammeEntry[] | undefined);
  const programme = rawProgramme && rawProgramme.length > 0
    ? rawProgramme
    : getDefaultProgramme(buildingType, floors);

  // Generate storeys with walls, slabs, and interior elements
  const storeys: MassingStorey[] = [];

  // Find the longest wall index (for main entrance door placement)
  let longestWallIdx = 0;
  let longestWallLen = 0;
  for (let w = 0; w < footprint.length; w++) {
    const nextW = (w + 1) % footprint.length;
    const dx = footprint[nextW].x - footprint[w].x;
    const dy = footprint[nextW].y - footprint[w].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > longestWallLen) { longestWallLen = len; longestWallIdx = w; }
  }

  // ── Enhanced realism: per-storey height calculation ──
  const groundFloorHeight = Math.max(floorHeight, 4.5); // lobby/retail always >= 4.5m
  const getStoreyHeight = (idx: number): number => idx === 0 ? groundFloorHeight : floorHeight;

  // ── Setback footprint for upper floors (rectangular buildings >= 6 floors) ──
  const setbackFloor = floors >= 6 ? Math.floor(floors * 0.7) : floors + 1;
  const isRectangular = footprint.length === 4;
  const setbackFootprint = isRectangular && floors >= 6
    ? computeSetbackFootprint(footprint, 2.0)
    : footprint;

  // ── Basement level (for buildings >= 3 floors) ──
  const hasBasement = floors >= 3;
  const basementHeight = 3.6;
  if (hasBasement) {
    const basementElements: GeometryElement[] = [];

    // Retaining walls (thicker)
    for (let w = 0; w < footprint.length; w++) {
      const nextW = (w + 1) % footprint.length;
      const bWall = createWallElement(footprint[w], footprint[nextW], -basementHeight, basementHeight, 0.30, -1, w);
      bWall.properties.discipline = "structural";
      basementElements.push(bWall);
    }

    // Basement slab
    const bSlab = createSlabElement(footprint, -basementHeight, slabThickness, -1, false);
    bSlab.properties.discipline = "structural";
    basementElements.push(bSlab);

    // Parking columns (6m grid) — only place inside the footprint
    const bxMin = Math.min(...footprint.map(p => p.x));
    const byMin = Math.min(...footprint.map(p => p.y));
    const bxMax = Math.max(...footprint.map(p => p.x));
    const byMax = Math.max(...footprint.map(p => p.y));
    let bColIdx = 0;
    for (let cx = bxMin + 3; cx < bxMax - 1; cx += 6) {
      for (let cy = byMin + 3; cy < byMax - 1; cy += 6) {
        if (!isPointInsideFootprint(footprint, cx, cy, 1.0)) continue;
        basementElements.push({
          id: `col-b-${bColIdx}`,
          type: "column",
          vertices: [{ x: cx, y: cy, z: -basementHeight }],
          faces: [],
          ifcType: "IfcColumn",
          properties: { name: `Basement Column B-C${bColIdx + 1}`, storeyIndex: -1, height: basementHeight, radius: 0.35, discipline: "structural" },
        });
        bColIdx++;
      }
    }

    storeys.push({
      index: -1,
      name: "Basement",
      elevation: -basementHeight,
      height: basementHeight,
      elements: basementElements,
      isBasement: true,
    });
  }

  // ── Main storey loop with enhanced realism ──
  let cumulativeElevation = 0;
  for (let i = 0; i < floors; i++) {
    const storeyH = getStoreyHeight(i);
    const elevation = cumulativeElevation;
    const floorLabel = i === 0 ? "Ground" : `Level ${i + 1}`;
    const elements: GeometryElement[] = [];

    // Use setback footprint for upper floors
    const activeFootprint = i >= setbackFloor ? setbackFootprint : footprint;

    // Create exterior walls for this storey
    for (let w = 0; w < activeFootprint.length; w++) {
      const nextW = (w + 1) % activeFootprint.length;
      const wall = createWallElement(activeFootprint[w], activeFootprint[nextW], elevation, storeyH, wallThickness, i, w);
      wall.properties.discipline = "architectural";
      wall.properties.isExterior = true;
      elements.push(wall);

      // Generate windows on exterior walls (ground floor gets retail glazing for commercial)
      const windowElements = generateWindowsForWall(
        activeFootprint[w], activeFootprint[nextW],
        elevation, storeyH, i, w, buildingType
      );
      for (const win of windowElements) { win.properties.discipline = "architectural"; }
      elements.push(...windowElements);

      // Generate doors on ground floor
      if (i === 0) {
        const isMainEntrance = w === longestWallIdx;
        const doorElements = generateDoorsForWall(
          activeFootprint[w], activeFootprint[nextW],
          elevation, storeyH, i, w, isMainEntrance
        );
        for (const door of doorElements) { door.properties.discipline = "architectural"; }
        elements.push(...doorElements);
      }

      // Generate balconies (residential/hotel, floor 1+, every other wall+floor)
      const typeLC = buildingType.toLowerCase();
      if (i > 0 && (i % 2 === 1 || w % 2 === 0) &&
          (/residential|apartment|hotel|housing/i.test(typeLC))) {
        const balconyEls = generateBalconyElements(activeFootprint[w], activeFootprint[nextW], elevation, i, w);
        elements.push(...balconyEls);
      }
    }

    // Create floor slab
    const slab = createSlabElement(activeFootprint, elevation, slabThickness, i, false);
    slab.properties.discipline = "structural";
    elements.push(slab);

    // Create structural beams at each floor level
    if (!isCircularFootprint(activeFootprint)) {
      const beamElements = generateBeamsForStorey(activeFootprint, elevation, storeyH, i);
      for (const beam of beamElements) { beam.properties.discipline = "structural"; }
      elements.push(...beamElements);
    }

    // Create staircase in core area
    const stair = generateStairElement(activeFootprint, elevation, storeyH, i);
    if (stair) { stair.properties.discipline = "structural"; elements.push(stair); }

    // Create interior elements (partition walls, spaces, columns)
    const interiorElements = generateInteriorElements(
      activeFootprint, elevation, storeyH, i, programme, floorLabel
    );
    for (const el of interiorElements) {
      if (!el.properties.discipline) {
        el.properties.discipline = el.type === "column" ? "structural" : "architectural";
      }
    }
    elements.push(...interiorElements);

    // Elevator shaft walls
    const shaftElements = generateElevatorShaft(activeFootprint, elevation, storeyH, i);
    elements.push(...shaftElements);

    // MEP elements (ducts, pipes, cable trays, equipment)
    const mepElements = generateMEPElementsForStorey(activeFootprint, elevation, storeyH, i, buildingType, programme);
    elements.push(...mepElements);

    storeys.push({
      index: i,
      name: i === 0 ? "Ground Floor" : `Level ${i + 1}`,
      elevation,
      height: storeyH,
      elements,
    });

    cumulativeElevation += storeyH;
  }

  // Entrance canopy on ground floor
  const canopyElements = generateEntranceCanopy(footprint, longestWallIdx, groundFloorHeight);
  if (canopyElements.length > 0 && storeys.length > 0) {
    const groundIdx = storeys.findIndex(s => s.index === 0);
    if (groundIdx >= 0) storeys[groundIdx].elements.push(...canopyElements);
  }

  // Add roof slab + parapet walls
  const roofElevation = cumulativeElevation;
  const roofElements: GeometryElement[] = [];
  const roofSlab = createSlabElement(footprint, roofElevation, slabThickness, floors, true);
  roofSlab.properties.discipline = "structural";
  roofElements.push(roofSlab);

  // Parapet walls around roof perimeter
  for (let w = 0; w < footprint.length; w++) {
    const nextW = (w + 1) % footprint.length;
    const parapetWall = createWallElement(footprint[w], footprint[nextW], roofElevation, 1.0, 0.2, floors, w);
    parapetWall.type = "parapet";
    parapetWall.properties.name = `Parapet Wall R-W${w + 1}`;
    parapetWall.properties.discipline = "architectural";
    roofElements.push(parapetWall);
  }

  storeys.push({
    index: floors,
    name: "Roof",
    elevation: roofElevation,
    height: 0,
    elements: roofElements,
  });

  // Calculate bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of footprint) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  return {
    buildingType,
    floors,
    totalHeight: roofElevation,
    footprintArea: Math.round(actualFootprintArea),
    gfa,
    footprint,
    storeys,
    boundingBox: {
      min: { x: minX, y: minY, z: hasBasement ? -basementHeight : 0 },
      max: { x: maxX, y: maxY, z: roofElevation },
    },
    metrics: [
      { label: "GFA", value: gfa.toLocaleString(), unit: "m²" },
      { label: "Height", value: roofElevation.toFixed(1), unit: "m" },
      { label: "Floors", value: floors + (hasBasement ? 1 : 0) },
      { label: "Footprint", value: Math.round(actualFootprintArea).toLocaleString(), unit: "m²" },
      { label: "Floor Height", value: floorHeight.toFixed(1), unit: "m" },
      { label: "Plot Ratio", value: (gfa / actualFootprintArea).toFixed(2), unit: "FAR" },
    ],
  };
}

// ─── Enhanced Realism Generators ───────────────────────────────────────────

/** Inset a rectangular footprint by setbackDepth on all sides */
function computeSetbackFootprint(footprint: FootprintPoint[], depth: number): FootprintPoint[] {
  if (footprint.length !== 4) return footprint;
  const xs = footprint.map(p => p.x);
  const ys = footprint.map(p => p.y);
  const minX = Math.min(...xs) + depth;
  const maxX = Math.max(...xs) - depth;
  const minY = Math.min(...ys) + depth;
  const maxY = Math.max(...ys) - depth;
  if (maxX <= minX || maxY <= minY) return footprint;
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
}

/** Generate entrance canopy — thin slab + two columns projecting outward */
function generateEntranceCanopy(footprint: FootprintPoint[], longestWallIdx: number, groundHeight: number): GeometryElement[] {
  const elements: GeometryElement[] = [];
  // Skip canopy for circular buildings — no clear entrance wall
  if (isCircularFootprint(footprint)) return elements;
  const w = longestWallIdx;
  const nextW = (w + 1) % footprint.length;
  const p1 = footprint[w], p2 = footprint[nextW];

  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 4) return elements;

  const ux = dx / len, uy = dy / len; // along wall
  const nx = -uy, ny = ux; // outward normal

  const canopyDepth = 3.0, canopyWidth = Math.min(5.0, len * 0.4);
  const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
  const canopyHeight = Math.min(groundHeight * 0.75, 3.5);

  // Canopy slab footprint
  const c1 = { x: midX - ux * canopyWidth / 2, y: midY - uy * canopyWidth / 2 };
  const c2 = { x: midX + ux * canopyWidth / 2, y: midY + uy * canopyWidth / 2 };
  const c3 = { x: c2.x + nx * canopyDepth, y: c2.y + ny * canopyDepth };
  const c4 = { x: c1.x + nx * canopyDepth, y: c1.y + ny * canopyDepth };

  elements.push({
    id: "canopy-slab",
    type: "canopy",
    vertices: [
      { x: c1.x, y: c1.y, z: canopyHeight },
      { x: c2.x, y: c2.y, z: canopyHeight },
      { x: c3.x, y: c3.y, z: canopyHeight },
      { x: c4.x, y: c4.y, z: canopyHeight },
    ],
    faces: [{ vertices: [0, 1, 2, 3] }],
    ifcType: "IfcSlab",
    properties: { name: "Entrance Canopy", storeyIndex: 0, thickness: 0.15, discipline: "architectural" },
  });

  // Support columns at outer edge
  for (let ci = 0; ci < 2; ci++) {
    const cp = ci === 0 ? c4 : c3;
    elements.push({
      id: `canopy-col-${ci}`,
      type: "column",
      vertices: [{ x: cp.x, y: cp.y, z: 0 }],
      faces: [],
      ifcType: "IfcColumn",
      properties: { name: `Canopy Column ${ci + 1}`, storeyIndex: 0, height: canopyHeight, radius: 0.15, discipline: "structural" },
    });
  }

  return elements;
}

/** Generate elevator shaft walls for one storey */
function generateElevatorShaft(footprint: FootprintPoint[], elevation: number, floorHeight: number, storeyIndex: number): GeometryElement[] {
  const xs = footprint.map(p => p.x), ys = footprint.map(p => p.y);
  const bW = Math.max(...xs) - Math.min(...xs), bD = Math.max(...ys) - Math.min(...ys);
  if (bW < 6 || bD < 6) return [];

  const shaftW = 2.5, shaftD = 2.5;
  let sx: number, sy: number;
  if (isCircularFootprint(footprint)) {
    // For circular buildings, place elevator shaft near center (next to stair)
    const { cx, cy } = getCircularFootprintParams(footprint);
    sx = cx - shaftW / 2 + 1.5; // offset slightly from center, opposite side of stair
    sy = cy - shaftD / 2;
  } else {
    sx = Math.min(...xs) + bW * 0.15 + 3.5; // next to stairs
    sy = Math.min(...ys) + bD / 2 - shaftD / 2;
  }
  const elements: GeometryElement[] = [];

  const shaftCorners: [FootprintPoint, FootprintPoint][] = [
    [{ x: sx, y: sy }, { x: sx + shaftW, y: sy }],
    [{ x: sx + shaftW, y: sy }, { x: sx + shaftW, y: sy + shaftD }],
    [{ x: sx + shaftW, y: sy + shaftD }, { x: sx, y: sy + shaftD }],
    [{ x: sx, y: sy + shaftD }, { x: sx, y: sy }],
  ];

  for (let sw = 0; sw < 4; sw++) {
    const wall = createWallElement(shaftCorners[sw][0], shaftCorners[sw][1], elevation, floorHeight, 0.2, storeyIndex, 100 + sw);
    wall.properties.isPartition = true;
    wall.properties.name = `Elevator Shaft S${storeyIndex + 1}-SW${sw + 1}`;
    wall.properties.discipline = "architectural";
    elements.push(wall);
  }

  elements.push({
    id: `lift-space-s${storeyIndex}`,
    type: "space",
    vertices: [],
    faces: [],
    ifcType: "IfcSpace",
    properties: {
      name: `Elevator Shaft S${storeyIndex + 1}`,
      storeyIndex,
      spaceName: "Elevator Shaft",
      spaceUsage: "circulation",
      spaceFootprint: [{ x: sx, y: sy }, { x: sx + shaftW, y: sy }, { x: sx + shaftW, y: sy + shaftD }, { x: sx, y: sy + shaftD }],
      height: floorHeight,
      discipline: "architectural",
    },
  });

  return elements;
}

/** Generate balcony slab + railing for a wall segment */
function generateBalconyElements(p1: FootprintPoint, p2: FootprintPoint, elevation: number, storeyIndex: number, wallIndex: number): GeometryElement[] {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const wallLen = Math.sqrt(dx * dx + dy * dy);
  if (wallLen < 5) return [];

  const ux = dx / wallLen, uy = dy / wallLen;
  const nx = -uy, ny = ux; // outward normal
  const balconyW = 3.0, balconyD = 1.5;
  const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;

  const b1 = { x: midX - ux * balconyW / 2, y: midY - uy * balconyW / 2 };
  const b2 = { x: midX + ux * balconyW / 2, y: midY + uy * balconyW / 2 };
  const b3 = { x: b2.x + nx * balconyD, y: b2.y + ny * balconyD };
  const b4 = { x: b1.x + nx * balconyD, y: b1.y + ny * balconyD };

  return [
    {
      id: `balcony-s${storeyIndex}-w${wallIndex}`,
      type: "balcony",
      vertices: [{ x: b1.x, y: b1.y, z: elevation }, { x: b2.x, y: b2.y, z: elevation }, { x: b3.x, y: b3.y, z: elevation }, { x: b4.x, y: b4.y, z: elevation }],
      faces: [{ vertices: [0, 1, 2, 3] }],
      ifcType: "IfcSlab",
      properties: { name: `Balcony S${storeyIndex + 1}-W${wallIndex + 1}`, storeyIndex, thickness: 0.15, discipline: "architectural" },
    },
    {
      id: `railing-s${storeyIndex}-w${wallIndex}`,
      type: "balcony",
      vertices: [{ x: b4.x, y: b4.y, z: elevation }, { x: b3.x, y: b3.y, z: elevation }],
      faces: [],
      ifcType: "IfcRailing",
      properties: { name: `Railing S${storeyIndex + 1}-W${wallIndex + 1}`, storeyIndex, height: 1.1, length: balconyW, thickness: 0.05, discipline: "architectural" },
    },
  ];
}

// ─── MEP Element Generation ───────────────────────────────────────────────

/** Generate MEP elements for one storey (ducts, pipes, cable trays, equipment) */
function generateMEPElementsForStorey(
  footprint: FootprintPoint[],
  elevation: number,
  floorHeight: number,
  storeyIndex: number,
  buildingType: string,
  programme: ProgrammeEntry[]
): GeometryElement[] {
  const elements: GeometryElement[] = [];
  const xs = footprint.map(p => p.x), ys = footprint.map(p => p.y);
  const bMinX = Math.min(...xs), bMaxX = Math.max(...xs);
  const bMinY = Math.min(...ys), bMaxY = Math.max(...ys);
  const bW = bMaxX - bMinX, bD = bMaxY - bMinY;
  if (bW < 4 || bD < 4) return elements;

  const ceilZ = elevation + floorHeight - 0.4; // just below ceiling
  const isCircular = isCircularFootprint(footprint);
  let mepIdx = 0;

  // For circular buildings, compute center/radius and use inset boundaries
  let ductStartX: number, ductEndX: number, corridorY: number;
  let coreX: number, coreY: number;
  let ahuX: number, ahuY: number;

  if (isCircular) {
    const { cx, cy, radius } = getCircularFootprintParams(footprint);
    corridorY = cy; // corridor through center
    // Ducts run through the center, inset by 30% of radius from each side
    const ductInset = radius * 0.3;
    ductStartX = cx - radius + ductInset;
    ductEndX = cx + radius - ductInset;
    // Core area near center
    coreX = cx - 1.5;
    coreY = cy;
    // AHU near core
    ahuX = cx + 2.0;
    ahuY = cy - 2.0;
  } else {
    corridorY = bMinY + bD / 2;
    ductStartX = bMinX + 1;
    ductEndX = bMaxX - 1;
    coreX = bMinX + bW * 0.15;
    coreY = corridorY;
    ahuX = bMaxX - 3.0;
    ahuY = bMaxY - 2.5;
  }

  const ductLength = ductEndX - ductStartX;

  // ── Main supply duct (along longest axis at ceiling) ──
  elements.push({
    id: `duct-supply-s${storeyIndex}`,
    type: "duct",
    vertices: [{ x: ductStartX, y: corridorY - 0.3, z: ceilZ }, { x: ductEndX, y: corridorY + 0.3, z: ceilZ + 0.4 }],
    faces: [],
    ifcType: "IfcDuctSegment",
    properties: {
      name: `Supply Duct S${storeyIndex + 1}`,
      storeyIndex,
      width: 0.6, height: 0.4, length: ductLength,
      discipline: "mep",
    },
  });

  // ── Return duct (parallel, offset 1m) ──
  elements.push({
    id: `duct-return-s${storeyIndex}`,
    type: "duct",
    vertices: [{ x: ductStartX, y: corridorY + 1.0, z: ceilZ }, { x: ductEndX, y: corridorY + 1.6, z: ceilZ + 0.4 }],
    faces: [],
    ifcType: "IfcDuctSegment",
    properties: {
      name: `Return Duct S${storeyIndex + 1}`,
      storeyIndex,
      width: 0.6, height: 0.4, length: ductLength,
      discipline: "mep",
    },
  });

  // ── Branch ducts to rooms (perpendicular from main duct) ──
  const branchSpacing = Math.max(3.0, (ductEndX - ductStartX) / 6);
  for (let bx = ductStartX + branchSpacing; bx < ductEndX - 1; bx += branchSpacing) {
    // For circular buildings, compute how far north/south the branch can extend
    let branchNorthY: number, branchSouthY: number;
    if (isCircular) {
      const { cx, cy, radius } = getCircularFootprintParams(footprint);
      // How far from center-Y can we go at this X position?
      const dxFromCenter = bx - cx;
      const maxDy = Math.sqrt(Math.max(0, (radius - 1) ** 2 - dxFromCenter ** 2));
      branchNorthY = cy - maxDy + 1;
      branchSouthY = cy + maxDy - 1;
    } else {
      branchNorthY = bMinY + 1;
      branchSouthY = bMaxY - 1;
    }

    // Branch to north side
    if (corridorY - branchNorthY > 1) {
      elements.push({
        id: `duct-branch-n-s${storeyIndex}-${mepIdx}`,
        type: "duct",
        vertices: [{ x: bx - 0.15, y: corridorY - 0.3, z: ceilZ }, { x: bx + 0.15, y: branchNorthY, z: ceilZ + 0.2 }],
        faces: [],
        ifcType: "IfcDuctSegment",
        properties: { name: `Branch Duct N-${mepIdx + 1}`, storeyIndex, width: 0.3, height: 0.2, length: corridorY - branchNorthY, discipline: "mep" },
      });
    }
    // Branch to south side
    if (branchSouthY - corridorY > 1) {
      elements.push({
        id: `duct-branch-s-s${storeyIndex}-${mepIdx}`,
        type: "duct",
        vertices: [{ x: bx - 0.15, y: corridorY + 0.3, z: ceilZ }, { x: bx + 0.15, y: branchSouthY, z: ceilZ + 0.2 }],
        faces: [],
        ifcType: "IfcDuctSegment",
        properties: { name: `Branch Duct S-${mepIdx + 1}`, storeyIndex, width: 0.3, height: 0.2, length: branchSouthY - corridorY, discipline: "mep" },
      });
    }
    mepIdx++;
  }

  // ── Pipe risers in core area (hot + cold water) ──
  elements.push({
    id: `pipe-hw-s${storeyIndex}`,
    type: "pipe",
    vertices: [{ x: coreX, y: coreY - 0.5, z: elevation }],
    faces: [],
    ifcType: "IfcPipeSegment",
    properties: { name: `Hot Water Riser S${storeyIndex + 1}`, storeyIndex, height: floorHeight, diameter: 0.05, discipline: "mep" },
  });
  elements.push({
    id: `pipe-cw-s${storeyIndex}`,
    type: "pipe",
    vertices: [{ x: coreX + 0.3, y: coreY - 0.5, z: elevation }],
    faces: [],
    ifcType: "IfcPipeSegment",
    properties: { name: `Cold Water Riser S${storeyIndex + 1}`, storeyIndex, height: floorHeight, diameter: 0.05, discipline: "mep" },
  });
  elements.push({
    id: `pipe-drain-s${storeyIndex}`,
    type: "pipe",
    vertices: [{ x: coreX + 0.6, y: coreY - 0.5, z: elevation }],
    faces: [],
    ifcType: "IfcPipeSegment",
    properties: { name: `Drainage Stack S${storeyIndex + 1}`, storeyIndex, height: floorHeight, diameter: 0.11, discipline: "mep" },
  });

  // ── Horizontal branch pipes to wet rooms ──
  let pipeIdx = 0;
  for (const room of programme) {
    const roomName = (room.space ?? "").toLowerCase();
    if (/bathroom|toilet|kitchen|wash|wc|restroom/i.test(roomName)) {
      let pipeY: number;
      if (isCircular) {
        // Radial branch from core toward room area (stay well inside the circle)
        const { cy, radius } = getCircularFootprintParams(footprint);
        pipeY = cy - radius * 0.4 + pipeIdx * 2.5;
        if (pipeY > cy + radius * 0.4) continue; // skip if outside safe zone
      } else {
        pipeY = bMinY + 2 + pipeIdx * 2.5;
        if (pipeY >= bMaxY - 1) continue;
      }
      elements.push({
        id: `pipe-branch-s${storeyIndex}-${pipeIdx}`,
        type: "pipe",
        vertices: [{ x: coreX, y: coreY, z: ceilZ + 0.1 }, { x: coreX, y: pipeY, z: ceilZ + 0.1 }],
        faces: [],
        ifcType: "IfcPipeSegment",
        properties: { name: `Branch Pipe to ${room.space} S${storeyIndex + 1}`, storeyIndex, diameter: 0.025, length: Math.abs(pipeY - coreY), discipline: "mep" },
      });
      pipeIdx++;
    }
  }

  // ── Main cable tray (parallel to ducts, above them) ──
  elements.push({
    id: `ctray-main-s${storeyIndex}`,
    type: "cable-tray",
    vertices: [{ x: ductStartX, y: corridorY - 0.8, z: ceilZ + 0.5 }, { x: ductEndX, y: corridorY - 0.5, z: ceilZ + 0.6 }],
    faces: [],
    ifcType: "IfcCableCarrierSegment",
    properties: { name: `Cable Tray S${storeyIndex + 1}`, storeyIndex, width: 0.3, height: 0.1, length: ductLength, discipline: "mep" },
  });

  // ── AHU equipment (one per floor) ──
  elements.push({
    id: `ahu-s${storeyIndex}`,
    type: "equipment",
    vertices: [{ x: ahuX, y: ahuY, z: elevation }],
    faces: [],
    ifcType: "IfcFlowTerminal",
    properties: { name: `AHU S${storeyIndex + 1}`, storeyIndex, width: 2.0, height: 1.8, length: 1.5, discipline: "mep" },
  });

  // ── Diffusers (one per room, at ceiling) — only place inside the footprint ──
  let diffIdx = 0;
  const diffSpacing = Math.max(4.0, bW / 5);
  for (let dx = bMinX + diffSpacing / 2; dx < bMaxX; dx += diffSpacing) {
    for (let dy = bMinY + diffSpacing / 2; dy < bMaxY; dy += diffSpacing) {
      // Skip diffusers outside the footprint (important for circular buildings)
      if (!isPointInsideFootprint(footprint, dx, dy, 1.0)) continue;
      elements.push({
        id: `diffuser-s${storeyIndex}-${diffIdx}`,
        type: "equipment",
        vertices: [{ x: dx, y: dy, z: ceilZ - 0.02 }],
        faces: [],
        ifcType: "IfcFlowTerminal",
        properties: { name: `Diffuser S${storeyIndex + 1}-D${diffIdx + 1}`, storeyIndex, width: 0.6, height: 0.05, length: 0.6, discipline: "mep" },
      });
      diffIdx++;
    }
  }

  return elements;
}
