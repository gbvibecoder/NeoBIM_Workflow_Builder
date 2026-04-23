/* ─── IFC Enhance — Tier 3 polygon-aware bulkhead builder ────────────────
   Phase 3.5b: stair bulkhead and HVAC units are placed using the real
   polygon footprint, not the AABB. The stair bulkhead sits at a vertex
   of the polygon inset by its half-footprint + clearance, oriented so
   its door faces the polygon centroid. HVAC units line up along the
   longest footprint edge (offset inward) and each slot is validated
   with a point-in-polygon test before placement — irregular shapes can
   reject slots that would land in a concave bay.

   Count logic is unchanged: 1/2/3 units scaled by roof area. Actual
   placed count is surfaced via stats so the engine can report the true
   number to the status banner. */

import {
  BoxGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector2,
} from "three";
import { BULKHEAD } from "../constants";
import type { RoofFootprint } from "../types";
import {
  insetPolygon,
  pointInPolygon,
  polygonCentroid,
} from "./polygon-utils";

export interface BulkheadsStats {
  group: Group;
  hvacCount: number;
  hasStairBulkhead: boolean;
}

export function buildBulkheads(
  footprint: RoofFootprint,
  wallMaterial: Material,
): Group {
  return buildBulkheadsWithStats(footprint, wallMaterial).group;
}

export function buildBulkheadsWithStats(
  footprint: RoofFootprint,
  wallMaterial: Material,
): BulkheadsStats {
  const group = new Group();
  group.name = "enhance-tier3-bulkheads";

  const stair = addStairBulkhead(group, footprint, wallMaterial);
  const hvac = addHVACUnits(group, footprint, stair.avoid);

  return {
    group,
    hvacCount: hvac.count,
    hasStairBulkhead: stair.added,
  };
}

/* ── Stair bulkhead ────────────────────────────────────────────────── */

interface StairResult {
  added: boolean;
  /** Axis-aligned avoidance rectangle in world XZ (for HVAC clearance). */
  avoid: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
}

function addStairBulkhead(
  group: Group,
  footprint: RoofFootprint,
  wallMaterial: Material,
): StairResult {
  const {
    stairWidthM,
    stairDepthM,
    stairHeightM,
    stairInsetFromEdgeM,
    doorWidthM,
    doorHeightM,
    doorColor,
  } = BULKHEAD;

  /* Inset distance = stair half-extent + clearance. Use the larger half
     so a nearly-square bulkhead fits either orientation. */
  const halfExtent = Math.max(stairWidthM, stairDepthM) / 2;
  const insetDistance = halfExtent + stairInsetFromEdgeM;

  const inset = insetPolygon(footprint.vertices, insetDistance);
  if (inset.length < 3) return { added: false, avoid: null };

  /* Pick the inset vertex closest to the footprint's SW corner —
     matches 3.5a's "SW corner" intuition while honouring the actual
     shape. Ties broken by whichever vertex has the lowest X+Z sum. */
  const { minX, minZ } = footprint.aabb;
  let best: Vector2 | null = null;
  let bestScore = Infinity;
  for (const v of inset) {
    const dx = v.x - minX;
    const dz = v.y - minZ;
    const score = Math.hypot(dx, dz);
    if (score < bestScore) {
      bestScore = score;
      best = v;
    }
  }
  if (!best) return { added: false, avoid: null };

  /* Safety: the candidate must genuinely be inside the original polygon
     (inset can wander on sharp reflex corners). */
  if (!pointInPolygon(best.x, best.y, footprint.vertices)) {
    return { added: false, avoid: null };
  }

  /* Orient the bulkhead so its "front" face (local +Z) points toward
     the centroid — this is the face that will carry the door. */
  const centroid = polygonCentroid(footprint.vertices);
  const dirX = centroid.x - best.x;
  const dirZ = centroid.y - best.y;
  const yawRad = Math.atan2(dirX, dirZ); // heading angle — so local +Z aligns with (dirX, dirZ)

  const stairX = best.x;
  const stairZ = best.y;
  const stairY = footprint.topY + stairHeightM / 2;

  const geometry = new BoxGeometry(stairWidthM, stairHeightM, stairDepthM);
  const box = new Mesh(geometry, wallMaterial);
  box.position.set(stairX, stairY, stairZ);
  box.rotation.y = yawRad;
  box.castShadow = true;
  box.receiveShadow = true;
  box.name = "enhance-tier3-stair-bulkhead";
  group.add(box);

  /* Door — a dark plane parented under the bulkhead so rotation carries
     through. Inset 1 mm in front of the +Z face. */
  const doorGeom = new PlaneGeometry(doorWidthM, doorHeightM);
  const doorMaterial = new MeshStandardMaterial({
    color: doorColor,
    roughness: 0.75,
    metalness: 0.05,
  });
  doorMaterial.name = "enhance-tier3-bulkhead-door";
  const door = new Mesh(doorGeom, doorMaterial);
  /* Local-space coords: +Z is centroid-facing, door sits at z = depth/2
     with its base near y = -height/2. */
  door.position.set(0, -stairHeightM / 2 + doorHeightM / 2, stairDepthM / 2 + 0.001);
  door.name = "enhance-tier3-stair-door";
  box.add(door);

  /* Avoidance rectangle for HVAC uses the AABB of the rotated bulkhead —
     a safe over-approximation. */
  const halfDiag = Math.hypot(stairWidthM, stairDepthM) / 2 + 0.3;
  const avoid = {
    minX: stairX - halfDiag,
    maxX: stairX + halfDiag,
    minZ: stairZ - halfDiag,
    maxZ: stairZ + halfDiag,
  };

  return { added: true, avoid };
}

/* ── HVAC condensers ───────────────────────────────────────────────── */

function addHVACUnits(
  group: Group,
  footprint: RoofFootprint,
  avoid: { minX: number; maxX: number; minZ: number; maxZ: number } | null,
): { count: number } {
  const {
    hvacWidthM,
    hvacHeightM,
    hvacDepthM,
    hvacInsetFromEdgeM,
    hvacSpacingMinM,
    hvac2CountThresholdM2,
    hvac3CountThresholdM2,
    hvacColor,
    hvacMetalness,
    hvacRoughness,
  } = BULKHEAD;

  const area = footprint.areaM2;
  const desiredCount =
    area > hvac3CountThresholdM2
      ? 3
      : area > hvac2CountThresholdM2
        ? 2
        : 1;

  /* Longest polygon edge — always anchor the HVAC row to this edge. For
     a rectangle this picks the long side; for a circle all edges are
     short but we still pick one, deterministically (lowest index wins
     ties). */
  const { vertices } = footprint;
  const n = vertices.length;
  let longestLen = -Infinity;
  let longestIdx = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > longestLen) {
      longestLen = len;
      longestIdx = i;
    }
  }
  if (longestLen < hvacWidthM + 2 * hvacInsetFromEdgeM) {
    /* Longest edge can't host even one unit with clearance. */
    return { count: 0 };
  }

  const a = vertices[longestIdx];
  const b = vertices[(longestIdx + 1) % n];
  const edgeDx = b.x - a.x;
  const edgeDz = b.y - a.y;
  const edgeLen = Math.hypot(edgeDx, edgeDz);
  const tx = edgeDx / edgeLen;
  const tz = edgeDz / edgeLen;
  /* Inward normal (rot90CCW — matches polygon-utils' convention). */
  const inwardX = -tz;
  const inwardZ = tx;

  /* Inset line: edge offset inward by hvacInsetFromEdgeM. */
  const insetAX = a.x + inwardX * hvacInsetFromEdgeM;
  const insetAZ = a.y + inwardZ * hvacInsetFromEdgeM;

  /* Usable band length after trimming clearance at both ends. */
  const clearLen = edgeLen - 2 * hvacInsetFromEdgeM;
  if (clearLen <= 0) return { count: 0 };

  const maxFit = 1 + Math.floor(clearLen / Math.max(hvacSpacingMinM, 0.01));
  const attemptCount = Math.max(1, Math.min(desiredCount, maxFit));

  const edgeAngle = Math.atan2(edgeDz, edgeDx);
  const unitMaterial = new MeshStandardMaterial({
    color: hvacColor,
    roughness: hvacRoughness,
    metalness: hvacMetalness,
  });
  unitMaterial.name = "enhance-tier3-hvac";

  const hvacY = footprint.topY + hvacHeightM / 2 + 0.05;

  let placed = 0;
  for (let i = 0; i < attemptCount; i++) {
    const t = attemptCount === 1
      ? 0.5
      : i / (attemptCount - 1);
    const slotDist = hvacInsetFromEdgeM + t * clearLen;
    const slotX = a.x + tx * slotDist + inwardX * hvacInsetFromEdgeM;
    const slotZ = a.y + tz * slotDist + inwardZ * hvacInsetFromEdgeM;

    /* Reject if the slot falls outside the polygon (concave edge bay
       can make this happen). */
    if (!pointInPolygon(slotX, slotZ, footprint.vertices)) continue;

    /* Reject if it would collide with the stair bulkhead avoidance
       rectangle. */
    if (avoid &&
        slotX > avoid.minX && slotX < avoid.maxX &&
        slotZ > avoid.minZ && slotZ < avoid.maxZ) {
      continue;
    }

    const geom = new BoxGeometry(hvacWidthM, hvacHeightM, hvacDepthM);
    const box = new Mesh(geom, unitMaterial);
    box.position.set(slotX, hvacY, slotZ);
    box.rotation.y = -edgeAngle; // face perpendicular to edge
    box.castShadow = true;
    box.receiveShadow = true;
    box.name = `enhance-tier3-hvac-${i}`;
    group.add(box);
    placed += 1;
  }

  /* If every candidate slot was rejected, the material we speculatively
     built is orphaned — dispose it so we don't leak a GPU allocation. */
  if (placed === 0) unitMaterial.dispose();

  return { count: placed };
}
