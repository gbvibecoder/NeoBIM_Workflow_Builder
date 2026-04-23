/* ─── IFC Enhance — Tier 4 window frame builder ──────────────────────────
   Phase 4a hotfix: the builder now operates on *window elements*, not
   individual sub-meshes. An IFC window is a single expressID that may
   decompose into many Mesh instances (glass + 4 frame members + mullions
   in a single IfcWindow). We combine every sub-mesh of a window when we
   compute AABB + outward normal, then build ONE frame per window — fixing
   the "36 windows shown as 144" banner bug and making the visual output
   coherent (no nested frames on a window that already has its own).

   Outward-axis detection is geometry-based and now gated by a cardinal-
   alignment threshold (`WINDOW_FRAME.minCardinalAlignment`). Windows whose
   normals don't snap cleanly to ±X or ±Z (e.g. the tangential windows on
   a circular-tower facade) are silently skipped — no frame is better than
   a scaffolding-like wrong-axis frame in front of a curtain wall. The
   sign is still picked by the building-centre heuristic (outward points
   from the building centre to the window centre) so the two faces of a
   thin panel don't cancel in a naive cardinal vote. The same helper is
   reused by `window-sill-builder`. */

import {
  type BufferAttribute,
  BoxGeometry,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
} from "three";
import { WINDOW_FRAME } from "../constants";
import type { WindowFrameColor } from "../types";

/** A window as the classifier sees it — one expressID, one-or-more Mesh. */
export interface WindowElement {
  expressID: number;
  meshes: Mesh[];
}

/** Per-window geometry summary used by both frame + sill builders. */
export interface WindowMetrics {
  /** AABB centre (combined across all sub-meshes) in world space. */
  center: Vector3;
  /** AABB min in world space. */
  min: Vector3;
  /** AABB max in world space. */
  max: Vector3;
  /** Window width — extent along `tangent`. */
  widthM: number;
  /** Window height — extent along world Y. */
  heightM: number;
  /** Unit outward normal in the XZ plane (y always 0). */
  outward: Vector3;
  /** Unit tangent in the XZ plane perpendicular to `outward`. */
  tangent: Vector3;
  /** Signed distance from `center` along `outward` to the glass plane. */
  glassHalfThicknessM: number;
}

export interface WindowFrameResult {
  group: Group;
  /** Number of distinct window ELEMENTS that received a frame (not sub-meshes). */
  count: number;
}

/**
 * Build frames for every eligible window element. Returns a single Group
 * that should be added under the tier-4 root.
 */
export function buildWindowFrames(
  windows: WindowElement[],
  color: WindowFrameColor,
  buildingCenter: Vector2,
): WindowFrameResult {
  const group = new Group();
  group.name = "enhance-tier4-window-frames";

  if (windows.length === 0) return { group, count: 0 };

  const material = buildFrameMaterial(color);

  let count = 0;
  for (const win of windows) {
    const metrics = computeWindowMetrics(win.meshes, buildingCenter);
    if (!metrics) continue;
    const frame = buildFrameForWindow(metrics, material);
    frame.name = `enhance-tier4-window-frame-${win.expressID}`;
    group.add(frame);
    count += 1;
  }

  return { group, count };
}

/* ─── Shared helper: window metrics (AABB + outward normal) ─────────── */

/**
 * Compute combined AABB + outward normal for one window element. Returns
 * null when:
 *   - no sub-mesh has geometry data, OR
 *   - the combined normals are mostly vertical (skylight / unusual
 *     modelling), OR
 *   - the dominant horizontal axis alignment falls below
 *     `WINDOW_FRAME.minCardinalAlignment` (non-cardinal window).
 */
export function computeWindowMetrics(
  meshes: Mesh[],
  buildingCenter: Vector2,
): WindowMetrics | null {
  if (meshes.length === 0) return null;

  /* Combined AABB across all sub-meshes. */
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const tmp = new Vector3();
  let sampleCount = 0;
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.getAttribute("position") as BufferAttribute | undefined;
    if (!pos || pos.count === 0) continue;
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (tmp.x < min.x) min.x = tmp.x;
      if (tmp.y < min.y) min.y = tmp.y;
      if (tmp.z < min.z) min.z = tmp.z;
      if (tmp.x > max.x) max.x = tmp.x;
      if (tmp.y > max.y) max.y = tmp.y;
      if (tmp.z > max.z) max.z = tmp.z;
      sampleCount += 1;
    }
  }
  if (sampleCount === 0) {
    // eslint-disable-next-line no-console
    console.warn("[tier4] window skipped — no position data across sub-meshes");
    return null;
  }

  /* Axis-vote from combined triangle normals. */
  const axisResult = dominantHorizontalAxis(meshes);
  if (!axisResult) {
    // eslint-disable-next-line no-console
    console.warn("[tier4] window skipped — degenerate or non-cardinal normals");
    return null;
  }
  const axis = axisResult;

  const center = new Vector3(
    (min.x + max.x) / 2,
    (min.y + max.y) / 2,
    (min.z + max.z) / 2,
  );

  /* Sign decision — outward points away from the building centre. */
  let outward: Vector3;
  let tangent: Vector3;
  let widthM: number;
  if (axis === "x") {
    const sign = center.x >= buildingCenter.x ? 1 : -1;
    outward = new Vector3(sign, 0, 0);
    tangent = new Vector3(0, 0, 1);
    widthM = max.z - min.z;
  } else {
    const sign = center.z >= buildingCenter.y ? 1 : -1;
    outward = new Vector3(0, 0, sign);
    tangent = new Vector3(1, 0, 0);
    widthM = max.x - min.x;
  }
  const heightM = max.y - min.y;
  if (widthM < 1e-4 || heightM < 1e-4) {
    // eslint-disable-next-line no-console
    console.warn("[tier4] window skipped — degenerate bounds");
    return null;
  }

  const glassHalfThicknessM =
    axis === "x" ? (max.x - min.x) / 2 : (max.z - min.z) / 2;

  return {
    center,
    min,
    max,
    widthM,
    heightM,
    outward,
    tangent,
    glassHalfThicknessM,
  };
}

/* ─── Frame construction per window ──────────────────────────────── */

function buildFrameForWindow(
  metrics: WindowMetrics,
  material: MeshStandardMaterial,
): Group {
  const group = new Group();
  const { widthM: W, heightM: H, center, outward, tangent } = metrics;
  const memberW = WINDOW_FRAME.widthM;   // on-wall face thickness
  const depth = WINDOW_FRAME.depthM;     // outward-axis thickness

  /* Centre of frame along outward axis: glass + protrusion, pulled back by
     half the depth so the outward face sits `protrusionM` past the glass
     plane and the inward face `depth - protrusionM` behind it. */
  const outwardOffset =
    metrics.glassHalfThicknessM + WINDOW_FRAME.protrusionM - depth / 2;

  /* Rotation from window-local (X=tangent, Y=up, Z=outward) to world. */
  const up = new Vector3(0, 1, 0);
  const rotMatrix = new Matrix4().makeBasis(tangent, up, outward);
  const rotQuat = new Quaternion().setFromRotationMatrix(rotMatrix);

  /* Local-to-world placement helper. */
  const place = (localU: number, localV: number, localW: number): Vector3 =>
    new Vector3(
      center.x + tangent.x * localU + up.x * localV + outward.x * localW,
      center.y + tangent.y * localU + up.y * localV + outward.y * localW,
      center.z + tangent.z * localU + up.z * localV + outward.z * localW,
    );

  const addMember = (
    uSize: number,
    vSize: number,
    uOff: number,
    vOff: number,
    tag: string,
  ): void => {
    const geo = new BoxGeometry(uSize, vSize, depth);
    const m = new Mesh(geo, material);
    m.position.copy(place(uOff, vOff, outwardOffset));
    m.quaternion.copy(rotQuat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = tag;
    group.add(m);
  };

  addMember(W + 2 * memberW, memberW, 0, H / 2 + memberW / 2, "frame-top");
  addMember(W + 2 * memberW, memberW, 0, -(H / 2 + memberW / 2), "frame-bottom");
  addMember(memberW, H, -(W / 2 + memberW / 2), 0, "frame-left");
  addMember(memberW, H, W / 2 + memberW / 2, 0, "frame-right");

  if (W > WINDOW_FRAME.mullionWidthThresholdM) {
    addMember(memberW, H, 0, 0, "frame-mullion");
  }
  if (H > WINDOW_FRAME.transomHeightThresholdM) {
    addMember(W, memberW, 0, 0, "frame-transom");
  }

  return group;
}

/* ─── Shared helper: outward axis from geometry normals ─────────── */

/**
 * Pool triangle normals across every sub-mesh of the window element,
 * project each horizontal normal onto ±X / ±Z, and return the dominant
 * axis. Returns null when:
 *   - > 60% of sampled normals are vertical (skylight, unusual shape)
 *   - dominant-axis weight share < `WINDOW_FRAME.minCardinalAlignment`
 *     (e.g. a window on a curved facade facing NE, NW, …)
 */
function dominantHorizontalAxis(meshes: Mesh[]): "x" | "z" | null {
  let xWeight = 0;
  let zWeight = 0;
  let verticalCount = 0;
  let total = 0;
  const n = new Vector3();

  for (const mesh of meshes) {
    const geom = mesh.geometry;
    const normalAttr = geom.getAttribute("normal") as BufferAttribute | undefined;
    const position = geom.getAttribute("position") as BufferAttribute | undefined;
    if (!position) continue;

    const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);

    if (normalAttr) {
      const count = normalAttr.count;
      for (let i = 0; i < count; i++) {
        n.fromBufferAttribute(normalAttr, i).applyMatrix3(normalMatrix).normalize();
        total += 1;
        if (Math.abs(n.y) > 0.85) {
          verticalCount += 1;
          continue;
        }
        xWeight += Math.abs(n.x);
        zWeight += Math.abs(n.z);
      }
    } else {
      /* Stripped geometry — derive normals from triangle cross products. */
      const index = geom.getIndex();
      const triCount = index ? index.count / 3 : position.count / 3;
      const a = new Vector3();
      const b = new Vector3();
      const c = new Vector3();
      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index.getX(t * 3 + 0) : t * 3 + 0;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(position, i0).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(position, i1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(position, i2).applyMatrix4(mesh.matrixWorld);
        const e1 = b.clone().sub(a);
        const e2 = c.clone().sub(a);
        n.copy(e1).cross(e2);
        const mag = n.length();
        if (mag < 1e-9) continue;
        n.multiplyScalar(1 / mag);
        total += 1;
        if (Math.abs(n.y) > 0.85) {
          verticalCount += 1;
          continue;
        }
        xWeight += Math.abs(n.x);
        zWeight += Math.abs(n.z);
      }
    }
  }

  if (total === 0) return null;
  if (verticalCount / total > 0.6) return null;

  const horizTotal = xWeight + zWeight;
  if (horizTotal < 1e-6) return null;

  const dominantWeight = Math.max(xWeight, zWeight);
  const alignment = dominantWeight / horizTotal;
  if (alignment < WINDOW_FRAME.minCardinalAlignment) return null;

  return xWeight >= zWeight ? "x" : "z";
}

function buildFrameMaterial(color: WindowFrameColor): MeshStandardMaterial {
  const spec = WINDOW_FRAME.colors[color];
  const mat = new MeshStandardMaterial({
    color: spec.color,
    metalness: spec.metalness,
    roughness: spec.roughness,
    envMapIntensity: 1.0,
  });
  mat.name = `enhance-tier4-window-frame-${color}`;
  return mat;
}
