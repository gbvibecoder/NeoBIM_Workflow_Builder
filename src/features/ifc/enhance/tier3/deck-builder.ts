/* ─── IFC Enhance — Tier 3 polygon-aware deck builder ────────────────────
   Phase 3.5b: the deck is now a `ShapeGeometry` built from the polygon
   footprint rather than a rectangular `PlaneGeometry`. Three.js's
   ear-clipping triangulator handles non-convex shapes — circles, L-
   shapes, T-shapes all produce valid deck meshes that exactly match the
   parapet's outline.

   UV mapping is re-computed as planar world-space coordinates scaled by
   plank width so the wood pattern is continuous across the deck
   regardless of shape. Ceramic/concrete variants still fall through to
   the wood spec in 3.5b. */

import {
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Shape,
  ShapeGeometry,
  type Texture,
  type WebGLRenderer,
} from "three";
import { DECK, PBR_BY_TAG } from "../constants";
import { loadPBRTextures } from "../texture-loader";
import type { DeckMaterial, MaterialQuality, RoofFootprint } from "../types";

export interface BuildDeckParams {
  footprint: RoofFootprint;
  deckMaterial: DeckMaterial;
  quality: MaterialQuality;
  renderer: WebGLRenderer;
}

export async function buildDeck({
  footprint,
  deckMaterial,
  quality,
  renderer,
}: BuildDeckParams): Promise<Mesh> {
  const spec = PBR_BY_TAG["floor-slab"];
  if (!spec) {
    throw new Error("deck-builder: floor-slab PBR spec missing from catalog");
  }

  const textures = await loadPBRTextures(spec, quality, renderer);

  /* Build the Shape in 2D.

     World (worldX, worldZ) maps to Shape (shapeX = worldX, shapeY = -worldZ).
     After `geo.rotateX(-π/2)`:
       - local +X stays world +X
       - local +Y rotates to world -Z
       - local +Z (the default ShapeGeometry normal) rotates to world +Y
     So a vertex authored at shape (worldX, -worldZ, 0) lands at world
     (worldX, 0, -(-worldZ)) = (worldX, 0, worldZ). And the deck normal
     points +Y — faces up.

     Negating Y flips the winding, so the CCW world polygon becomes CW in
     shape space. We reverse the vertex order to restore CCW — Three.js's
     shape triangulator expects CCW outer contours. */
  const flipped = footprint.vertices.map((v) => ({ x: v.x, y: -v.y }));
  const shapeVerts = flipped.slice().reverse();

  const shape = new Shape();
  shape.moveTo(shapeVerts[0].x, shapeVerts[0].y);
  for (let i = 1; i < shapeVerts.length; i++) {
    shape.lineTo(shapeVerts[i].x, shapeVerts[i].y);
  }
  shape.closePath();

  const geo = new ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);

  /* Planar UV mapping in world XZ, scaled to target plank width. Running
     U along the longer AABB axis keeps plank grain parallel to the
     building's longest dimension — the same heuristic 3.5a used. */
  computePlanarDeckUVs(geo, footprint.longerAxis, spec.tilingMetres);

  const map = cloneTexture(textures.map);
  const normalMap = cloneTexture(textures.normalMap);
  const roughnessMap = cloneTexture(textures.roughnessMap);
  const aoMap = textures.aoMap ? cloneTexture(textures.aoMap) : undefined;

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

  const mesh = new Mesh(geo, material);
  mesh.position.y = footprint.topY + DECK.elevationAboveSlabM;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "enhance-tier3-deck";
  return mesh;
}

function cloneTexture(source: Texture): Texture {
  const t = source.clone();
  /* The deck authors its own UVs in world units, so texture.repeat stays
     at (1, 1) — we bake the tiling into the UVs instead. */
  t.repeat.set(1, 1);
  t.needsUpdate = true;
  return t;
}

/**
 * Compute planar world-space UVs over the deck geometry so every wood
 * plank is `DECK.plankWidthM` wide and `spec.tilingMetres` long in the
 * perpendicular direction, regardless of polygon shape.
 *
 * After `rotateX(-π/2)`, the geometry's position attribute stores world
 * X in the X slot, world Z in the Z slot, and Y ≈ 0 in the Y slot.
 * UVs are authored directly from those XZ components.
 */
function computePlanarDeckUVs(
  geo: ShapeGeometry,
  longerAxis: "x" | "z",
  textureTileMetres: number,
): void {
  const positions = geo.getAttribute("position");
  if (!positions) return;
  const count = positions.count;
  const uvs = new Float32Array(count * 2);

  const uScale = 1 / DECK.plankWidthM;
  const vScale = 1 / textureTileMetres;

  for (let i = 0; i < count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    if (longerAxis === "x") {
      uvs[i * 2] = x * uScale;
      uvs[i * 2 + 1] = z * vScale;
    } else {
      uvs[i * 2] = z * uScale;
      uvs[i * 2 + 1] = x * vScale;
    }
  }
  geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
}
