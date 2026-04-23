/* ─── IFC Enhance — Tier 3 parapet builder ───────────────────────────────
   Four axis-aligned box walls arranged around the roof footprint. N and S
   walls span the full building width; E and W walls sit between them,
   shorter by 2× parapet thickness so the corners form a solid L rather
   than a double-thick block. The result is a continuous 1 m guard wall
   wrapping the terrace with no gaps. */

import { BoxGeometry, Group, type Material, Mesh } from "three";
import { PARAPET } from "../constants";
import type { RoofFootprint } from "./polygon-extractor";

interface ParapetStats {
  group: Group;
  perimeterM: number;
}

/**
 * Build a parapet group around `footprint`. All four walls share the
 * supplied `wallMaterial` — reuse Phase 2's wall-exterior so the parapet
 * visually continues the building envelope.
 */
export function buildParapet(
  footprint: RoofFootprint,
  wallMaterial: Material,
): Group {
  return buildParapetInternal(footprint, wallMaterial).group;
}

/**
 * Same as `buildParapet` but also returns the perimeter metres — used by
 * the engine for its result payload / status banner. Kept separate so
 * callers that only want the Group aren't forced to destructure.
 */
export function buildParapetWithStats(
  footprint: RoofFootprint,
  wallMaterial: Material,
): ParapetStats {
  return buildParapetInternal(footprint, wallMaterial);
}

function buildParapetInternal(
  footprint: RoofFootprint,
  wallMaterial: Material,
): ParapetStats {
  const { heightM, thicknessM } = PARAPET;
  const { minX, maxX, minZ, maxZ, widthM, depthM, topY } = footprint;

  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  const wallY = topY + heightM / 2;

  const group = new Group();
  group.name = "enhance-tier3-parapet";

  /* N + S walls span the full width; their outer face sits flush with the
     footprint edge, so centre them half-a-thickness inward. */
  const ewSpan = widthM; // X length for N/S walls
  const nsSpan = Math.max(depthM - 2 * thicknessM, 0.01); // Z length for E/W walls

  const southGeom = new BoxGeometry(ewSpan, heightM, thicknessM);
  const south = new Mesh(southGeom, wallMaterial);
  south.position.set(centreX, wallY, minZ + thicknessM / 2);
  south.castShadow = true;
  south.receiveShadow = true;
  south.name = "enhance-tier3-parapet-S";
  group.add(south);

  const northGeom = new BoxGeometry(ewSpan, heightM, thicknessM);
  const north = new Mesh(northGeom, wallMaterial);
  north.position.set(centreX, wallY, maxZ - thicknessM / 2);
  north.castShadow = true;
  north.receiveShadow = true;
  north.name = "enhance-tier3-parapet-N";
  group.add(north);

  /* E + W walls span the inner depth, slotting between N and S at the
     corners so no geometry overlaps. */
  const westGeom = new BoxGeometry(thicknessM, heightM, nsSpan);
  const west = new Mesh(westGeom, wallMaterial);
  west.position.set(minX + thicknessM / 2, wallY, centreZ);
  west.castShadow = true;
  west.receiveShadow = true;
  west.name = "enhance-tier3-parapet-W";
  group.add(west);

  const eastGeom = new BoxGeometry(thicknessM, heightM, nsSpan);
  const east = new Mesh(eastGeom, wallMaterial);
  east.position.set(maxX - thicknessM / 2, wallY, centreZ);
  east.castShadow = true;
  east.receiveShadow = true;
  east.name = "enhance-tier3-parapet-E";
  group.add(east);

  /* Perimeter stat: outer edge length, not inner — matches what a BOQ
     would report for the parapet quantity. */
  const perimeterM = 2 * (widthM + depthM);

  return { group, perimeterM };
}
