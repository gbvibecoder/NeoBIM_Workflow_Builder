/* ─── IFC Enhance — Tier 3 polygon-aware parapet builder ──────────────────
   Phase 3.5b: the parapet now follows the real polygon outline. For each
   edge of the footprint we emit a single rotated `BoxGeometry` segment
   whose length matches the edge plus a small overlap so neighbours meet
   without a gap at the corner. A 4-vertex rectangle produces the same
   N/S/E/W result as 3.5a; a 32-vertex circle produces a smooth ring; an
   irregular polygon traces the actual outline.

   The overlap at each end (`PARAPET.thicknessM`) guarantees visual
   continuity through convex corners and degrades gracefully on concave
   reflex angles: adjacent walls intersect inside the vertex, which is
   hidden by the wall itself. */

import { BoxGeometry, Group, type Material, Mesh } from "three";
import { PARAPET } from "../constants";
import type { RoofFootprint } from "../types";

interface ParapetStats {
  group: Group;
  perimeterM: number;
  segmentCount: number;
}

export function buildParapet(
  footprint: RoofFootprint,
  wallMaterial: Material,
): Group {
  return buildParapetWithStats(footprint, wallMaterial).group;
}

export function buildParapetWithStats(
  footprint: RoofFootprint,
  wallMaterial: Material,
): ParapetStats {
  const { heightM, thicknessM } = PARAPET;
  const { vertices, topY } = footprint;

  const group = new Group();
  group.name = "enhance-tier3-parapet";

  const wallY = topY + heightM / 2;
  let perimeterM = 0;
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];

    const dx = b.x - a.x;
    const dz = b.y - a.y; // polygon .y is world Z
    const edgeLength = Math.hypot(dx, dz);
    if (edgeLength < 1e-4) continue; // degenerate — skip

    perimeterM += edgeLength;

    /* Each segment overlaps neighbours by `thicknessM` on each end so
       corners seal. Longer segment = edgeLength + 2*thicknessM. */
    const segmentLength = edgeLength + thicknessM * 2;

    const midX = (a.x + b.x) / 2;
    const midZ = (a.y + b.y) / 2;

    /* Box local axes: X = along the edge (length), Y = up, Z = thickness.
       Three.js Y-rotation rotates about world +Y; the edge direction in
       the XZ plane makes angle `atan2(dz, dx)` with the +X axis, but a
       positive world-Y rotation turns +X toward -Z (right-hand rule),
       so we want rotation = -atan2(dz, dx) to align local +X with the
       edge direction. */
    const edgeAngle = Math.atan2(dz, dx);

    const geom = new BoxGeometry(segmentLength, heightM, thicknessM);
    const wall = new Mesh(geom, wallMaterial);
    wall.position.set(midX, wallY, midZ);
    wall.rotation.y = -edgeAngle;
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.name = `enhance-tier3-parapet-seg-${i}`;
    group.add(wall);
  }

  return { group, perimeterM, segmentCount: n };
}
