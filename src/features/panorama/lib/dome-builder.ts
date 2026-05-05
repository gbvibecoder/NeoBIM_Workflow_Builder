/* ─── Panorama feature — dome builder ──────────────────────────────────────
   Builds the upper-hemisphere dome that wraps the panorama's sky /
   ceiling. Pairs with the ground disc; together they form a Twinmotion-
   style backdrop that the BIM model occludes.

   ── UV remapping ──
   Three.js `SphereGeometry` produces UVs as `(u, 1 - v)` where
   `v = iy / heightSegments`. With `(thetaStart=0, thetaLength=π/2 + ε)`:
     · top pole (iy = 0)         → v = 0 → uv.y = 1
     · bottom ring (iy = N)      → v = 1 → uv.y = 0
   so dome `uv.y_geom ∈ [0, 1]` (NOT [0.5, 1] as a casual reader might
   guess). With `texture.flipY = true` (TextureLoader default) the
   image's horizon row maps to `uv.y_tex = 1 - h`. We want:
     · top pole (uv.y_geom = 1) → top of image (uv.y_tex = 1)
     · equator (uv.y_geom = 0)  → horizon (uv.y_tex = 1 − h)
   Linear remap: `uv.y_tex = (1 − h) + uv.y_geom × h`.

   ── Horizon overlap ──
   `thetaLength` is `π/2 + HORIZON_OVERLAP_RAD` (≈6° past equator). The
   small lip carries the texture's horizon row into a screen region the
   disc's alpha-fade ring also covers, producing a soft seam blend
   instead of a hard line. */

import {
  BackSide,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Material,
  type Texture,
} from "three";

const SPHERE_WIDTH_SEGMENTS = 64;
const SPHERE_HEIGHT_SEGMENTS = 32;
const HORIZON_OVERLAP_RAD = 0.1;

/**
 * Build an upper-hemisphere dome mesh that shows texture rows
 * [0..horizonRow] of the panorama.
 *
 * @param texture    Equirectangular panorama texture (loader-managed).
 * @param position   World position of the dome centre.
 * @param radius     Dome radius (matches disc radius for seamless horizon).
 * @param horizonRow Fraction of the image (0..1) where the visible
 *                   horizon line sits. Clamped to [0.01, 0.99].
 */
export function buildDome(
  texture: Texture,
  position: Vector3,
  radius: number,
  horizonRow: number,
): Mesh {
  const geometry = new SphereGeometry(
    radius,
    SPHERE_WIDTH_SEGMENTS,
    SPHERE_HEIGHT_SEGMENTS,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2 + HORIZON_OVERLAP_RAD,
  );

  const h = clamp01(horizonRow);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setY(i, (1 - h) + uv.getY(i) * h);
  }
  uv.needsUpdate = true;

  const material = new MeshBasicMaterial({
    map: texture,
    side: BackSide,        /* viewed from inside */
    depthWrite: false,     /* doesn't pollute depth buffer */
    toneMapped: false,     /* panorama already tonemapped on disk */
    transparent: true,     /* lets the disc's alpha-fade composite cleanly */
  });

  const mesh = new Mesh(geometry, material);
  mesh.position.copy(position);
  /* renderOrder = -2 → renders before the disc (-1) and the model (0).
     Combined with depthWrite=false, the model wins every depth test. */
  mesh.renderOrder = -2;
  mesh.name = "panorama-dome";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  /* Belt-and-braces: no-op raycast so the dome can never be picked. */
  mesh.raycast = () => {};
  return mesh;
}

/**
 * Dispose a dome mesh's geometry + material. Does NOT dispose the
 * texture — that is reference-counted by the panorama loader.
 */
export function disposeDome(mesh: Mesh): void {
  mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) {
    for (const m of mesh.material) (m as Material).dispose();
  } else {
    (mesh.material as Material).dispose();
  }
}

function clamp01(v: number): number {
  return Math.min(0.99, Math.max(0.01, v));
}
