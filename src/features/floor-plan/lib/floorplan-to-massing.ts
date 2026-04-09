/**
 * FloorPlan → MassingGeometry Adapter
 *
 * Converts a FloorPlanProject (CAD schema, mm, Y-up) into a MassingGeometry
 * (IFC-ready schema, metres) so it can be fed to the IFC Exporter (EX-001).
 */

import type { FloorPlanProject, Floor, Wall, Room, Door, CadWindow } from "@/types/floor-plan-cad";
import type {
  MassingGeometry,
  MassingStorey,
  GeometryElement,
  Vertex,
  FootprintPoint,
} from "@/types/geometry";

// ────────────────────────────────────────────────────────────────────────────

let elementCounter = 0;
function nextElemId(): string {
  return `fp-elem-${++elementCounter}`;
}

function mm(val: number): number {
  return val / 1000;
}

function wallVertices(wall: Wall, floorElevation: number): Vertex[] {
  const x1 = mm(wall.centerline.start.x);
  const y1 = mm(wall.centerline.start.y);
  const x2 = mm(wall.centerline.end.x);
  const y2 = mm(wall.centerline.end.y);
  const h = mm(wall.height_mm);
  const t = mm(wall.thickness_mm) / 2;

  // wall direction & normal
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len * t;
  const ny = dx / len * t;
  const z0 = floorElevation;
  const z1 = floorElevation + h;

  return [
    // bottom quad
    { x: x1 - nx, y: y1 - ny, z: z0 },
    { x: x1 + nx, y: y1 + ny, z: z0 },
    { x: x2 + nx, y: y2 + ny, z: z0 },
    { x: x2 - nx, y: y2 - ny, z: z0 },
    // top quad
    { x: x1 - nx, y: y1 - ny, z: z1 },
    { x: x1 + nx, y: y1 + ny, z: z1 },
    { x: x2 + nx, y: y2 + ny, z: z1 },
    { x: x2 - nx, y: y2 - ny, z: z1 },
  ];
}

const BOX_FACES = [
  { vertices: [0, 1, 2, 3] }, // bottom
  { vertices: [4, 5, 6, 7] }, // top
  { vertices: [0, 1, 5, 4] }, // side
  { vertices: [1, 2, 6, 5] }, // side
  { vertices: [2, 3, 7, 6] }, // side
  { vertices: [3, 0, 4, 7] }, // side
];

// ────────────────────────────────────────────────────────────────────────────

function convertWall(wall: Wall, storeyIdx: number, floorElev: number): GeometryElement {
  const len = Math.sqrt(
    (wall.centerline.end.x - wall.centerline.start.x) ** 2 +
    (wall.centerline.end.y - wall.centerline.start.y) ** 2,
  );
  return {
    id: nextElemId(),
    type: "wall",
    vertices: wallVertices(wall, floorElev),
    faces: BOX_FACES,
    ifcType: "IfcWall",
    properties: {
      name: `Wall-${wall.id.slice(-6)}`,
      storeyIndex: storeyIdx,
      height: mm(wall.height_mm),
      length: mm(len),
      thickness: mm(wall.thickness_mm),
      area: mm(len) * mm(wall.height_mm),
      volume: mm(len) * mm(wall.height_mm) * mm(wall.thickness_mm),
      isPartition: wall.type === "partition",
    },
  };
}

function convertSlab(floor: Floor, storeyIdx: number, elevation: number): GeometryElement {
  // Use bounding box of all walls as slab footprint
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const w of floor.walls) {
    for (const p of [w.centerline.start, w.centerline.end]) {
      if (mm(p.x) < minX) minX = mm(p.x);
      if (mm(p.x) > maxX) maxX = mm(p.x);
      if (mm(p.y) < minY) minY = mm(p.y);
      if (mm(p.y) > maxY) maxY = mm(p.y);
    }
  }
  if (!isFinite(minX)) { minX = 0; maxX = 12; minY = 0; maxY = 10; }

  const slabThk = mm(floor.slab_thickness_mm);
  const z0 = elevation - slabThk;
  const z1 = elevation;

  return {
    id: nextElemId(),
    type: "slab",
    vertices: [
      { x: minX, y: minY, z: z0 }, { x: maxX, y: minY, z: z0 },
      { x: maxX, y: maxY, z: z0 }, { x: minX, y: maxY, z: z0 },
      { x: minX, y: minY, z: z1 }, { x: maxX, y: minY, z: z1 },
      { x: maxX, y: maxY, z: z1 }, { x: minX, y: maxY, z: z1 },
    ],
    faces: BOX_FACES,
    ifcType: "IfcSlab",
    properties: {
      name: `Slab-${floor.name}`,
      storeyIndex: storeyIdx,
      thickness: slabThk,
      area: (maxX - minX) * (maxY - minY),
      volume: (maxX - minX) * (maxY - minY) * slabThk,
    },
  };
}

function convertRoom(room: Room, storeyIdx: number, elevation: number, floorHeight: number): GeometryElement {
  const pts = room.boundary.points.map((p) => ({ x: mm(p.x), y: mm(p.y) }));
  const verts: Vertex[] = [
    ...pts.map((p) => ({ ...p, z: elevation })),
    ...pts.map((p) => ({ ...p, z: elevation + floorHeight })),
  ];
  const n = pts.length;
  const faces = [
    { vertices: Array.from({ length: n }, (_, i) => i) },               // bottom
    { vertices: Array.from({ length: n }, (_, i) => n + i) },           // top
    ...Array.from({ length: n }, (_, i) => ({
      vertices: [i, (i + 1) % n, n + (i + 1) % n, n + i],
    })),
  ];

  return {
    id: nextElemId(),
    type: "space",
    vertices: verts,
    faces,
    ifcType: "IfcSpace",
    properties: {
      name: room.name,
      storeyIndex: storeyIdx,
      area: room.area_sqm,
      spaceName: room.name,
      spaceUsage: room.type.replace(/_/g, " "),
      spaceFootprint: pts,
    },
  };
}

function doorPositionOnWall(door: Door, walls: Wall[]): { x: number; y: number } {
  const wall = walls.find((w) => w.id === door.wall_id);
  if (!wall) return { x: 0, y: 0 };
  const s = wall.centerline.start;
  const e = wall.centerline.end;
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const t = door.position_along_wall_mm / len;
  return { x: mm(s.x + dx * t), y: mm(s.y + dy * t) };
}

function convertDoor(door: Door, walls: Wall[], storeyIdx: number, elevation: number): GeometryElement {
  const pos = doorPositionOnWall(door, walls);
  const w = mm(door.width_mm) / 2;
  const h = mm(door.height_mm);

  return {
    id: nextElemId(),
    type: "door",
    vertices: [
      { x: pos.x - w, y: pos.y, z: elevation }, { x: pos.x + w, y: pos.y, z: elevation },
      { x: pos.x + w, y: pos.y, z: elevation + h }, { x: pos.x - w, y: pos.y, z: elevation + h },
    ],
    faces: [{ vertices: [0, 1, 2, 3] }],
    ifcType: "IfcDoor",
    properties: {
      name: `Door-${door.type}`,
      storeyIndex: storeyIdx,
      width: mm(door.width_mm),
      height: mm(door.height_mm),
      wallOffset: mm(door.position_along_wall_mm),
    },
  };
}

function windowPositionOnWall(win: CadWindow, walls: Wall[]): { x: number; y: number } {
  const wall = walls.find((w) => w.id === win.wall_id);
  if (!wall) return { x: 0, y: 0 };
  const s = wall.centerline.start;
  const e = wall.centerline.end;
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const t = win.position_along_wall_mm / len;
  return { x: mm(s.x + dx * t), y: mm(s.y + dy * t) };
}

function convertWindow(win: CadWindow, walls: Wall[], storeyIdx: number, elevation: number): GeometryElement {
  const pos = windowPositionOnWall(win, walls);
  const w = mm(win.width_mm) / 2;
  const sill = mm(win.sill_height_mm);
  const h = mm(win.height_mm);

  return {
    id: nextElemId(),
    type: "window",
    vertices: [
      { x: pos.x - w, y: pos.y, z: elevation + sill }, { x: pos.x + w, y: pos.y, z: elevation + sill },
      { x: pos.x + w, y: pos.y, z: elevation + sill + h }, { x: pos.x - w, y: pos.y, z: elevation + sill + h },
    ],
    faces: [{ vertices: [0, 1, 2, 3] }],
    ifcType: "IfcWindow",
    properties: {
      name: `Window-${win.type}`,
      storeyIndex: storeyIdx,
      width: mm(win.width_mm),
      height: mm(win.height_mm),
      sillHeight: sill,
      wallOffset: mm(win.position_along_wall_mm),
    },
  };
}

function convertColumn(
  col: Floor["columns"][number],
  storeyIdx: number,
  elevation: number,
  floorHeight: number,
): GeometryElement {
  const x = mm(col.center.x);
  const y = mm(col.center.y);

  if (col.type === "circular") {
    const r = mm(col.diameter_mm ?? 300) / 2;
    const segs = 8;
    const pts = Array.from({ length: segs }, (_, i) => {
      const a = (2 * Math.PI * i) / segs;
      return { x: x + r * Math.cos(a), y: y + r * Math.sin(a) };
    });
    const verts: Vertex[] = [
      ...pts.map((p) => ({ ...p, z: elevation })),
      ...pts.map((p) => ({ ...p, z: elevation + floorHeight })),
    ];
    return {
      id: nextElemId(),
      type: "column",
      vertices: verts,
      faces: [
        { vertices: Array.from({ length: segs }, (_, i) => i) },
        { vertices: Array.from({ length: segs }, (_, i) => segs + i) },
      ],
      ifcType: "IfcColumn",
      properties: {
        name: `Column-${col.id.slice(-4)}`,
        storeyIndex: storeyIdx,
        radius: r,
        height: floorHeight,
      },
    };
  }

  // Rectangular column
  const hw = mm(col.width_mm ?? 300) / 2;
  const hd = mm(col.depth_mm ?? 300) / 2;
  return {
    id: nextElemId(),
    type: "column",
    vertices: [
      { x: x - hw, y: y - hd, z: elevation }, { x: x + hw, y: y - hd, z: elevation },
      { x: x + hw, y: y + hd, z: elevation }, { x: x - hw, y: y + hd, z: elevation },
      { x: x - hw, y: y - hd, z: elevation + floorHeight },
      { x: x + hw, y: y - hd, z: elevation + floorHeight },
      { x: x + hw, y: y + hd, z: elevation + floorHeight },
      { x: x - hw, y: y + hd, z: elevation + floorHeight },
    ],
    faces: BOX_FACES,
    ifcType: "IfcColumn",
    properties: {
      name: `Column-${col.id.slice(-4)}`,
      storeyIndex: storeyIdx,
      width: mm(col.width_mm ?? 300),
      height: floorHeight,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export function convertFloorPlanToMassing(project: FloorPlanProject): MassingGeometry {
  elementCounter = 0;
  const storeys: MassingStorey[] = [];
  let elevation = 0;
  let totalFootprintArea = 0;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (let i = 0; i < project.floors.length; i++) {
    const floor = project.floors[i];
    const floorHeight = mm(floor.floor_to_floor_height_mm);
    const elements: GeometryElement[] = [];

    // Walls
    for (const wall of floor.walls) {
      elements.push(convertWall(wall, i, elevation));
      for (const p of [wall.centerline.start, wall.centerline.end]) {
        const px = mm(p.x);
        const py = mm(p.y);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }

    // Slab
    elements.push(convertSlab(floor, i, elevation));

    // Rooms → IfcSpace
    for (const room of floor.rooms) {
      elements.push(convertRoom(room, i, elevation, floorHeight));
    }

    // Doors
    for (const door of floor.doors) {
      elements.push(convertDoor(door, floor.walls, i, elevation));
    }

    // Windows
    for (const win of floor.windows) {
      elements.push(convertWindow(win, floor.walls, i, elevation));
    }

    // Columns
    for (const col of floor.columns) {
      elements.push(convertColumn(col, i, elevation, floorHeight));
    }

    storeys.push({
      index: i,
      name: floor.name,
      elevation,
      height: floorHeight,
      elements,
    });

    elevation += floorHeight;
  }

  if (!isFinite(minX)) { minX = 0; maxX = 12; minY = 0; maxY = 10; }
  totalFootprintArea = (maxX - minX) * (maxY - minY);
  const gfa = totalFootprintArea * project.floors.length;

  // Footprint polygon (rectangular bounding box)
  const footprint: FootprintPoint[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

  const totalRooms = project.floors.reduce((s, f) => s + f.rooms.length, 0);
  const totalWalls = project.floors.reduce((s, f) => s + f.walls.length, 0);

  return {
    buildingType: project.metadata.project_type ?? "residential",
    floors: project.floors.length,
    totalHeight: elevation,
    footprintArea: Math.round(totalFootprintArea * 100) / 100,
    gfa: Math.round(gfa * 100) / 100,
    footprint,
    storeys,
    boundingBox: {
      min: { x: minX, y: minY, z: 0 },
      max: { x: maxX, y: maxY, z: elevation },
    },
    metrics: [
      { label: "Floors", value: project.floors.length },
      { label: "Total Height", value: `${elevation.toFixed(1)}`, unit: "m" },
      { label: "Footprint", value: Math.round(totalFootprintArea), unit: "m²" },
      { label: "GFA", value: Math.round(gfa), unit: "m²" },
      { label: "Rooms", value: totalRooms },
      { label: "Walls", value: totalWalls },
    ],
  };
}
