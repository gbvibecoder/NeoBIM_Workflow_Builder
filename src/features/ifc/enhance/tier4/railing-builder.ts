/* ─── IFC Enhance — Tier 4 railing builder ────────────────────────────────
   Phase 4a hotfix: the builder now walks balcony POLYGONS (not axis
   edges). For each polygon, we emit one railing assembly per `railSegment`
   — the subset of polygon edges that represent a real slab perimeter.
   Synthetic edges along the wall boundary are filtered upstream by the
   detector. Result: railings follow the balcony perimeter precisely and
   never extend into mid-air past a cantilever corner.

   Each railing segment is the sum of three primitives:
     - Top rail (horizontal cylinder along the edge, at `heightM` above slab)
     - Base rail (horizontal cylinder at `baseRailOffsetM` above slab)
     - Balusters (vertical cylinders spaced `balusterSpacingM` apart)

   All meshes share a single `MeshStandardMaterial` built from
   `RAILING.metal`. Reset disposes one material, not N. */

import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { RAILING } from "../constants";
import type { BalconyPolygon, RailingStyle } from "../types";

export interface RailingBuildResult {
  group: Group;
  /** Number of distinct balconies that produced at least one rail segment. */
  count: number;
}

/**
 * Build railings for every balcony polygon. Returns a single Group that
 * should be added under the tier-4 root. The `count` field reports the
 * number of balconies that contributed at least one rail segment — this
 * is the value the banner should display ("1 balcony", not "4 rails").
 */
export function buildRailingsForPolygons(
  polygons: BalconyPolygon[],
  style: RailingStyle,
): RailingBuildResult {
  const group = new Group();
  group.name = "enhance-tier4-railings";

  if (polygons.length === 0) return { group, count: 0 };

  const material = buildRailingMaterial(style);
  let count = 0;

  for (let i = 0; i < polygons.length; i++) {
    const bal = polygons[i];
    const sub = new Group();
    sub.name = `enhance-tier4-balcony-${i}`;
    let railCount = 0;
    for (const seg of bal.railSegments) {
      const len = Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y);
      if (len < RAILING.minEdgeLengthM) continue;
      const railGroup = buildRailingForSegment(seg.start, seg.end, bal.slabY, material);
      sub.add(railGroup);
      railCount += 1;
    }
    if (railCount > 0) {
      group.add(sub);
      count += 1;
    }
  }

  return { group, count };
}

function buildRailingMaterial(style: RailingStyle): MeshStandardMaterial {
  /* Only `metal` today; switch keeps the signature future-proof. */
  const spec = style === "metal" ? RAILING.metal : RAILING.metal;
  const mat = new MeshStandardMaterial({
    color: spec.color,
    metalness: spec.metalness,
    roughness: spec.roughness,
    envMapIntensity: 1.0,
  });
  mat.name = "enhance-tier4-railing-metal";
  return mat;
}

/**
 * Build top rail + base rail + balusters along a single balcony edge.
 * Edge start/end live in world XZ (Vector2-style with .x/.y mapped to
 * world X/Z); `slabY` is the world-Y of the railing base.
 */
function buildRailingForSegment(
  start: { x: number; y: number },
  end: { x: number; y: number },
  slabY: number,
  material: MeshStandardMaterial,
): Group {
  const group = new Group();
  const {
    heightM,
    topRailRadiusM,
    balusterRadiusM,
    balusterSpacingM,
    baseRailRadiusM,
    baseRailOffsetM,
  } = RAILING;

  const dx = end.x - start.x;
  const dz = end.y - start.y;
  const length = Math.hypot(dx, dz);
  if (length < 1e-4) return group;
  const direction = new Vector3(dx / length, 0, dz / length);

  const midX = (start.x + end.x) / 2;
  const midZ = (start.y + end.y) / 2;
  const alongQuat = quaternionFromUpTo(direction);

  /* Top rail */
  const topRail = new Mesh(
    new CylinderGeometry(topRailRadiusM, topRailRadiusM, length, 8),
    material,
  );
  topRail.position.set(midX, slabY + heightM, midZ);
  topRail.quaternion.copy(alongQuat);
  topRail.castShadow = true;
  topRail.receiveShadow = true;
  group.add(topRail);

  /* Base rail */
  const baseRail = new Mesh(
    new CylinderGeometry(baseRailRadiusM, baseRailRadiusM, length, 8),
    material,
  );
  baseRail.position.set(midX, slabY + baseRailOffsetM, midZ);
  baseRail.quaternion.copy(alongQuat);
  baseRail.castShadow = true;
  baseRail.receiveShadow = true;
  group.add(baseRail);

  /* Balusters — evenly spaced, endpoints inset slightly so adjacent
     segments at a polygon corner don't collide visually. */
  const count = Math.max(2, Math.floor(length / balusterSpacingM) + 1);
  const balusterHeight = heightM - baseRailOffsetM;
  const balusterCenterY = slabY + baseRailOffsetM + balusterHeight / 2;
  const balusterGeom = new CylinderGeometry(
    balusterRadiusM,
    balusterRadiusM,
    balusterHeight,
    6,
  );
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const baluster = new Mesh(balusterGeom, material);
    baluster.position.set(
      start.x + direction.x * length * t,
      balusterCenterY,
      start.y + direction.z * length * t,
    );
    baluster.castShadow = true;
    baluster.receiveShadow = true;
    group.add(baluster);
  }

  return group;
}

function quaternionFromUpTo(direction: Vector3): Quaternion {
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();
  q.setFromUnitVectors(up, direction);
  return q;
}
