/* ─── IFC Enhance — Tier 2 ground builder (post-strip) ───────────────────
   Builds the ground plane only. Sidewalk, road, and their helpers were
   removed in the Phase 3 strip — they'll return in a later phase.

   Textures are loaded through Phase 2's `loadPBRTextures` cache so a
   re-apply is instant. */

import {
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Texture,
  type WebGLRenderer,
} from "three";
import { loadPBRTextures, type LoadedPBRTextures } from "../texture-loader";
import {
  GROUND_SIZE_MULTIPLIER,
  GROUND_TEXTURE_SPECS,
} from "../constants";
import type { GroundType, MaterialQuality } from "../types";
import type { BuildingBoundsResult } from "./placement-utils";

/**
 * Resolve "auto" → grass. With the Phase 3 strip the road path is gone,
 * so "auto" deterministically picks grass. Explicit types pass straight
 * through.
 */
export function resolveGroundType(type: GroundType): Exclude<GroundType, "auto"> {
  if (type !== "auto") return type;
  return "grass";
}

async function loadGroundTextures(
  which: Exclude<GroundType, "auto">,
  quality: MaterialQuality,
  renderer: WebGLRenderer,
): Promise<LoadedPBRTextures> {
  const spec = GROUND_TEXTURE_SPECS[which];
  return loadPBRTextures(spec, quality, renderer);
}

/* ─── Ground plane ────────────────────────────────────────────────────── */

export interface BuildGroundParams {
  bounds: BuildingBoundsResult;
  groundType: Exclude<GroundType, "auto">;
  quality: MaterialQuality;
  renderer: WebGLRenderer;
}

export async function buildGround({ bounds, groundType, quality, renderer }: BuildGroundParams): Promise<Mesh> {
  const side = bounds.maxExtentM * GROUND_SIZE_MULTIPLIER;
  const textures = await loadGroundTextures(groundType, quality, renderer);
  const spec = GROUND_TEXTURE_SPECS[groundType];

  const geometry = new PlaneGeometry(side, side);
  geometry.rotateX(-Math.PI / 2); // lie flat on XZ

  /* Tile the texture across the ground. We clone the Phase 2 textures to
     preserve the shared cache while giving ground its own `repeat`. */
  const tileCount = side / spec.tilingMetres;
  const material = new MeshStandardMaterial({
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: DoubleSide,
    envMapIntensity: 1.0,
    ...(textures.map && { map: cloneWithRepeat(textures.map, tileCount) }),
    ...(textures.normalMap && { normalMap: cloneWithRepeat(textures.normalMap, tileCount) }),
    ...(textures.roughnessMap && { roughnessMap: cloneWithRepeat(textures.roughnessMap, tileCount) }),
    ...(quality !== "low" && textures.aoMap && { aoMap: cloneWithRepeat(textures.aoMap, tileCount) }),
  });
  material.name = `enhance-ground-${groundType}`;

  const mesh = new Mesh(geometry, material);
  /* Slightly below Y=minY so it never Z-fights with slabs or the blueprint
     grid. renderOrder=-1 ensures it draws first. */
  mesh.position.set(bounds.center.x, bounds.footprint.minY - 0.05, bounds.center.z);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = -1;
  mesh.name = "enhance-ground";
  return mesh;
}

/* Clone a texture just enough to override `repeat` without breaking the
   Phase 2 cache. The underlying image is shared; only the Texture handle
   is new. */
function cloneWithRepeat(source: Texture, repeat: number): Texture {
  const t = source.clone();
  t.needsUpdate = true;
  t.repeat.set(repeat, repeat);
  return t;
}
