/* ─── IFC Enhance — Tier 3 terrace deck builder ──────────────────────────
   Lays a wooden deck plane over the hidden roof-slab. Textures are pulled
   from Phase 2's cache (same slug+quality key) so re-apply is instant.

   Ceramic and concrete deck variants are declared in the type surface but
   fall through to wood in 3.5a — the panel greys them out with a "coming
   soon" affordance, so this path is defensive rather than user-reachable. */

import {
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Texture,
  type WebGLRenderer,
} from "three";
import { DECK } from "../constants";
import { PBR_BY_TAG } from "../constants";
import { loadPBRTextures } from "../texture-loader";
import type { DeckMaterial, MaterialQuality } from "../types";
import type { RoofFootprint } from "./polygon-extractor";

export interface BuildDeckParams {
  footprint: RoofFootprint;
  deckMaterial: DeckMaterial;
  quality: MaterialQuality;
  renderer: WebGLRenderer;
}

/**
 * Build a deck mesh sized to the roof footprint. Always returns a single
 * Mesh (no Group) — keeps the engine's dispose logic simple.
 */
export async function buildDeck({
  footprint,
  deckMaterial,
  quality,
  renderer,
}: BuildDeckParams): Promise<Mesh> {
  /* Phase 3.5a only ships wood; ceramic/concrete fall through to the same
     wood spec for now. The UI greys those options out, so users never see
     this fallback. */
  const spec = PBR_BY_TAG["floor-slab"];
  if (!spec) {
    throw new Error("deck-builder: floor-slab PBR spec missing from catalog");
  }

  /* Fetch through the shared texture cache — zero re-downloads if the
     Phase 2 material catalog already pulled these for interior floors. */
  const textures = await loadPBRTextures(spec, quality, renderer);

  /* UV scaling: we want plank width ≈ DECK.plankWidthM in world space.
     PlaneGeometry's default UVs span 0..1 across the whole plane, so to
     make each "tile" of the wood texture occupy `plankWidthM` metres we
     repeat `widthM / plankWidthM` times. Same formula on the other axis,
     using the texture's own tile size. */
  const repeatU = footprint.widthM / DECK.plankWidthM;
  const repeatV = footprint.depthM / spec.tilingMetres;

  const map = cloneWithRepeat(textures.map, repeatU, repeatV);
  const normalMap = cloneWithRepeat(textures.normalMap, repeatU, repeatV);
  const roughnessMap = cloneWithRepeat(textures.roughnessMap, repeatU, repeatV);
  const aoMap = textures.aoMap
    ? cloneWithRepeat(textures.aoMap, repeatU, repeatV)
    : undefined;

  /* Longer axis decides plank orientation — rotate UVs 90° when Z is the
     longer axis so the grain runs "down" the longer dimension. */
  if (footprint.longerAxis === "z") {
    rotateUVs90(map);
    rotateUVs90(normalMap);
    rotateUVs90(roughnessMap);
    if (aoMap) rotateUVs90(aoMap);
  }

  const material = new MeshStandardMaterial({
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: DoubleSide,
    envMapIntensity: 1.0,
    map,
    normalMap,
    roughnessMap,
    ...(aoMap && { aoMap }),
  });
  material.name = `enhance-tier3-deck-${deckMaterial}`;

  const geometry = new PlaneGeometry(footprint.widthM, footprint.depthM);
  geometry.rotateX(-Math.PI / 2); // lie flat on XZ

  const mesh = new Mesh(geometry, material);
  mesh.position.set(
    footprint.centerX,
    footprint.topY + DECK.elevationAboveSlabM,
    footprint.centerZ,
  );
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "enhance-tier3-deck";
  return mesh;
}

/* Clone a cached texture so `repeat`/`rotation` overrides don't poison
   the shared cache entry. The underlying image/GPU upload is shared. */
function cloneWithRepeat(source: Texture, repeatU: number, repeatV: number): Texture {
  const t = source.clone();
  t.repeat.set(repeatU, repeatV);
  t.needsUpdate = true;
  return t;
}

function rotateUVs90(t: Texture): void {
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2;
  t.needsUpdate = true;
}
