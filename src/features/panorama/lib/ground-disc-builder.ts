/* ─── Panorama feature — ground disc builder ───────────────────────────────
   Builds the flat horizontal disc that holds the panorama's lower
   hemisphere as a projected ground texture. Pairs with the dome to form
   a Twinmotion-style backdrop the BIM model occludes.

   ── UV polar mapping ──
   The disc lies in the world XZ plane at `position.y`. For each vertex
   at `(x, _, z)`:
     · `r = √(x² + z²)`, `normR = r / radius`     ∈ [0, 1]
     · `angle = atan2(z, x)`                       ∈ [-π, π]
     · `u = ((angle / 2π + 0.5) − 0.5 + anchorU) mod 1`
     · `v = normR × (1 − horizonRow)`
   So the disc centre samples the image's nadir (uv.y_tex = 0) and the
   edge samples the horizon (uv.y_tex = 1 − horizonRow), meeting the
   dome at the seam.

   `anchorU` (= `groundAnchorPixelXY.x`) rotates the longitude so the
   panorama's "front" lines up with the camera's forward axis. The
   polar projection unavoidably stretches concentric rings, so per-asset
   manual nudging is the calibration workflow.

   ── Three-zone alpha ramp ──
     · `r < innerRadius`             → α = 0   (transparent core hides the
                                                polar-UV swirl; the BIM
                                                covers the disc centre)
     · `innerRadius ≤ r ≤ R(1 − f)`  → α = 1   (opaque ground)
     · `r > R(1 − f)`                → α = 1 − (r − R(1−f)) / (R·f)
                                                (linear fade to 0 at the rim
                                                 — meets the dome's overlap
                                                 lip in screen space for a
                                                 soft horizon blend)

   The alpha attribute is wired into `MeshBasicMaterial` via
   `onBeforeCompile`, reading it as `varying float vAlpha` and
   multiplying `gl_FragColor.a` after `<opaque_fragment>`. We use
   `<opaque_fragment>` and `<fog_vertex>` because they are stable
   chunk-include points in three.js 0.183 (the version pinned here).

   ── Why RingGeometry, not CircleGeometry ──
   `CircleGeometry` produces only 1 centre vertex + N rim vertices. The
   per-vertex alpha ramp degenerated there because no vertices existed
   between centre and rim. `RingGeometry(0, R, theta, phi)` with phi=16
   gives 17 concentric rings, enough resolution for the alpha gradient. */

import {
  BufferAttribute,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
  type Material,
  type Texture,
} from "three";

const DISC_THETA_SEGMENTS = 128;
const DISC_PHI_SEGMENTS = 16;
const OUTER_FADE_FRACTION = 0.10;

/**
 * Build a flat ground disc that shows texture rows [horizonRow..1]
 * via polar projection.
 *
 * @param texture              Equirectangular panorama texture.
 * @param position             World position of the disc centre.
 * @param radius               Disc radius (matches dome for seamless horizon).
 * @param innerRadius          Inner radius (m) within which the disc is
 *                             transparent. Pass 0 to disable.
 * @param horizonRow           Fraction of the image (0..1) where the
 *                             visible horizon line sits.
 * @param groundAnchorPixelXY  Per-asset pixel coord of the panorama's
 *                             "front". `.x` rotates the disc longitude.
 */
export function buildGroundDisc(
  texture: Texture,
  position: Vector3,
  radius: number,
  innerRadius: number,
  horizonRow: number,
  groundAnchorPixelXY: { x: number; y: number },
): Mesh {
  const geometry = new RingGeometry(
    0,
    radius,
    DISC_THETA_SEGMENTS,
    DISC_PHI_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);

  const h = clamp01(horizonRow);
  const anchorU = groundAnchorPixelXY.x;
  const fadeStart = radius * (1 - OUTER_FADE_FRACTION);
  const fadeBand = radius - fadeStart;
  /* Cap the inner radius at fadeStart so the opaque band always exists. */
  const inner = Math.max(0, Math.min(innerRadius, fadeStart));

  const uv = geometry.attributes.uv;
  const pos = geometry.attributes.position;
  const alphas = new Float32Array(pos.count);

  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.sqrt(x * x + z * z);
    const normR = Math.min(1, r / radius);

    /* Three-zone alpha ramp. */
    if (r < inner) {
      alphas[i] = 0;
    } else if (r > fadeStart) {
      alphas[i] = Math.max(0, 1 - (r - fadeStart) / fadeBand);
    } else {
      alphas[i] = 1;
    }

    /* Polar UV. atan2 → [-π, π]; normalise to [0, 1] then offset by the
       panorama's "front" anchor U so the open-ground patch lines up
       with the camera forward direction. Modulo wraps negatives. */
    const longitude = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
    let u = (longitude - 0.5) + anchorU;
    u = u - Math.floor(u);
    uv.setX(i, u);
    uv.setY(i, normR * (1 - h));
  }
  uv.needsUpdate = true;
  geometry.setAttribute("alpha", new BufferAttribute(alphas, 1));

  const material = new MeshBasicMaterial({
    map: texture,
    side: DoubleSide,
    /* depthWrite=false so the dome's overlap lip isn't culled behind
       fading disc edges. The model still occludes the disc through
       renderOrder + the model's own depthWrite. */
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });

  /* Per-vertex alpha via shader-chunk injection. Stable hook points in
     three.js 0.183: `<fog_vertex>` (last include in vertex main) and
     `<opaque_fragment>` (sets gl_FragColor before dithering). */
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "attribute float alpha;\nvarying float vAlpha;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      "#include <fog_vertex>\nvAlpha = alpha;",
    );
    shader.fragmentShader =
      "varying float vAlpha;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      "#include <opaque_fragment>\ngl_FragColor.a *= vAlpha;",
    );
  };

  const mesh = new Mesh(geometry, material);
  mesh.position.copy(position);
  /* renderOrder = -1 → renders after the dome (-2), before the model (0). */
  mesh.renderOrder = -1;
  mesh.name = "panorama-disc";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return mesh;
}

/**
 * Dispose a disc mesh's geometry + material. Does NOT dispose the
 * texture — that is reference-counted by the panorama loader.
 */
export function disposeGroundDisc(mesh: Mesh): void {
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
