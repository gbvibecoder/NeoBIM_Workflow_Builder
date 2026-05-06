/* ─── Panorama feature — anchor maths ──────────────────────────────────────
   Pure-function module computing world-space placements for the
   dome-plus-disc compositing.

   · Disc + dome are anchored at `(0, bbox.min.y, 0)` so the disc surface
     is flush with the BIM model's bottom face. No slab heuristic — the
     BIM bbox is the source of truth.
   · Radius is `DEFAULT_DOME_RADIUS_M × asset.panoramaScale` (default 50 m).
     Per-asset scale is the lever for "panorama features feel too big /
     too small" tuning.
   · BIM stays at world origin by default. `asset.bimOffsetXZ` pushes it
     off the disc centre on the XZ plane so the photographer's standpoint
     ends up in front of the BIM (e.g., "BIM on a curb with road in
     front of it"). */

import { Box3, Vector3 } from "three";
import type { PanoramaAsset } from "../constants";

/** Base radius (metres) for both dome and disc. Per-asset
 *  `panoramaScale` multiplies into this. */
export const DEFAULT_DOME_RADIUS_M = 50;
export const DEFAULT_DISC_RADIUS_M = 50;
/** Inner ring (metres) where the disc renders fully transparent. Hides
 *  the polar-UV swirl artefact at the disc centre — the BIM model
 *  itself sits over the centre and covers any leakage. */
export const DISC_INNER_RADIUS_M = 5;

export interface PanoramaAnchor {
  /** World-space centre of the dome mesh. */
  domePosition: Vector3;
  /** Dome radius in metres. */
  domeRadius: number;
  /** World-space centre of the ground disc mesh. */
  discPosition: Vector3;
  /** Disc radius in metres. */
  discRadius: number;
  /** Radius inside which the disc renders fully transparent. */
  discInnerRadius: number;
  /** World-space target the BIM model is translated to. Origin by
   *  default; offset by `asset.bimOffsetXZ` when set. */
  bimAnchorPosition: Vector3;
}

/**
 * Compute placement for the dome + disc + BIM.
 *
 * Pure: returns a fresh anchor each call, mutates nothing.
 *
 * @param asset      Selected panorama. Reads `panoramaScale` and `bimOffsetXZ`.
 * @param modelBbox  World-space AABB of the loaded BIM. Disc Y = `bbox.min.y`.
 *                   Pass `null` if unavailable; falls back to Y = 0.
 */
export function computePanoramaAnchor(
  asset: PanoramaAsset,
  modelBbox: Box3 | null,
): PanoramaAnchor {
  const groundY =
    modelBbox && !modelBbox.isEmpty() ? modelBbox.min.y : 0;
  const scale = Math.max(0.01, asset.panoramaScale ?? 1.0);
  const radius = DEFAULT_DOME_RADIUS_M * scale;
  const offX = asset.bimOffsetXZ?.x ?? 0;
  const offZ = asset.bimOffsetXZ?.z ?? 0;

  return {
    domePosition: new Vector3(0, groundY, 0),
    domeRadius: radius,
    discPosition: new Vector3(0, groundY, 0),
    discRadius: radius,
    discInnerRadius: DISC_INNER_RADIUS_M,
    bimAnchorPosition: new Vector3(offX, 0, offZ),
  };
}
