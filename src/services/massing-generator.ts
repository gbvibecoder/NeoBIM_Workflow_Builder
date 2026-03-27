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

  const sx = bounds.minX + bW * 0.15; // 15% from left edge
  const sy = bounds.minY + bD * 0.5 - stairLength / 2;

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

  for (let i = 0; i < floors; i++) {
    const elevation = i * floorHeight;
    const floorLabel = i === 0 ? "Ground" : `Level ${i + 1}`;
    const elements: GeometryElement[] = [];

    // Create exterior walls for this storey
    for (let w = 0; w < footprint.length; w++) {
      const nextW = (w + 1) % footprint.length;
      elements.push(
        createWallElement(
          footprint[w],
          footprint[nextW],
          elevation,
          floorHeight,
          wallThickness,
          i,
          w
        )
      );

      // Generate windows on exterior walls
      const windowElements = generateWindowsForWall(
        footprint[w], footprint[nextW],
        elevation, floorHeight, i, w, buildingType
      );
      elements.push(...windowElements);

      // Generate doors on ground floor
      if (i === 0) {
        const isMainEntrance = w === longestWallIdx;
        const doorElements = generateDoorsForWall(
          footprint[w], footprint[nextW],
          elevation, floorHeight, i, w, isMainEntrance
        );
        elements.push(...doorElements);
      }
    }

    // Create floor slab
    elements.push(
      createSlabElement(footprint, elevation, slabThickness, i, false)
    );

    // Create structural beams at each floor level (skip circular buildings for simplicity)
    if (!isCircularFootprint(footprint)) {
      const beamElements = generateBeamsForStorey(footprint, elevation, floorHeight, i);
      elements.push(...beamElements);
    }

    // Create staircase in core area
    const stair = generateStairElement(footprint, elevation, floorHeight, i);
    if (stair) elements.push(stair);

    // Create interior elements (partition walls, spaces, columns)
    const interiorElements = generateInteriorElements(
      footprint, elevation, floorHeight, i, programme, floorLabel
    );
    elements.push(...interiorElements);

    storeys.push({
      index: i,
      name: i === 0 ? "Ground Floor" : `Level ${i + 1}`,
      elevation,
      height: floorHeight,
      elements,
    });
  }

  // Add roof slab
  const roofElements: GeometryElement[] = [
    createSlabElement(footprint, floors * floorHeight, slabThickness, floors, true),
  ];
  storeys.push({
    index: floors,
    name: "Roof",
    elevation: floors * floorHeight,
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
    totalHeight,
    footprintArea: Math.round(actualFootprintArea),
    gfa,
    footprint,
    storeys,
    boundingBox: {
      min: { x: minX, y: minY, z: 0 },
      max: { x: maxX, y: maxY, z: totalHeight },
    },
    metrics: [
      { label: "GFA", value: gfa.toLocaleString(), unit: "m²" },
      { label: "Height", value: totalHeight.toFixed(1), unit: "m" },
      { label: "Floors", value: floors },
      { label: "Footprint", value: Math.round(actualFootprintArea).toLocaleString(), unit: "m²" },
      { label: "Floor Height", value: floorHeight.toFixed(1), unit: "m" },
      { label: "Plot Ratio", value: (gfa / actualFootprintArea).toFixed(2), unit: "FAR" },
    ],
  };
}
