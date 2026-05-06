/* ─── floor-plan brief → MassingGeometry converter ────────────────────────
   Pure function. Takes a strictly-typed `FloorPlanSchema` (extracted by
   the Brief Parser when the PDF is a floor-plan brief) and produces a
   `MassingGeometry` the existing Python IFC service can render.

   Strategy
   --------
   1. Lay out rooms inside the plot rectangle by quadrant.
        · The plot is plotWidthFt (X) × plotDepthFt (Z).
        · Quadrants split the plot into a 3×3 grid; rooms claim a
          quadrant cell and stack within the cell in declaration order.
        · Each room produces an axis-aligned rectangle (ax, az, bx, bz).
   2. Generate ONE wall segment per room edge, with shared-edge
      deduplication (two adjacent rooms sharing a 12 ft edge produce one
      wall, not two overlapping walls).
   3. Place doors / windows on the stated wall of their room. Doors snap
      to the centre of the wall by default; windows centre with a 900 mm
      sill.
   4. Emit IfcSpace per room (with footprint polygon for accurate area).
   5. Emit IfcSlab per floor + roof. Optional dog-legged staircase
      becomes a single IfcStairFlight bounding box.

   Coordinates: world XZ plane is the floor plan; +Y is up. Origin is the
   plot's South-West corner (so North-up briefs map naturally to +Z).
   Foot → metre conversion happens once at the boundary. */

import type {
  FootprintPoint,
  GeometryElement,
  MassingGeometry,
  MassingStorey,
  Vertex,
} from "@/types/geometry";
import {
  FT_TO_M,
  FLOOR_PLAN_DEFAULTS,
  type BuildingCategory,
  type CardinalWall,
  type FloorPlanDoor,
  type FloorPlanFloor,
  type FloorPlanQuadrant,
  type FloorPlanRoom,
  type FloorPlanSchema,
  type FloorPlanWindow,
} from "../types/floor-plan-schema";
import {
  getFurniturePreset,
  getLightingFixture,
  getMEPFixtures,
  type FurnitureItem,
  type FurniturePosition,
  type MEPFixtureItem,
} from "./furniture-presets";

/* ── unit helpers ─────────────────────────────────────────────────────── */
const ftToM = (ft: number): number => ft * FT_TO_M;
const mmToM = (mm: number): number => mm / 1000;

/* ── ID generation ────────────────────────────────────────────────────── */
function makeIdFactory(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/* ── 2D rectangle helpers ─────────────────────────────────────────────── */

interface Rect {
  /** South-West corner X (m). */
  x0: number;
  /** South-West corner Z (m). */
  z0: number;
  /** North-East corner X (m). */
  x1: number;
  /** North-East corner Z (m). */
  z1: number;
}

interface PlacedRoom extends Rect {
  room: FloorPlanRoom;
  /** Index in the floor's rooms array — for stable ordering. */
  index: number;
}

/** A wall edge shared between rooms — used for de-duplication. */
interface WallEdge {
  /** "h" = horizontal edge (constant Z), "v" = vertical edge (constant X). */
  axis: "h" | "v";
  /** Constant coordinate of this edge (Z for horizontal, X for vertical). */
  fixed: number;
  /** Lower bound of the variable coordinate (X for horizontal, Z for vertical). */
  lo: number;
  /** Upper bound. */
  hi: number;
  /** True if at least one side is "outside the plot" — exterior wall. */
  exterior: boolean;
  /** Rooms touching this edge (either side). */
  rooms: PlacedRoom[];
}

/**
 * Quadrant → which N-S band the room belongs to.
 *
 * The plot is split into three N-S bands (North, Middle, South). Rooms
 * in the same band pack tightly left-to-right along +X, sharing walls
 * with neighbouring rooms in the same band. North-band rooms hug the
 * +Z plot edge; South-band rooms hug the −Z (z=0) edge; Middle-band
 * rooms fill the gap between them.
 *
 * This produces correct shared-wall geometry — Hall (NW) and Bedroom 1
 * (N) end up at adjacent X ranges with their shared interior wall on
 * the dividing X coordinate. The wall-edge dedup pass then collapses
 * those into one IfcWall.
 */
const BAND_OF: Record<FloorPlanQuadrant, "N" | "M" | "S"> = {
  NW: "N", N: "N", NE: "N",
  W:  "M", center: "M", E: "M",
  SW: "S", S: "S", SE: "S",
};

/** West-to-East order within a band — controls room sequencing along +X. */
const X_ORDER: Record<FloorPlanQuadrant, number> = {
  NW: 0, W: 0, SW: 0,
  N:  1, center: 1, S: 1,
  NE: 2, E: 2, SE: 2,
};

/** Synthetic corridor room used to fill empty plot space — keeps the
 *  building footprint a complete tiled rectangle instead of a podium
 *  with disconnected rooms. */
function makeCorridorRoom(widthFt: number, lengthFt: number, quadrant: FloorPlanQuadrant): FloorPlanRoom {
  return {
    name: "Corridor",
    widthFt,
    lengthFt,
    quadrant,
    usage: "corridor",
    finishMaterial: "vitrified tiles",
  };
}

/**
 * Lay rooms out in the plot — and CRITICALLY, tile the entire plot
 * footprint by injecting auto-corridor rooms anywhere the named rooms
 * don't reach. Without this auto-corridor pass the slab covers 100 % of
 * the plot but the rooms cover only ~50 %, producing the "building on a
 * podium" failure mode where a small structure sits on a giant naked
 * slab.
 *
 * Tiling strategy:
 *   1. Group rooms into N / M / S bands by quadrant.
 *   2. Compute band depths: N hugs +Z, S hugs z=0, M fills the middle.
 *   3. For each band, compute the depth that band needs (max room depth
 *      in that band; M band gets whatever's left between N + S).
 *   4. Pack rooms L→R within each band; if rooms don't fill the band's
 *      X-extent, inject a corridor room in the gap.
 *   5. If a band is empty (no named rooms claimed it), inject a single
 *      corridor room spanning the full plot width for that band.
 */
function layoutRooms(
  rooms: FloorPlanRoom[],
  plotWidthM: number,
  plotDepthM: number,
): PlacedRoom[] {
  const plotWidthFt = plotWidthM / FT_TO_M;
  const plotDepthFt = plotDepthM / FT_TO_M;

  type Item = { room: FloorPlanRoom; declIdx: number };
  const bands: { N: Item[]; M: Item[]; S: Item[] } = { N: [], M: [], S: [] };
  rooms.forEach((room, declIdx) => {
    const q = room.quadrant ?? "center";
    bands[BAND_OF[q]].push({ room, declIdx });
  });
  (["N", "M", "S"] as const).forEach((b) => {
    bands[b].sort((a, c) => {
      const xa = X_ORDER[a.room.quadrant ?? "center"];
      const xc = X_ORDER[c.room.quadrant ?? "center"];
      return xa !== xc ? xa - xc : a.declIdx - c.declIdx;
    });
  });

  /* Each band's depth: max room depth within it. Empty bands collapse
     to depth 0 (and the M band absorbs the gap). */
  const maxNDepthFt = bands.N.reduce((m, i) => Math.max(m, i.room.lengthFt), 0);
  const maxSDepthFt = bands.S.reduce((m, i) => Math.max(m, i.room.lengthFt), 0);
  /* If both N and S bands are empty, all rooms claim M — depth = plot. */
  const middleDepthFt = Math.max(0, plotDepthFt - maxNDepthFt - maxSDepthFt);

  const placed: PlacedRoom[] = [];

  /**
   * Place a band of rooms, packing L→R; insert corridor rooms wherever
   * a gap appears. Always finish with the plot's full X extent
   * consumed.
   *
   * @param band   sorted rooms in the band
   * @param bandDepthFt depth of this band (along Z)
   * @param zAnchor   which Z to anchor the band to
   */
  const placeBand = (
    band: Item[],
    bandDepthFt: number,
    zAnchor: "top" | "bottom" | "middle",
    bandQuadrant: FloorPlanQuadrant,
  ): void => {
    if (bandDepthFt <= 1e-3) return; /* zero-depth band — skip. */
    const bandDepthM = ftToM(bandDepthFt);
    let z0: number;
    if (zAnchor === "top") z0 = plotDepthM - bandDepthM;
    else if (zAnchor === "bottom") z0 = 0;
    else z0 = ftToM(maxSDepthFt);
    const z1 = z0 + bandDepthM;

    let cursorX = 0;
    /* Helper to push a room (named or corridor) at the current cursor. */
    const pushRoom = (room: FloorPlanRoom, declIdx: number): void => {
      const w = ftToM(room.widthFt);
      placed.push({
        x0: cursorX,
        z0,
        x1: cursorX + w,
        z1,
        room,
        index: declIdx,
      });
      cursorX += w;
    };

    for (const { room, declIdx } of band) {
      pushRoom(room, declIdx);
    }
    /* Fill the rest of the band X-extent with corridor. */
    const remainingFt = plotWidthFt - cursorX / FT_TO_M;
    if (remainingFt > 0.5) {
      pushRoom(makeCorridorRoom(remainingFt, bandDepthFt, bandQuadrant), placed.length);
    }
  };

  /* Bands. If a band is empty AND has positive depth (because another
     band claimed depth), fill with a single corridor spanning the
     plot. Otherwise the gap shows as naked slab. */
  if (maxNDepthFt > 0) {
    placeBand(bands.N, maxNDepthFt, "top", "N");
  }
  if (maxSDepthFt > 0) {
    placeBand(bands.S, maxSDepthFt, "bottom", "S");
  }
  /* Middle band — fills the depth gap between N and S even when no
     M-band rooms exist. This is the "circulation" / corridor strip
     the brief implies. */
  if (middleDepthFt > 0.5) {
    placeBand(
      bands.M.length > 0 ? bands.M : [],
      middleDepthFt,
      "middle",
      "center",
    );
  }
  /* Edge case: all bands empty (no rooms at all). Place a single
     plot-spanning corridor so the slab has at least ONE room/space. */
  if (placed.length === 0) {
    placeBand(
      [],
      plotDepthFt,
      "bottom",
      "center",
    );
  }

  return placed;
}

/* ── shared-wall resolution ───────────────────────────────────────────── */

function nearlyEqual(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) < eps;
}

/**
 * For every room, emit its 4 edges; merge edges that two rooms share
 * (same axis, same fixed coord, overlapping range) into one shared
 * interior wall.
 */
function buildWallEdges(
  placed: PlacedRoom[],
  plotWidthM: number,
  plotDepthM: number,
): WallEdge[] {
  const edges: WallEdge[] = [];

  for (const pr of placed) {
    /* South wall (z = z0, runs along X from x0 to x1). */
    edges.push({ axis: "h", fixed: pr.z0, lo: pr.x0, hi: pr.x1, exterior: nearlyEqual(pr.z0, 0), rooms: [pr] });
    /* North wall. */
    edges.push({ axis: "h", fixed: pr.z1, lo: pr.x0, hi: pr.x1, exterior: nearlyEqual(pr.z1, plotDepthM), rooms: [pr] });
    /* West wall. */
    edges.push({ axis: "v", fixed: pr.x0, lo: pr.z0, hi: pr.z1, exterior: nearlyEqual(pr.x0, 0), rooms: [pr] });
    /* East wall. */
    edges.push({ axis: "v", fixed: pr.x1, lo: pr.z0, hi: pr.z1, exterior: nearlyEqual(pr.x1, plotWidthM), rooms: [pr] });
  }

  /* Merge edges that overlap (same axis, same fixed coord, overlapping
     extent). The merged edge spans the union and is interior. */
  const merged: WallEdge[] = [];
  const used = new Array(edges.length).fill(false);
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    let cur = { ...edges[i], rooms: [...edges[i].rooms] };
    for (let j = i + 1; j < edges.length; j++) {
      if (used[j]) continue;
      const other = edges[j];
      if (cur.axis !== other.axis) continue;
      if (!nearlyEqual(cur.fixed, other.fixed)) continue;
      /* Ranges overlap (any kind of overlap, not just identical). */
      const overlapLo = Math.max(cur.lo, other.lo);
      const overlapHi = Math.min(cur.hi, other.hi);
      if (overlapHi - overlapLo <= 1e-3) continue;
      /* Merge — interior because two different rooms claim this edge. */
      cur = {
        axis: cur.axis,
        fixed: cur.fixed,
        lo: Math.min(cur.lo, other.lo),
        hi: Math.max(cur.hi, other.hi),
        exterior: false,
        rooms: [...cur.rooms, ...other.rooms],
      };
      used[j] = true;
    }
    used[i] = true;
    merged.push(cur);
  }

  return merged;
}

/* ── geometry builders for a single element ───────────────────────────── */

function rectPrismVertices(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
): Vertex[] {
  return [
    { x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 },
    { x: x1, y: y0, z: z1 }, { x: x0, y: y0, z: z1 },
    { x: x0, y: y1, z: z0 }, { x: x1, y: y1, z: z0 },
    { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 },
  ];
}

const RECT_FACES = [
  { vertices: [0, 1, 2, 3] }, /* bottom */
  { vertices: [4, 5, 6, 7] }, /* top */
  { vertices: [0, 1, 5, 4] }, /* south */
  { vertices: [2, 3, 7, 6] }, /* north */
  { vertices: [0, 3, 7, 4] }, /* west */
  { vertices: [1, 2, 6, 5] }, /* east */
];

/**
 * Build a single wall element from an edge.
 * Wall thickness centred on the edge (split half-and-half across the
 * fixed coord) so adjacent rooms get accurate footprint areas.
 */
function buildWallElement(
  edge: WallEdge,
  storeyIndex: number,
  storeyElevationM: number,
  storeyHeightM: number,
  thicknessM: number,
  id: string,
): GeometryElement {
  const halfT = thicknessM / 2;
  const yLo = storeyElevationM;
  const yHi = storeyElevationM + storeyHeightM;

  let x0, x1, z0, z1: number;
  if (edge.axis === "h") {
    /* Horizontal edge: runs along X, thickness extends in Z. */
    x0 = edge.lo;
    x1 = edge.hi;
    z0 = edge.fixed - halfT;
    z1 = edge.fixed + halfT;
  } else {
    /* Vertical edge: runs along Z, thickness extends in X. */
    z0 = edge.lo;
    z1 = edge.hi;
    x0 = edge.fixed - halfT;
    x1 = edge.fixed + halfT;
  }

  const length = edge.hi - edge.lo;

  return {
    id,
    type: "wall",
    vertices: rectPrismVertices(x0, yLo, z0, x1, yHi, z1),
    faces: RECT_FACES,
    ifcType: "IfcWall",
    properties: {
      name: edge.exterior ? `Exterior Wall ${id}` : `Interior Partition ${id}`,
      storeyIndex,
      length,
      thickness: thicknessM,
      height: storeyHeightM,
      isPartition: !edge.exterior,
      wallType: edge.exterior ? "exterior" : "partition",
      loadBearing: edge.exterior,
      isExterior: edge.exterior,
      discipline: "architectural",
      wallDirectionX: edge.axis === "h" ? 1 : 0,
      wallDirectionY: edge.axis === "h" ? 0 : 1,
      wallOriginX: edge.axis === "h" ? edge.lo : edge.fixed,
      wallOriginY: edge.axis === "h" ? edge.fixed : edge.lo,
    },
  };
}

/**
 * Resolve which wall edge a door/window's `wall` ("N"|"S"|"E"|"W") points
 * to within a placed room. Returns the edge that bounds the room on
 * that side.
 */
function findRoomEdge(
  pr: PlacedRoom,
  wall: CardinalWall,
  edges: WallEdge[],
): WallEdge | null {
  const targets: { axis: "h" | "v"; fixed: number; lo: number; hi: number }[] = [];
  if (wall === "S") targets.push({ axis: "h", fixed: pr.z0, lo: pr.x0, hi: pr.x1 });
  if (wall === "N") targets.push({ axis: "h", fixed: pr.z1, lo: pr.x0, hi: pr.x1 });
  if (wall === "W") targets.push({ axis: "v", fixed: pr.x0, lo: pr.z0, hi: pr.z1 });
  if (wall === "E") targets.push({ axis: "v", fixed: pr.x1, lo: pr.z0, hi: pr.z1 });

  for (const t of targets) {
    for (const e of edges) {
      if (e.axis !== t.axis) continue;
      if (!nearlyEqual(e.fixed, t.fixed)) continue;
      /* Edge fully covers the room's wall extent. */
      if (e.lo <= t.lo + 1e-3 && e.hi >= t.hi - 1e-3) return e;
    }
  }
  return null;
}

/** Build a door element snapped to the centre of its host wall. */
function buildDoorElement(
  door: FloorPlanDoor,
  pr: PlacedRoom,
  hostEdge: WallEdge,
  storeyIndex: number,
  storeyElevationM: number,
  thicknessM: number,
  id: string,
): GeometryElement {
  const widthM = ftToM(door.widthFt ?? FLOOR_PLAN_DEFAULTS.doorWidthFt);
  const heightM = ftToM(door.heightFt ?? FLOOR_PLAN_DEFAULTS.doorHeightFt);
  const halfT = thicknessM / 2;
  const yLo = storeyElevationM;
  const yHi = storeyElevationM + heightM;

  /* Centre the door along the wall extent intersected with the room. */
  const overlapLo = Math.max(hostEdge.lo, hostEdge.axis === "h" ? pr.x0 : pr.z0);
  const overlapHi = Math.min(hostEdge.hi, hostEdge.axis === "h" ? pr.x1 : pr.z1);
  const centre = (overlapLo + overlapHi) / 2;
  const wallOffsetM = centre - hostEdge.lo;

  let x0, x1, z0, z1: number;
  if (hostEdge.axis === "h") {
    x0 = centre - widthM / 2;
    x1 = centre + widthM / 2;
    z0 = hostEdge.fixed - halfT;
    z1 = hostEdge.fixed + halfT;
  } else {
    z0 = centre - widthM / 2;
    z1 = centre + widthM / 2;
    x0 = hostEdge.fixed - halfT;
    x1 = hostEdge.fixed + halfT;
  }

  return {
    id,
    type: "door",
    vertices: rectPrismVertices(x0, yLo, z0, x1, yHi, z1),
    faces: RECT_FACES,
    ifcType: "IfcDoor",
    properties: {
      name: `Door — ${pr.room.name} (${door.wall})`,
      storeyIndex,
      width: widthM,
      height: heightM,
      thickness: thicknessM,
      handedness: door.handedness ?? "right",
      operationType: "casement",
      wallOffset: wallOffsetM,
      sillHeight: 0,
      wallDirectionX: hostEdge.axis === "h" ? 1 : 0,
      wallDirectionY: hostEdge.axis === "h" ? 0 : 1,
      wallOriginX: hostEdge.axis === "h" ? hostEdge.lo : hostEdge.fixed,
      wallOriginY: hostEdge.axis === "h" ? hostEdge.fixed : hostEdge.lo,
      discipline: "architectural",
    },
  };
}

/** Build a window element snapped to the centre of its host wall. */
function buildWindowElement(
  win: FloorPlanWindow,
  pr: PlacedRoom,
  hostEdge: WallEdge,
  storeyIndex: number,
  storeyElevationM: number,
  thicknessM: number,
  id: string,
): GeometryElement {
  const widthM = ftToM(win.widthFt ?? FLOOR_PLAN_DEFAULTS.windowWidthFt);
  const heightM = ftToM(win.heightFt ?? FLOOR_PLAN_DEFAULTS.windowHeightFt);
  const sillM = ftToM(win.sillHeightFt ?? FLOOR_PLAN_DEFAULTS.windowSillFt);
  const halfT = thicknessM / 2;
  const yLo = storeyElevationM + sillM;
  const yHi = yLo + heightM;

  const overlapLo = Math.max(hostEdge.lo, hostEdge.axis === "h" ? pr.x0 : pr.z0);
  const overlapHi = Math.min(hostEdge.hi, hostEdge.axis === "h" ? pr.x1 : pr.z1);
  const centre = (overlapLo + overlapHi) / 2;
  const wallOffsetM = centre - hostEdge.lo;

  let x0, x1, z0, z1: number;
  if (hostEdge.axis === "h") {
    x0 = centre - widthM / 2;
    x1 = centre + widthM / 2;
    z0 = hostEdge.fixed - halfT;
    z1 = hostEdge.fixed + halfT;
  } else {
    z0 = centre - widthM / 2;
    z1 = centre + widthM / 2;
    x0 = hostEdge.fixed - halfT;
    x1 = hostEdge.fixed + halfT;
  }

  return {
    id,
    type: "window",
    vertices: rectPrismVertices(x0, yLo, z0, x1, yHi, z1),
    faces: RECT_FACES,
    ifcType: "IfcWindow",
    properties: {
      name: `Window — ${pr.room.name} (${win.wall})`,
      storeyIndex,
      width: widthM,
      height: heightM,
      thickness: thicknessM,
      sillHeight: sillM,
      wallOffset: wallOffsetM,
      glazingType: "double-low-e",
      operationType: "casement",
      wallDirectionX: hostEdge.axis === "h" ? 1 : 0,
      wallDirectionY: hostEdge.axis === "h" ? 0 : 1,
      wallOriginX: hostEdge.axis === "h" ? hostEdge.lo : hostEdge.fixed,
      wallOriginY: hostEdge.axis === "h" ? hostEdge.fixed : hostEdge.lo,
      discipline: "architectural",
    },
  };
}

/** Build an IfcSpace per room with its footprint polygon. */
function buildSpaceElement(
  pr: PlacedRoom,
  storeyIndex: number,
  storeyElevationM: number,
  storeyHeightM: number,
  id: string,
): GeometryElement {
  const footprint: FootprintPoint[] = [
    { x: pr.x0, y: pr.z0 },
    { x: pr.x1, y: pr.z0 },
    { x: pr.x1, y: pr.z1 },
    { x: pr.x0, y: pr.z1 },
  ];
  const areaM2 = (pr.x1 - pr.x0) * (pr.z1 - pr.z0);
  return {
    id,
    type: "space",
    vertices: rectPrismVertices(pr.x0, storeyElevationM, pr.z0, pr.x1, storeyElevationM + storeyHeightM, pr.z1),
    faces: RECT_FACES,
    ifcType: "IfcSpace",
    properties: {
      name: pr.room.name,
      storeyIndex,
      area: areaM2,
      volume: areaM2 * storeyHeightM,
      spaceName: pr.room.name,
      spaceUsage: pr.room.usage,
      occupancyType: pr.room.usage,
      spaceFootprint: footprint,
      finishMaterial: pr.room.finishMaterial,
      discipline: "architectural",
    },
  };
}

/** Build a single slab covering the plot at a given Y. */
function buildSlabElement(
  plotWidthM: number,
  plotDepthM: number,
  yLo: number,
  thicknessM: number,
  storeyIndex: number,
  id: string,
  isRoof: boolean,
): GeometryElement {
  return {
    id,
    type: "slab",
    vertices: rectPrismVertices(0, yLo, 0, plotWidthM, yLo + thicknessM, plotDepthM),
    faces: RECT_FACES,
    ifcType: "IfcSlab",
    properties: {
      name: isRoof ? `Roof Slab L${storeyIndex}` : `Floor Slab L${storeyIndex}`,
      storeyIndex,
      thickness: thicknessM,
      area: plotWidthM * plotDepthM,
      volume: plotWidthM * plotDepthM * thicknessM,
      discipline: "structural",
      material: "RCC",
      loadBearing: true,
    },
  };
}

/** Build a placeholder dog-legged staircase (single bbox spanning the
 *  staircase quadrant). The Python builder turns this into IfcStairFlight. */
function buildStaircaseElement(
  pr: PlacedRoom,
  storeyIndex: number,
  storeyElevationM: number,
  storeyHeightM: number,
  id: string,
): GeometryElement {
  return {
    id,
    type: "stair",
    vertices: rectPrismVertices(
      pr.x0, storeyElevationM, pr.z0,
      pr.x1, storeyElevationM + storeyHeightM, pr.z1,
    ),
    faces: RECT_FACES,
    ifcType: "IfcStairFlight",
    properties: {
      name: pr.room.name,
      storeyIndex,
      width: pr.x1 - pr.x0,
      length: pr.z1 - pr.z0,
      height: storeyHeightM,
      riserCount: 16,
      riserHeight: 0.175,
      treadDepth: 0.25,
      discipline: "structural",
    },
  };
}

/* ── furniture / MEP / lighting / finishes / structural builders ─────── */

/** Compute a placement rect for a furniture/fixture item inside a room
 *  rectangle, given a `FurniturePosition` hint. Returns the item's
 *  (x0, z0, x1, z1) inside the room's coordinate space.
 *
 *  Items are clamped to fit within the room — if the item is bigger
 *  than the room dimension along that axis, it's centred and shrunk
 *  proportionally so the IFC is still valid (rare; flagged via shrink
 *  factor, used by a single test). */
function placeInRoom(
  pr: PlacedRoom,
  itemWidthM: number,
  itemDepthM: number,
  position: FurniturePosition,
): { x0: number; z0: number; x1: number; z1: number } {
  const roomW = pr.x1 - pr.x0;
  const roomD = pr.z1 - pr.z0;
  const w = Math.min(itemWidthM, roomW * 0.95);
  const d = Math.min(itemDepthM, roomD * 0.95);

  let x0: number;
  let z0: number;
  switch (position) {
    case "wall-N":
      /* Centred on N wall, hugging +Z. */
      x0 = pr.x0 + (roomW - w) / 2;
      z0 = pr.z1 - d;
      break;
    case "wall-S":
      x0 = pr.x0 + (roomW - w) / 2;
      z0 = pr.z0;
      break;
    case "wall-W":
      x0 = pr.x0;
      z0 = pr.z0 + (roomD - d) / 2;
      break;
    case "wall-E":
      x0 = pr.x1 - w;
      z0 = pr.z0 + (roomD - d) / 2;
      break;
    case "corner-NW":
      x0 = pr.x0;
      z0 = pr.z1 - d;
      break;
    case "corner-NE":
      x0 = pr.x1 - w;
      z0 = pr.z1 - d;
      break;
    case "corner-SW":
      x0 = pr.x0;
      z0 = pr.z0;
      break;
    case "corner-SE":
      x0 = pr.x1 - w;
      z0 = pr.z0;
      break;
    case "center":
    default:
      x0 = pr.x0 + (roomW - w) / 2;
      z0 = pr.z0 + (roomD - d) / 2;
      break;
  }
  return { x0, z0, x1: x0 + w, z1: z0 + d };
}

/** Build an IfcFurniture element. */
function buildFurnitureElement(
  item: FurnitureItem,
  pr: PlacedRoom,
  storeyIndex: number,
  storeyElevationM: number,
  id: string,
): GeometryElement {
  const widthM = ftToM(item.widthFt);
  const depthM = ftToM(item.depthFt);
  const heightM = ftToM(item.heightFt);
  const liftedM = ftToM(item.liftedFt ?? 0);
  const r = placeInRoom(pr, widthM, depthM, item.position);
  const yLo = storeyElevationM + liftedM;
  const yHi = yLo + heightM;
  return {
    id,
    type: "furniture",
    vertices: rectPrismVertices(r.x0, yLo, r.z0, r.x1, yHi, r.z1),
    faces: RECT_FACES,
    ifcType: "IfcFurniture",
    properties: {
      name: `${item.name} — ${pr.room.name}`,
      storeyIndex,
      width: widthM,
      length: depthM,
      height: heightM,
      material: item.material,
      discipline: "architectural",
    },
  };
}

/** Build an IfcSanitaryTerminal element. */
function buildSanitaryElement(
  item: MEPFixtureItem,
  pr: PlacedRoom,
  storeyIndex: number,
  storeyElevationM: number,
  id: string,
): GeometryElement {
  const widthM = ftToM(item.widthFt);
  const depthM = ftToM(item.depthFt);
  const heightM = ftToM(item.heightFt);
  const r = placeInRoom(pr, widthM, depthM, item.position);
  const yLo = storeyElevationM;
  const yHi = yLo + heightM;
  return {
    id,
    type: "sanitary-terminal",
    vertices: rectPrismVertices(r.x0, yLo, r.z0, r.x1, yHi, r.z1),
    faces: RECT_FACES,
    ifcType: "IfcSanitaryTerminal",
    properties: {
      name: `${item.name} — ${pr.room.name}`,
      storeyIndex,
      width: widthM,
      length: depthM,
      height: heightM,
      material: "ceramic",
      discipline: "mep",
    },
  };
}

/** Build a vertical drainage stack pipe near the SE corner of a wet room. */
function buildDrainagePipe(
  pr: PlacedRoom,
  storeyIndex: number,
  storeyElevationM: number,
  storeyHeightM: number,
  id: string,
): GeometryElement {
  const diameterM = 0.1; /* 100 mm SWR pipe — IS standard for residential drainage. */
  const x0 = pr.x1 - diameterM - 0.1;
  const z0 = pr.z1 - diameterM - 0.1;
  return {
    id,
    type: "pipe",
    vertices: rectPrismVertices(
      x0, storeyElevationM, z0,
      x0 + diameterM, storeyElevationM + storeyHeightM, z0 + diameterM,
    ),
    faces: RECT_FACES,
    ifcType: "IfcPipeSegment",
    properties: {
      name: `Drainage Stack — ${pr.room.name}`,
      storeyIndex,
      diameter: diameterM,
      height: storeyHeightM,
      material: "uPVC",
      discipline: "mep",
    },
  };
}

/** Build a ceiling-mounted IfcLightFixture at room centre. */
function buildLightFixtureElement(
  pr: PlacedRoom,
  storeyIndex: number,
  storeyElevationM: number,
  storeyHeightM: number,
  id: string,
): GeometryElement {
  const sizeM = 0.4; /* 400 mm square fixture */
  const cx = (pr.x0 + pr.x1) / 2;
  const cz = (pr.z0 + pr.z1) / 2;
  /* Flush-mount at ceiling height. */
  const y = storeyElevationM + storeyHeightM - 0.1;
  return {
    id,
    type: "light-fixture",
    vertices: rectPrismVertices(
      cx - sizeM / 2, y, cz - sizeM / 2,
      cx + sizeM / 2, y + 0.1, cz + sizeM / 2,
    ),
    faces: RECT_FACES,
    ifcType: "IfcLightFixture",
    properties: {
      name: `Ceiling Light — ${pr.room.name}`,
      storeyIndex,
      width: sizeM,
      length: sizeM,
      height: 0.1,
      discipline: "mep",
    },
  };
}

/** Build IfcCovering for a room's floor surface. */
function buildFloorCovering(
  pr: PlacedRoom,
  storeyIndex: number,
  storeyElevationM: number,
  finishMaterial: string | undefined,
  id: string,
): GeometryElement {
  const thicknessM = 0.012; /* 12 mm — typical tile + adhesive. */
  return {
    id,
    type: "covering-floor",
    vertices: rectPrismVertices(
      pr.x0, storeyElevationM, pr.z0,
      pr.x1, storeyElevationM + thicknessM, pr.z1,
    ),
    faces: RECT_FACES,
    ifcType: "IfcCovering",
    properties: {
      name: `Floor Covering — ${pr.room.name}`,
      storeyIndex,
      thickness: thicknessM,
      area: (pr.x1 - pr.x0) * (pr.z1 - pr.z0),
      finishMaterial: finishMaterial ?? "vitrified tiles",
      discipline: "architectural",
    },
  };
}

/** Build IfcCovering for a room's ceiling surface. */
function buildCeilingCovering(
  pr: PlacedRoom,
  storeyIndex: number,
  storeyElevationM: number,
  storeyHeightM: number,
  id: string,
): GeometryElement {
  const thicknessM = 0.012;
  const yLo = storeyElevationM + storeyHeightM - thicknessM;
  return {
    id,
    type: "covering-ceiling",
    vertices: rectPrismVertices(
      pr.x0, yLo, pr.z0,
      pr.x1, yLo + thicknessM, pr.z1,
    ),
    faces: RECT_FACES,
    ifcType: "IfcCovering",
    properties: {
      name: `Ceiling Covering — ${pr.room.name}`,
      storeyIndex,
      thickness: thicknessM,
      area: (pr.x1 - pr.x0) * (pr.z1 - pr.z0),
      finishMaterial: "POP false ceiling + paint",
      discipline: "architectural",
    },
  };
}

/** Build an IfcColumn at world position (cx, cz). */
function buildColumnElement(
  cx: number,
  cz: number,
  storeyIndex: number,
  storeyElevationM: number,
  storeyHeightM: number,
  id: string,
): GeometryElement {
  const sizeM = 0.23; /* 230 × 230 mm RCC column. */
  return {
    id,
    type: "column",
    vertices: rectPrismVertices(
      cx - sizeM / 2, storeyElevationM, cz - sizeM / 2,
      cx + sizeM / 2, storeyElevationM + storeyHeightM, cz + sizeM / 2,
    ),
    faces: RECT_FACES,
    ifcType: "IfcColumn",
    properties: {
      name: `Column @ (${cx.toFixed(1)}, ${cz.toFixed(1)})`,
      storeyIndex,
      width: sizeM,
      length: sizeM,
      height: storeyHeightM,
      thickness: sizeM,
      material: "RCC",
      loadBearing: true,
      discipline: "structural",
    },
  };
}

/** Build an IfcBeam between (x0, z0) → (x1, z1), at top of storey. */
function buildBeamElement(
  x0: number, z0: number, x1: number, z1: number,
  storeyIndex: number,
  storeyElevationM: number,
  storeyHeightM: number,
  id: string,
): GeometryElement {
  const beamHeightM = 0.3;  /* 300 mm beam depth. */
  const beamWidthM = 0.23;  /* 230 mm — matches column width. */
  const yLo = storeyElevationM + storeyHeightM - beamHeightM;
  const yHi = storeyElevationM + storeyHeightM;
  /* Beam runs along the longest axis. Thickness is perpendicular. */
  const lengthAlongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  let bx0, bx1, bz0, bz1: number;
  if (lengthAlongX) {
    bx0 = Math.min(x0, x1);
    bx1 = Math.max(x0, x1);
    const cz = (z0 + z1) / 2;
    bz0 = cz - beamWidthM / 2;
    bz1 = cz + beamWidthM / 2;
  } else {
    bz0 = Math.min(z0, z1);
    bz1 = Math.max(z0, z1);
    const cx = (x0 + x1) / 2;
    bx0 = cx - beamWidthM / 2;
    bx1 = cx + beamWidthM / 2;
  }
  return {
    id,
    type: "beam",
    vertices: rectPrismVertices(bx0, yLo, bz0, bx1, yHi, bz1),
    faces: RECT_FACES,
    ifcType: "IfcBeam",
    properties: {
      name: `Beam ${id}`,
      storeyIndex,
      length: Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)),
      width: beamWidthM,
      height: beamHeightM,
      material: "RCC",
      loadBearing: true,
      discipline: "structural",
    },
  };
}

/** Build an IfcFooting (pad footing) under a column. */
function buildFootingElement(
  cx: number,
  cz: number,
  storeyIndex: number,
  storeyElevationM: number,
  id: string,
): GeometryElement {
  const sizeM = 1.0;        /* 1 m × 1 m pad. */
  const thicknessM = 0.45;  /* 450 mm thick. */
  const yLo = storeyElevationM - thicknessM;
  return {
    id,
    type: "footing",
    vertices: rectPrismVertices(
      cx - sizeM / 2, yLo, cz - sizeM / 2,
      cx + sizeM / 2, yLo + thicknessM, cz + sizeM / 2,
    ),
    faces: RECT_FACES,
    ifcType: "IfcFooting",
    properties: {
      name: `Footing @ (${cx.toFixed(1)}, ${cz.toFixed(1)})`,
      storeyIndex,
      width: sizeM,
      length: sizeM,
      thickness: thicknessM,
      material: "RCC",
      loadBearing: true,
      discipline: "structural",
    },
  };
}

/** Generate column positions: plot corners + ~5 m grid spacing along
 *  exterior walls. Returns world-space (x, z) pairs. */
function generateColumnGrid(
  plotWidthM: number,
  plotDepthM: number,
): Array<{ x: number; z: number }> {
  const TARGET_SPACING_M = 5;
  const cols: Array<{ x: number; z: number }> = [];
  /* X coordinates: corners + intermediate. */
  const xCount = Math.max(2, Math.ceil(plotWidthM / TARGET_SPACING_M) + 1);
  const xs: number[] = [];
  for (let i = 0; i < xCount; i++) xs.push((plotWidthM * i) / (xCount - 1));
  /* Z coordinates similarly. */
  const zCount = Math.max(2, Math.ceil(plotDepthM / TARGET_SPACING_M) + 1);
  const zs: number[] = [];
  for (let i = 0; i < zCount; i++) zs.push((plotDepthM * i) / (zCount - 1));
  /* Emit columns ONLY on the perimeter (skip interior grid points so we
     don't pierce the middle of rooms). */
  for (let i = 0; i < xCount; i++) {
    for (let j = 0; j < zCount; j++) {
      const onPerimeter = i === 0 || i === xCount - 1 || j === 0 || j === zCount - 1;
      if (onPerimeter) cols.push({ x: xs[i], z: zs[j] });
    }
  }
  return cols;
}

/* ── category-aware default templates ────────────────────────────────── */

/**
 * Produce a sensible default room layout for a plot of the given size +
 * building category. Used when the upstream extraction (GPT and/or
 * deterministic parser) failed to populate the rooms array.
 *
 * The output is purely room data — the converter's normal layout +
 * shared-wall logic runs over it as if the extraction had succeeded.
 * Result: a recognisable house / office / warehouse, not a hollow
 * column grid.
 */
function buildCategoryTemplate(
  category: BuildingCategory,
  plotWidthFt: number,
  plotDepthFt: number,
): FloorPlanRoom[] {
  if (category === "residential") {
    /* 2BHK template — proportionally sized to the plot, North-band /
       South-band split. Matches the typical Indian residential layout. */
    const halfDepth = plotDepthFt / 2;
    const w1 = plotWidthFt * 0.35;
    const w2 = plotWidthFt * 0.30;
    const w3 = plotWidthFt * 0.30;
    return [
      {
        name: "Hall",
        widthFt: w1,
        lengthFt: halfDepth,
        quadrant: "NW",
        usage: "living",
        windows: [{ wall: "N" }],
        doors: [{ wall: "S" }],
        finishMaterial: "vitrified tiles",
      },
      {
        name: "Bedroom 1",
        widthFt: w2,
        lengthFt: halfDepth,
        quadrant: "N",
        usage: "bedroom",
        windows: [{ wall: "S" }],
        doors: [{ wall: "S" }],
        finishMaterial: "vitrified tiles",
      },
      {
        name: "Bedroom 2",
        widthFt: w3,
        lengthFt: halfDepth,
        quadrant: "NE",
        usage: "bedroom",
        windows: [{ wall: "E" }],
        doors: [{ wall: "S" }],
        finishMaterial: "vitrified tiles",
      },
      {
        name: "Kitchen",
        widthFt: plotWidthFt * 0.25,
        lengthFt: halfDepth * 0.8,
        quadrant: "SE",
        usage: "kitchen",
        doors: [{ wall: "N" }],
        finishMaterial: "vitrified tiles",
      },
      {
        name: "Toilet",
        widthFt: plotWidthFt * 0.15,
        lengthFt: halfDepth * 0.6,
        quadrant: "S",
        usage: "toilet",
        doors: [{ wall: "N" }],
        finishMaterial: "anti-skid tiles",
      },
    ];
  }
  if (category === "commercial" || category === "hospitality") {
    /* Default office floor: reception + 2 offices + conference. */
    const halfDepth = plotDepthFt / 2;
    return [
      {
        name: "Reception",
        widthFt: plotWidthFt * 0.4,
        lengthFt: halfDepth,
        quadrant: "S",
        usage: "reception",
        doors: [{ wall: "S" }],
        finishMaterial: "marble",
      },
      {
        name: "Office 1",
        widthFt: plotWidthFt * 0.35,
        lengthFt: halfDepth,
        quadrant: "NW",
        usage: "office",
        windows: [{ wall: "N" }],
      },
      {
        name: "Office 2",
        widthFt: plotWidthFt * 0.35,
        lengthFt: halfDepth,
        quadrant: "NE",
        usage: "office",
        windows: [{ wall: "N" }, { wall: "E" }],
      },
      {
        name: "Conference Room",
        widthFt: plotWidthFt * 0.45,
        lengthFt: halfDepth * 0.7,
        quadrant: "SE",
        usage: "conference",
      },
    ];
  }
  if (category === "industrial") {
    /* Single open warehouse with a small office. */
    return [
      {
        name: "Warehouse",
        widthFt: plotWidthFt * 0.7,
        lengthFt: plotDepthFt * 0.85,
        quadrant: "center",
        usage: "warehouse",
        doors: [{ wall: "S", widthFt: 8 }],
      },
      {
        name: "Office",
        widthFt: plotWidthFt * 0.25,
        lengthFt: plotDepthFt * 0.4,
        quadrant: "SE",
        usage: "office",
        windows: [{ wall: "S" }],
      },
    ];
  }
  if (category === "institutional") {
    /* Default institutional: lobby + 3 office/teaching rooms. */
    const halfDepth = plotDepthFt / 2;
    return [
      {
        name: "Lobby",
        widthFt: plotWidthFt * 0.3,
        lengthFt: halfDepth,
        quadrant: "S",
        usage: "lobby",
        doors: [{ wall: "S" }],
      },
      {
        name: "Office 1",
        widthFt: plotWidthFt * 0.35,
        lengthFt: halfDepth,
        quadrant: "NW",
        usage: "office",
        windows: [{ wall: "N" }],
      },
      {
        name: "Office 2",
        widthFt: plotWidthFt * 0.35,
        lengthFt: halfDepth,
        quadrant: "NE",
        usage: "office",
        windows: [{ wall: "N" }, { wall: "E" }],
      },
    ];
  }
  /* Unknown category — return one default room covering the whole plot. */
  return [
    {
      name: "Open Floor",
      widthFt: plotWidthFt,
      lengthFt: plotDepthFt,
      quadrant: "center",
      usage: "default",
    },
  ];
}

/* ── floor builder ────────────────────────────────────────────────────── */

interface IdFactory {
  wall: () => string;
  door: () => string;
  win: () => string;
  space: () => string;
  slab: () => string;
  stair: () => string;
  furn: () => string;
  san:  () => string;
  pipe: () => string;
  light: () => string;
  cov:  () => string;
  col:  () => string;
  beam: () => string;
  foot: () => string;
}

function buildFloor(
  floor: FloorPlanFloor,
  plotWidthM: number,
  plotDepthM: number,
  exteriorThM: number,
  interiorThM: number,
  slabThM: number,
  cumulativeElevationM: number,
  buildingCategory: BuildingCategory,
  ids: IdFactory,
): { storey: MassingStorey; nextElevationM: number } {
  const storeyHeightM = ftToM(floor.storeyHeightFt ?? FLOOR_PLAN_DEFAULTS.storeyHeightFt);
  const elements: GeometryElement[] = [];

  /* Floor slab. */
  elements.push(buildSlabElement(
    plotWidthM, plotDepthM, cumulativeElevationM, slabThM, floor.index, ids.slab(), false,
  ));

  /* Roof-stub branch — emit only the slab + a parapet wall around the
     perimeter, no rooms. */
  if (floor.isRoofStub) {
    /* Parapet — IS 875 Part 3 ≥ 1 m; default 1.2 m so the roof reads as
       a clear architectural feature, not a token wall. */
    const parapetH = FLOOR_PLAN_DEFAULTS.parapetHeightM;
    const parapetEdges: WallEdge[] = [
      { axis: "h", fixed: 0,           lo: 0, hi: plotWidthM, exterior: true, rooms: [] },
      { axis: "h", fixed: plotDepthM,  lo: 0, hi: plotWidthM, exterior: true, rooms: [] },
      { axis: "v", fixed: 0,           lo: 0, hi: plotDepthM, exterior: true, rooms: [] },
      { axis: "v", fixed: plotWidthM,  lo: 0, hi: plotDepthM, exterior: true, rooms: [] },
    ];
    for (const e of parapetEdges) {
      elements.push(buildWallElement(
        e, floor.index, cumulativeElevationM + slabThM, parapetH, exteriorThM, ids.wall(),
      ));
    }
    return {
      storey: {
        index: floor.index,
        name: floor.name,
        elevation: cumulativeElevationM,
        height: parapetH + slabThM,
        elements,
      },
      nextElevationM: cumulativeElevationM + parapetH + slabThM,
    };
  }

  /* Layout rooms. The input `floor.rooms` is the source of truth — an
     empty array signals upstream extraction failure (GPT or regex) and
     we substitute a category-aware default template before layout
     runs. Once layoutRooms runs, it ALWAYS tiles the plot completely
     (corridors auto-fill any gaps), so the converter can rely on its
     output filling the plot regardless of what came in. */
  const sourceRooms = floor.rooms.length === 0 && !floor.isRoofStub
    ? buildCategoryTemplate(
        buildingCategory,
        plotWidthM / FT_TO_M,
        plotDepthM / FT_TO_M,
      )
    : floor.rooms;
  const placed = layoutRooms(sourceRooms, plotWidthM, plotDepthM);

  /* Build wall edges (with shared-wall dedup). */
  const edges = buildWallEdges(placed, plotWidthM, plotDepthM);

  /* Walls. Floor-of-walls Y starts at slab top; walls are full storey
     height; ceiling is the next floor's slab. */
  const wallYLo = cumulativeElevationM + slabThM;
  for (const e of edges) {
    elements.push(buildWallElement(
      e, floor.index, wallYLo, storeyHeightM,
      e.exterior ? exteriorThM : interiorThM, ids.wall(),
    ));
  }

  /* Doors + windows + spaces + finishes + furniture + MEP + lighting per room. */
  for (const pr of placed) {
    /* Architectural — IfcSpace + door + window. */
    elements.push(buildSpaceElement(pr, floor.index, wallYLo, storeyHeightM, ids.space()));
    for (const door of pr.room.doors ?? []) {
      const host = findRoomEdge(pr, door.wall, edges);
      if (!host) continue;
      elements.push(buildDoorElement(door, pr, host, floor.index, wallYLo, exteriorThM, ids.door()));
    }
    for (const win of pr.room.windows ?? []) {
      const host = findRoomEdge(pr, win.wall, edges);
      if (!host) continue;
      elements.push(buildWindowElement(win, pr, host, floor.index, wallYLo, exteriorThM, ids.win()));
    }

    /* Finishes — IfcCovering for floor + ceiling. Floor uses the
       brief-stated finishMaterial ("vitrified tiles", "anti-skid", etc.). */
    elements.push(buildFloorCovering(pr, floor.index, wallYLo, pr.room.finishMaterial, ids.cov()));
    elements.push(buildCeilingCovering(pr, floor.index, wallYLo, storeyHeightM, ids.cov()));

    /* Furniture — preset based on (buildingCategory, room.usage). */
    const furniture = getFurniturePreset(buildingCategory, pr.room.usage);
    for (const item of furniture) {
      elements.push(buildFurnitureElement(item, pr, floor.index, wallYLo, ids.furn()));
    }

    /* MEP — sanitary fixtures + drainage stack for wet rooms. */
    const mep = getMEPFixtures(buildingCategory, pr.room.usage);
    let drainageEmitted = false;
    for (const fixture of mep) {
      elements.push(buildSanitaryElement(fixture, pr, floor.index, wallYLo, ids.san()));
      if (fixture.drains && !drainageEmitted) {
        elements.push(buildDrainagePipe(pr, floor.index, wallYLo, storeyHeightM, ids.pipe()));
        drainageEmitted = true;
      }
    }

    /* Lighting — every room gets a ceiling fixture. */
    if (pr.room.usage !== "stair" && pr.room.usage !== "corridor") {
      void getLightingFixture(); /* preset reserved for future per-category lookups */
      elements.push(buildLightFixtureElement(pr, floor.index, wallYLo, storeyHeightM, ids.light()));
    }
  }

  /* Structural — perimeter columns at the corners + ~5 m grid intersections,
     beams along the building perimeter at the top of every storey, and (on
     the ground floor only) pad footings under each column. */
  const colPositions = generateColumnGrid(plotWidthM, plotDepthM);
  for (const { x, z } of colPositions) {
    elements.push(buildColumnElement(x, z, floor.index, wallYLo, storeyHeightM, ids.col()));
    if (floor.index === 0) {
      elements.push(buildFootingElement(x, z, floor.index, wallYLo, ids.foot()));
    }
  }

  /* Perimeter beams at the top of the storey. */
  elements.push(buildBeamElement(0, 0, plotWidthM, 0,                     floor.index, wallYLo, storeyHeightM, ids.beam())); /* S */
  elements.push(buildBeamElement(0, plotDepthM, plotWidthM, plotDepthM,   floor.index, wallYLo, storeyHeightM, ids.beam())); /* N */
  elements.push(buildBeamElement(0, 0, 0, plotDepthM,                     floor.index, wallYLo, storeyHeightM, ids.beam())); /* W */
  elements.push(buildBeamElement(plotWidthM, 0, plotWidthM, plotDepthM,   floor.index, wallYLo, storeyHeightM, ids.beam())); /* E */

  /* Staircase. Anchored by quadrant using the same band / X-order mapping
     as the room layout (no separate quadrant grid). Placeholder geometry
     for the dog-legged stair: width × 2× width footprint. */
  if (floor.staircase && floor.staircase.hasGeometry !== false) {
    const stairWidthM = ftToM(floor.staircase.widthFt ?? FLOOR_PLAN_DEFAULTS.staircaseWidthFt);
    const stairDepthM = stairWidthM * 2; /* dog-legged shape */
    const q = floor.staircase.quadrant;
    const band = BAND_OF[q];
    const xWeight = X_ORDER[q];
    const sx0 = (xWeight * plotWidthM) / 3;
    const sz0 = band === "N"
      ? plotDepthM - stairDepthM
      : band === "M"
      ? (plotDepthM - stairDepthM) / 2
      : 0; /* "S" band */
    const placedStair: PlacedRoom = {
      x0: sx0,
      z0: sz0,
      x1: sx0 + stairWidthM,
      z1: sz0 + stairDepthM,
      room: {
        name: `Staircase (${floor.staircase.type ?? "dog-legged"})`,
        widthFt: 0,
        lengthFt: 0,
        quadrant: q,
      },
      index: -1,
    };
    elements.push(buildStaircaseElement(placedStair, floor.index, wallYLo, storeyHeightM, ids.stair()));
  }

  return {
    storey: {
      index: floor.index,
      name: floor.name,
      elevation: cumulativeElevationM,
      height: storeyHeightM + slabThM,
      elements,
    },
    nextElevationM: cumulativeElevationM + storeyHeightM + slabThM,
  };
}

/* ── public converter ─────────────────────────────────────────────────── */

/**
 * Convert a floor-plan brief into a `MassingGeometry` ready for the
 * existing IFC exporter / Python service. Pure, deterministic.
 */
export function floorPlanToMassingGeometry(plan: FloorPlanSchema): MassingGeometry {
  const plotWidthM = ftToM(plan.plotWidthFt);
  const plotDepthM = ftToM(plan.plotDepthFt);
  const exteriorThM = mmToM(plan.exteriorWallThicknessMm ?? FLOOR_PLAN_DEFAULTS.exteriorWallThicknessMm);
  const interiorThM = mmToM(plan.interiorWallThicknessMm ?? FLOOR_PLAN_DEFAULTS.interiorWallThicknessMm);
  const slabThM = mmToM(plan.slabThicknessMm ?? FLOOR_PLAN_DEFAULTS.slabThicknessMm);

  const ids: IdFactory = {
    wall: makeIdFactory("wall"),
    door: makeIdFactory("door"),
    win:  makeIdFactory("win"),
    space:makeIdFactory("space"),
    slab: makeIdFactory("slab"),
    stair:makeIdFactory("stair"),
    furn: makeIdFactory("furn"),
    san:  makeIdFactory("san"),
    pipe: makeIdFactory("pipe"),
    light:makeIdFactory("light"),
    cov:  makeIdFactory("cov"),
    col:  makeIdFactory("col"),
    beam: makeIdFactory("beam"),
    foot: makeIdFactory("foot"),
  };

  const buildingCategory: BuildingCategory = plan.buildingCategory ?? "residential";

  const storeys: MassingStorey[] = [];
  let elevationM = 0;
  for (const floor of plan.floors) {
    const { storey, nextElevationM } = buildFloor(
      floor, plotWidthM, plotDepthM, exteriorThM, interiorThM, slabThM,
      elevationM, buildingCategory, ids,
    );
    storeys.push(storey);
    elevationM = nextElevationM;
  }

  /* Aggregate metrics. */
  const totalHeight = elevationM;
  const footprintArea = plotWidthM * plotDepthM;
  const livableFloors = plan.floors.filter((f) => !f.isRoofStub).length;
  const gfa = footprintArea * livableFloors;

  const footprint: FootprintPoint[] = [
    { x: 0, y: 0 },
    { x: plotWidthM, y: 0 },
    { x: plotWidthM, y: plotDepthM },
    { x: 0, y: plotDepthM },
  ];

  /* Capitalise category for the buildingType label. */
  const buildingTypeLabel = buildingCategory.charAt(0).toUpperCase() + buildingCategory.slice(1);

  return {
    buildingType: buildingTypeLabel,
    floors: livableFloors,
    totalHeight,
    footprintArea,
    gfa,
    footprint,
    storeys,
    boundingBox: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: plotWidthM, y: totalHeight, z: plotDepthM },
    },
    metrics: [
      { label: "Plot Width", value: plan.plotWidthFt, unit: "ft" },
      { label: "Plot Depth", value: plan.plotDepthFt, unit: "ft" },
      { label: "Floors (livable)", value: livableFloors },
      { label: "GFA", value: Math.round(gfa), unit: "m²" },
    ],
  };
}
