/* ─── IFC Enhance — Tier 4 window sill builder ───────────────────────────
   Phase 4a hotfix: operate on WINDOW ELEMENTS (grouped by expressID), not
   individual sub-meshes — mirrors the frame builder so the sill count and
   the frame count line up. Each window element gets one sill, placed under
   the combined AABB of its sub-meshes.

   Skip logic: `computeWindowMetrics` returns null on degenerate or
   non-cardinal windows, so this builder inherits Fix #2 — non-cardinal
   windows on curved facades are silently skipped, no sill built. */

import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
} from "three";
import { WINDOW_SILL } from "../constants";
import {
  computeWindowMetrics,
  type WindowElement,
  type WindowMetrics,
} from "./window-frame-builder";

export interface WindowSillResult {
  group: Group;
  /** Number of distinct window ELEMENTS that received a sill. */
  count: number;
}

export function buildWindowSills(
  windows: WindowElement[],
  buildingCenter: Vector2,
): WindowSillResult {
  const group = new Group();
  group.name = "enhance-tier4-window-sills";

  if (windows.length === 0) return { group, count: 0 };

  const material = buildSillMaterial();
  let count = 0;

  for (const win of windows) {
    const metrics = computeWindowMetrics(win.meshes, buildingCenter);
    if (!metrics) continue;
    const sill = buildSillForWindow(metrics, material);
    sill.name = `enhance-tier4-window-sill-${win.expressID}`;
    group.add(sill);
    count += 1;
  }

  return { group, count };
}

function buildSillForWindow(
  metrics: WindowMetrics,
  material: MeshStandardMaterial,
): Mesh {
  const { widthM: W, center, outward, tangent, glassHalfThicknessM } = metrics;
  const { heightM, depthM, belowFrameM, overhangM } = WINDOW_SILL;

  /* Sill dimensions in window-local (u = tangent, v = up, w = outward). */
  const uSize = W + 2 * overhangM;
  const vSize = heightM;
  const wSize = depthM;

  /* Sill top aligns with the bottom of the window minus `belowFrameM`.
     Vertical centre = windowBottom - belowFrameM - heightM/2. */
  const vOffset = -(metrics.heightM / 2) - belowFrameM - heightM / 2;

  /* Along outward: sill centre sits `depthM/2 - 0.01` past the glass
     plane — inward face hugs the wall, outward face projects outward. */
  const wOffset = glassHalfThicknessM + depthM / 2 - 0.01;

  const up = new Vector3(0, 1, 0);
  const rotMat = new Matrix4().makeBasis(tangent, up, outward);
  const rotQuat = new Quaternion().setFromRotationMatrix(rotMat);

  const worldPos = new Vector3(
    center.x + up.x * vOffset + outward.x * wOffset,
    center.y + up.y * vOffset + outward.y * wOffset,
    center.z + up.z * vOffset + outward.z * wOffset,
  );

  const geo = new BoxGeometry(uSize, vSize, wSize);
  const mesh = new Mesh(geo, material);
  mesh.position.copy(worldPos);
  mesh.quaternion.copy(rotQuat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildSillMaterial(): MeshStandardMaterial {
  const spec = WINDOW_SILL.material;
  const mat = new MeshStandardMaterial({
    color: spec.color,
    metalness: spec.metalness,
    roughness: spec.roughness,
    envMapIntensity: 1.0,
  });
  mat.name = "enhance-tier4-window-sill";
  return mat;
}
