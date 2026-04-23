/* ─── IFC Enhance — Tier 3 gable roof builder ────────────────────────────
   Builds a symmetric gable (two sloped panels meeting at a ridge) plus
   triangular gable-end walls. Invoked only when the resolver picks
   "gable" — bungalows, or any explicit user override.

   Geometry is built as BufferGeometry with explicit vertices so UVs can
   run cleanly down the slope (1 tile ≈ 1 m of slope). Two thin box
   fascias sit along the eaves — without them the slope edges read too
   paper-thin in rendered output.

   Phase 3.5b scope: gable ridge and eave geometry is axis-aligned to the
   footprint's AABB. Polygon-aware extraction (shipped in 3.5b) still
   gives us rich metadata — but gable topology is rectangular by
   construction, so non-rectangular polygons with user-forced gable end
   up with eaves overhanging empty space at concave corners. Circular
   footprints are force-promoted to flat-terrace in `roof-detector.ts`
   and never reach this builder. Irregular polygons with user-forced
   gable remain a 3.5c concern. */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  type Material,
  Mesh,
} from "three";
import { GABLE } from "../constants";
import type { RidgeDirection, RoofFootprint } from "../types";

export interface GableStats {
  group: Group;
  resolvedDirection: "ns" | "ew";
  clampedPitchDeg: number;
  ridgeHeightM: number;
}

export function buildGable(
  footprint: RoofFootprint,
  pitchDeg: number,
  ridgeDirection: RidgeDirection,
  tileMaterial: Material,
  wallMaterial: Material,
): Group {
  return buildGableInternal(footprint, pitchDeg, ridgeDirection, tileMaterial, wallMaterial).group;
}

export function buildGableWithStats(
  footprint: RoofFootprint,
  pitchDeg: number,
  ridgeDirection: RidgeDirection,
  tileMaterial: Material,
  wallMaterial: Material,
): GableStats {
  return buildGableInternal(footprint, pitchDeg, ridgeDirection, tileMaterial, wallMaterial);
}

function buildGableInternal(
  footprint: RoofFootprint,
  pitchDeg: number,
  ridgeDirection: RidgeDirection,
  tileMaterial: Material,
  wallMaterial: Material,
): GableStats {
  const resolvedDirection = resolveRidgeAxis(ridgeDirection, footprint);
  const clampedPitchDeg = Math.max(
    GABLE.minPitchDeg,
    Math.min(GABLE.maxPitchDeg, pitchDeg),
  );
  const pitchRad = (clampedPitchDeg * Math.PI) / 180;

  /* Gable topology is rectangular by construction — consume the polygon
     via its AABB rather than via vertex-centroid. Axis-aligned naming
     preserves 3.5a's math verbatim. */
  const minX = footprint.aabb.minX;
  const maxX = footprint.aabb.maxX;
  const minZ = footprint.aabb.minZ;
  const maxZ = footprint.aabb.maxZ;
  const widthM = maxX - minX;
  const depthM = maxZ - minZ;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  /* Figure out which axis is the ridge (long) vs the fall (short). */
  const isEW = resolvedDirection === "ew";
  const ridgeSpanM = isEW ? widthM : depthM;
  const fallSpanM = isEW ? depthM : widthM;

  const ridgeLengthM = ridgeSpanM + 2 * GABLE.eaveOverhangM;
  const horizontalRunM = fallSpanM / 2 + GABLE.eaveOverhangM;
  const ridgeHeightM = horizontalRunM * Math.tan(pitchRad);
  const slopeLengthM = horizontalRunM / Math.cos(pitchRad);

  const group = new Group();
  group.name = "enhance-tier3-gable";

  /* ── Two sloped panels ───────────────────────────────────────────── */
  const eaveY = footprint.topY;
  const ridgeY = eaveY + ridgeHeightM;

  /* Ridge centre line — along the long axis through the footprint centre. */
  if (isEW) {
    /* Ridge runs along X at Z = centerZ. Slopes face ±Z. */
    const southSlope = buildSlope({
      eaveA: [minX - GABLE.eaveOverhangM, eaveY, minZ - GABLE.eaveOverhangM],
      eaveB: [maxX + GABLE.eaveOverhangM, eaveY, minZ - GABLE.eaveOverhangM],
      ridgeB: [maxX + GABLE.eaveOverhangM, ridgeY, centerZ],
      ridgeA: [minX - GABLE.eaveOverhangM, ridgeY, centerZ],
      ridgeLengthM,
      slopeLengthM,
      material: tileMaterial,
      name: "enhance-tier3-gable-slope-S",
    });
    group.add(southSlope);

    const northSlope = buildSlope({
      eaveA: [maxX + GABLE.eaveOverhangM, eaveY, maxZ + GABLE.eaveOverhangM],
      eaveB: [minX - GABLE.eaveOverhangM, eaveY, maxZ + GABLE.eaveOverhangM],
      ridgeB: [minX - GABLE.eaveOverhangM, ridgeY, centerZ],
      ridgeA: [maxX + GABLE.eaveOverhangM, ridgeY, centerZ],
      ridgeLengthM,
      slopeLengthM,
      material: tileMaterial,
      name: "enhance-tier3-gable-slope-N",
    });
    group.add(northSlope);

    /* Triangular gable end walls — at the actual building edges, not
       extended by the eave overhang. */
    group.add(
      buildGableEndTriangle({
        bottomA: [minX, eaveY, minZ],
        bottomB: [minX, eaveY, maxZ],
        apex: [minX, ridgeY, centerZ],
        material: wallMaterial,
        name: "enhance-tier3-gable-end-W",
      }),
    );
    group.add(
      buildGableEndTriangle({
        bottomA: [maxX, eaveY, maxZ],
        bottomB: [maxX, eaveY, minZ],
        apex: [maxX, ridgeY, centerZ],
        material: wallMaterial,
        name: "enhance-tier3-gable-end-E",
      }),
    );

    /* Fascia strips along the two eaves. Thin box, full ridge length. */
    addEaveFascia(group, {
      length: ridgeLengthM,
      thickness: GABLE.fasciaThicknessM,
      centre: [
        centerX,
        eaveY - GABLE.fasciaThicknessM / 2,
        minZ - GABLE.eaveOverhangM + GABLE.fasciaThicknessM / 2,
      ],
      axisAligned: "x",
      material: wallMaterial,
      name: "enhance-tier3-gable-fascia-S",
    });
    addEaveFascia(group, {
      length: ridgeLengthM,
      thickness: GABLE.fasciaThicknessM,
      centre: [
        centerX,
        eaveY - GABLE.fasciaThicknessM / 2,
        maxZ + GABLE.eaveOverhangM - GABLE.fasciaThicknessM / 2,
      ],
      axisAligned: "x",
      material: wallMaterial,
      name: "enhance-tier3-gable-fascia-N",
    });
  } else {
    /* NS ridge — ridge runs along Z at X = centerX. Slopes face ±X. */
    const westSlope = buildSlope({
      eaveA: [minX - GABLE.eaveOverhangM, eaveY, minZ - GABLE.eaveOverhangM],
      eaveB: [minX - GABLE.eaveOverhangM, eaveY, maxZ + GABLE.eaveOverhangM],
      ridgeB: [centerX, ridgeY, maxZ + GABLE.eaveOverhangM],
      ridgeA: [centerX, ridgeY, minZ - GABLE.eaveOverhangM],
      ridgeLengthM,
      slopeLengthM,
      material: tileMaterial,
      name: "enhance-tier3-gable-slope-W",
    });
    group.add(westSlope);

    const eastSlope = buildSlope({
      eaveA: [maxX + GABLE.eaveOverhangM, eaveY, maxZ + GABLE.eaveOverhangM],
      eaveB: [maxX + GABLE.eaveOverhangM, eaveY, minZ - GABLE.eaveOverhangM],
      ridgeB: [centerX, ridgeY, minZ - GABLE.eaveOverhangM],
      ridgeA: [centerX, ridgeY, maxZ + GABLE.eaveOverhangM],
      ridgeLengthM,
      slopeLengthM,
      material: tileMaterial,
      name: "enhance-tier3-gable-slope-E",
    });
    group.add(eastSlope);

    group.add(
      buildGableEndTriangle({
        bottomA: [maxX, eaveY, minZ],
        bottomB: [minX, eaveY, minZ],
        apex: [centerX, ridgeY, minZ],
        material: wallMaterial,
        name: "enhance-tier3-gable-end-S",
      }),
    );
    group.add(
      buildGableEndTriangle({
        bottomA: [minX, eaveY, maxZ],
        bottomB: [maxX, eaveY, maxZ],
        apex: [centerX, ridgeY, maxZ],
        material: wallMaterial,
        name: "enhance-tier3-gable-end-N",
      }),
    );

    addEaveFascia(group, {
      length: ridgeLengthM,
      thickness: GABLE.fasciaThicknessM,
      centre: [
        minX - GABLE.eaveOverhangM + GABLE.fasciaThicknessM / 2,
        eaveY - GABLE.fasciaThicknessM / 2,
        centerZ,
      ],
      axisAligned: "z",
      material: wallMaterial,
      name: "enhance-tier3-gable-fascia-W",
    });
    addEaveFascia(group, {
      length: ridgeLengthM,
      thickness: GABLE.fasciaThicknessM,
      centre: [
        maxX + GABLE.eaveOverhangM - GABLE.fasciaThicknessM / 2,
        eaveY - GABLE.fasciaThicknessM / 2,
        centerZ,
      ],
      axisAligned: "z",
      material: wallMaterial,
      name: "enhance-tier3-gable-fascia-E",
    });
  }

  return {
    group,
    resolvedDirection,
    clampedPitchDeg,
    ridgeHeightM,
  };
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function resolveRidgeAxis(
  ridgeDirection: RidgeDirection,
  footprint: RoofFootprint,
): "ns" | "ew" {
  if (ridgeDirection === "ns") return "ns";
  if (ridgeDirection === "ew") return "ew";
  /* Auto — ridge along the longer axis. */
  return footprint.longerAxis === "x" ? "ew" : "ns";
}

interface SlopeSpec {
  /** Eave edge, corner A (must be one end of the eave). */
  eaveA: [number, number, number];
  /** Eave edge, corner B (the other end — CCW from above looking down). */
  eaveB: [number, number, number];
  /** Ridge edge, corner B (over eaveB). */
  ridgeB: [number, number, number];
  /** Ridge edge, corner A (over eaveA). */
  ridgeA: [number, number, number];
  /** World-space ridge length — controls U tiling. */
  ridgeLengthM: number;
  /** World-space slope length — controls V tiling. */
  slopeLengthM: number;
  material: Material;
  name: string;
}

/**
 * Build a four-vertex BufferGeometry slope. Vertex order is chosen so the
 * face normal points outward + upward (CCW winding viewed from outside).
 * UVs tile from eave (V=0) to ridge (V=slopeLength) at 1 tile/metre.
 */
function buildSlope(spec: SlopeSpec): Mesh {
  const geom = new BufferGeometry();

  /* 4 vertices — A B C D in order eave→eave→ridge→ridge so a fan gives
     correct winding. */
  const positions = new Float32Array([
    spec.eaveA[0], spec.eaveA[1], spec.eaveA[2],
    spec.eaveB[0], spec.eaveB[1], spec.eaveB[2],
    spec.ridgeB[0], spec.ridgeB[1], spec.ridgeB[2],
    spec.ridgeA[0], spec.ridgeA[1], spec.ridgeA[2],
  ]);
  geom.setAttribute("position", new BufferAttribute(positions, 3));

  const uScale = spec.ridgeLengthM * GABLE.tileUvScalePerMeter;
  const vScale = spec.slopeLengthM * GABLE.tileUvScalePerMeter;
  const uvs = new Float32Array([
    0, 0,
    uScale, 0,
    uScale, vScale,
    0, vScale,
  ]);
  geom.setAttribute("uv", new BufferAttribute(uvs, 2));

  /* Two triangles: 0-1-2 and 0-2-3. */
  geom.setIndex([0, 1, 2, 0, 2, 3]);
  geom.computeVertexNormals();

  const mesh = new Mesh(geom, spec.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = spec.name;
  return mesh;
}

interface GableEndSpec {
  bottomA: [number, number, number];
  bottomB: [number, number, number];
  apex: [number, number, number];
  material: Material;
  name: string;
}

/**
 * Build a triangular gable-end wall. 3 vertices, 1 triangle. Double-sided
 * via the (brick) material's `side` setting isn't guaranteed, so we force
 * DoubleSide at the mesh level by cloning the material isn't acceptable
 * (shared with Tier 1). Instead we pick the winding to face outward.
 */
function buildGableEndTriangle(spec: GableEndSpec): Mesh {
  const geom = new BufferGeometry();
  const positions = new Float32Array([
    spec.bottomA[0], spec.bottomA[1], spec.bottomA[2],
    spec.bottomB[0], spec.bottomB[1], spec.bottomB[2],
    spec.apex[0], spec.apex[1], spec.apex[2],
  ]);
  geom.setAttribute("position", new BufferAttribute(positions, 3));

  /* Flat UVs scaled by triangle bounds so the brick tiles at ~2m pitch. */
  const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
  geom.setAttribute("uv", new BufferAttribute(uvs, 2));

  geom.setIndex([0, 1, 2]);
  geom.computeVertexNormals();

  const mesh = new Mesh(geom, spec.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = spec.name;
  /* DoubleSide on the wall material is set at catalog-build time
     (MeshStandardMaterial with `side: DoubleSide`), so our triangle is
     visible from both sides even if winding is off. */
  return mesh;
}

interface FasciaSpec {
  length: number;
  thickness: number;
  centre: [number, number, number];
  axisAligned: "x" | "z";
  material: Material;
  name: string;
}

function addEaveFascia(group: Group, spec: FasciaSpec): void {
  const box =
    spec.axisAligned === "x"
      ? new BoxGeometry(spec.length, spec.thickness, spec.thickness)
      : new BoxGeometry(spec.thickness, spec.thickness, spec.length);
  /* Suppress the default DoubleSide warning on BoxGeometry — not needed here. */
  const mesh = new Mesh(box, spec.material);
  mesh.position.set(spec.centre[0], spec.centre[1], spec.centre[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = spec.name;
  group.add(mesh);
}
