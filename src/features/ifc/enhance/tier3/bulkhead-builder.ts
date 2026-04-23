/* ─── IFC Enhance — Tier 3 bulkhead builder ──────────────────────────────
   Populates the flat terrace with the two standard rooftop signifiers:
   a stair-access bulkhead at the SW corner and a row of HVAC condensers
   along the east edge. Count scales with roof area — small roofs get one
   unit, big roofs get three. All placement is structural (corner + edge),
   no RNG needed so results are deterministic.

   The bulkhead "door" is drawn as a dark plane inset 1 mm from the face
   that points toward the roof centre — cheaper than a cut-out box and
   reads well from any normal viewing angle. */

import {
  BoxGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import { BULKHEAD } from "../constants";
import type { RoofFootprint } from "./polygon-extractor";

export interface BulkheadsStats {
  group: Group;
  hvacCount: number;
  hasStairBulkhead: boolean;
}

/**
 * Build stair bulkhead + HVAC condensers as a single disposable Group.
 * `wallMaterial` is reused for the stair box; HVAC units get their own
 * fresh metal-look material (disposed on reset alongside the group).
 */
export function buildBulkheads(
  footprint: RoofFootprint,
  wallMaterial: Material,
): Group {
  return buildBulkheadsInternal(footprint, wallMaterial).group;
}

export function buildBulkheadsWithStats(
  footprint: RoofFootprint,
  wallMaterial: Material,
): BulkheadsStats {
  return buildBulkheadsInternal(footprint, wallMaterial);
}

function buildBulkheadsInternal(
  footprint: RoofFootprint,
  wallMaterial: Material,
): BulkheadsStats {
  const group = new Group();
  group.name = "enhance-tier3-bulkheads";

  const stairResult = addStairBulkhead(group, footprint, wallMaterial);
  const hvacResult = addHVACUnits(group, footprint);

  return {
    group,
    hvacCount: hvacResult.count,
    hasStairBulkhead: stairResult.added,
  };
}

/* ── Stair bulkhead ────────────────────────────────────────────────── */

function addStairBulkhead(
  group: Group,
  footprint: RoofFootprint,
  wallMaterial: Material,
): { added: boolean } {
  const {
    stairWidthM,
    stairDepthM,
    stairHeightM,
    stairInsetFromEdgeM,
    doorWidthM,
    doorHeightM,
    doorColor,
  } = BULKHEAD;

  /* Don't try to place a bulkhead on a tiny rooftop — the inset would
     put it outside the parapet. */
  if (
    footprint.widthM < stairWidthM + 2 * stairInsetFromEdgeM ||
    footprint.depthM < stairDepthM + 2 * stairInsetFromEdgeM
  ) {
    return { added: false };
  }

  const stairX =
    footprint.minX + stairInsetFromEdgeM + stairWidthM / 2;
  const stairZ =
    footprint.minZ + stairInsetFromEdgeM + stairDepthM / 2;
  const stairY = footprint.topY + stairHeightM / 2;

  const geometry = new BoxGeometry(stairWidthM, stairHeightM, stairDepthM);
  const box = new Mesh(geometry, wallMaterial);
  box.position.set(stairX, stairY, stairZ);
  box.castShadow = true;
  box.receiveShadow = true;
  box.name = "enhance-tier3-stair-bulkhead";
  group.add(box);

  /* Door — a dark plane on the face that points toward the roof centre.
     The bulkhead is in the SW corner, so the door goes on either its
     north face (facing +Z) or east face (facing +X). Picking the face
     along the longer inward direction keeps the door visible from the
     primary camera angles. */
  const doorGeom = new PlaneGeometry(doorWidthM, doorHeightM);
  const doorMaterial = new MeshStandardMaterial({
    color: doorColor,
    roughness: 0.75,
    metalness: 0.05,
  });
  doorMaterial.name = "enhance-tier3-bulkhead-door";
  const door = new Mesh(doorGeom, doorMaterial);

  const inwardAxis: "x" | "z" =
    footprint.widthM >= footprint.depthM ? "x" : "z";

  /* Base Y — door is grounded at the deck, not centred on the bulkhead. */
  const doorBaseY = footprint.topY + doorHeightM / 2 + 0.001;
  if (inwardAxis === "x") {
    /* East face. */
    door.position.set(stairX + stairWidthM / 2 + 0.001, doorBaseY, stairZ);
    door.rotation.y = Math.PI / 2;
  } else {
    /* North face. */
    door.position.set(stairX, doorBaseY, stairZ + stairDepthM / 2 + 0.001);
    /* Default plane faces +Z — no rotation needed. */
  }
  door.name = "enhance-tier3-stair-door";
  group.add(door);

  return { added: true };
}

/* ── HVAC condensers ───────────────────────────────────────────────── */

function addHVACUnits(
  group: Group,
  footprint: RoofFootprint,
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

  const area = footprint.widthM * footprint.depthM;
  const count =
    area > hvac3CountThresholdM2
      ? 3
      : area > hvac2CountThresholdM2
        ? 2
        : 1;

  /* Usable Z band — inside the parapet, and clear of the SW stair
     bulkhead corner so we don't intersect it. */
  const stairClearZ =
    footprint.minZ + BULKHEAD.stairInsetFromEdgeM + BULKHEAD.stairDepthM + 0.5;
  const parapetClearZ = footprint.maxZ - hvacInsetFromEdgeM;
  const bandStartZ = Math.max(stairClearZ, footprint.minZ + hvacInsetFromEdgeM);
  const bandEndZ = parapetClearZ;
  const bandLength = Math.max(bandEndZ - bandStartZ, 0);

  /* If the band is too short for the requested count, drop count to fit
     while respecting min spacing. */
  const maxFit =
    bandLength <= 0
      ? 0
      : 1 + Math.floor(bandLength / Math.max(hvacSpacingMinM, 0.01));
  const effectiveCount = Math.max(1, Math.min(count, maxFit));

  if (bandLength <= 0) {
    /* Degenerate band — can't fit anything cleanly. */
    return { count: 0 };
  }

  const hvacMaterial = new MeshStandardMaterial({
    color: hvacColor,
    roughness: hvacRoughness,
    metalness: hvacMetalness,
  });
  hvacMaterial.name = "enhance-tier3-hvac";

  const hvacX = footprint.maxX - hvacInsetFromEdgeM;
  /* Lift 5 cm so each unit visibly sits on a pad — more believable than
     planted on the deck. */
  const hvacY = footprint.topY + hvacHeightM / 2 + 0.05;

  let placed = 0;
  for (let i = 0; i < effectiveCount; i++) {
    const t =
      effectiveCount === 1
        ? 0.5
        : i / (effectiveCount - 1);
    const z = bandStartZ + t * bandLength;

    const geom = new BoxGeometry(hvacWidthM, hvacHeightM, hvacDepthM);
    const box = new Mesh(geom, hvacMaterial);
    box.position.set(hvacX, hvacY, z);
    box.castShadow = true;
    box.receiveShadow = true;
    box.name = `enhance-tier3-hvac-${i}`;
    group.add(box);
    placed += 1;
  }

  return { count: placed };
}
