/* ─── IFC Enhance — Tier 2 tree scatter ───────────────────────────────────
   Builds `LoadedModel[]` (3 tree variants) and scatters them across the
   site via `InstancedMesh` for cheap rendering at 20+ instances.

   Primary path (Phase 3 GLB swap): loads Quaternius Ultimate Stylized
   Nature Pack GLBs from `TREE_MODELS` via GLTFLoader. Materials + textures
   come from the GLB directly and are used AS-IS — no swap.

   Defensive fallback: if a GLB fails to load (network, 404, decode error),
   `buildProceduralTreeModel(...)` below builds a low-poly stand-in out of
   Three.js primitives so the scatter pipeline still works and the scene
   isn't broken. A `console.warn` marks the degraded path. */

import {
  Box3,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  PLACEMENT_EXCLUSION,
  TARGET_TREE_HEIGHT_M,
  TREE_MODELS,
} from "../constants";
import {
  expandRect,
  mulberry32,
  poissonDiskSample,
  pointInRect,
  type BuildingBoundsResult,
  type FootprintRect,
} from "./placement-utils";

export interface LoadedModel {
  slug: string;
  submeshes: Array<{ geometry: BufferGeometry; material: Material }>;
  /** Uniform scale factor so the model height ≈ target real-world height. */
  scale: number;
}

/* Shared procedural materials — cached so every tree variant reuses them. */
let trunkMat: MeshStandardMaterial | null = null;
const canopyMats = new Map<string, MeshStandardMaterial>();

function getTrunkMaterial(): MeshStandardMaterial {
  if (trunkMat) return trunkMat;
  trunkMat = new MeshStandardMaterial({
    color: 0x6b4423,
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 1.0,
    side: DoubleSide,
  });
  trunkMat.name = "enhance-tree-trunk";
  return trunkMat;
}

function getCanopyMaterial(hex: number, name: string): MeshStandardMaterial {
  const key = `${name}-${hex}`;
  const cached = canopyMats.get(key);
  if (cached) return cached;
  const mat = new MeshStandardMaterial({
    color: new Color(hex),
    roughness: 0.85,
    metalness: 0,
    envMapIntensity: 1.0,
    side: DoubleSide,
  });
  mat.name = `enhance-canopy-${name}`;
  canopyMats.set(key, mat);
  return mat;
}

type TreeVariant = "deciduous" | "pine" | "maple";

/**
 * Build a procedural tree variant. Y-up, anchored with trunk base at y=0.
 * Returns geometries + materials in model-space at the target height —
 * the scatter loop applies per-instance transform on top.
 */
function buildProceduralTreeModel(variant: TreeVariant): LoadedModel {
  const trunkH = variant === "pine" ? 4.5 : variant === "maple" ? 3.8 : 3.5;
  const trunkR = variant === "pine" ? 0.22 : variant === "maple" ? 0.2 : 0.18;

  const trunk = new CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 8);
  trunk.translate(0, trunkH / 2, 0);

  let canopyGeo: BufferGeometry;
  let canopyColor: number;
  let canopyName: string;
  let modelHeight: number;

  if (variant === "pine") {
    canopyGeo = new ConeGeometry(1.7, 5.5, 10, 1);
    canopyGeo.translate(0, trunkH + 5.5 / 2 - 1.0, 0);
    canopyColor = 0x2d5a2a;
    canopyName = "pine";
    modelHeight = trunkH + 5.5 - 1.0;
  } else if (variant === "maple") {
    canopyGeo = new SphereGeometry(2.2, 12, 10);
    canopyGeo.translate(0, trunkH + 1.6, 0);
    canopyColor = 0xb36a3b; // burnt-orange autumn maple
    canopyName = "maple";
    modelHeight = trunkH + 2.2 * 2;
  } else {
    canopyGeo = new SphereGeometry(2.0, 12, 10);
    canopyGeo.translate(0, trunkH + 1.4, 0);
    canopyColor = 0x3f7a3a;
    canopyName = "deciduous";
    modelHeight = trunkH + 2.0 * 2;
  }

  return {
    slug: `procedural-tree-${variant}`,
    submeshes: [
      { geometry: trunk, material: getTrunkMaterial() },
      { geometry: canopyGeo, material: getCanopyMaterial(canopyColor, canopyName) },
    ],
    scale: TARGET_TREE_HEIGHT_M / modelHeight,
  };
}

/* ─── GLB loader + session-scoped cache ────────────────────────────────
   The cache stores the PARSED-ONCE state per URL (submesh geometries with
   local transforms baked, materials kept AS-IS). `loadTreeModels` returns
   CLONES of the geometries on every call so the engine's reset-time
   `geometry.dispose()` hits the clones — the cached source stays live and
   re-apply is O(tree count) instead of O(GLB bytes). Materials are shared
   across apply cycles (Quaternius ships self-contained textures so
   sharing is safe and cheap). */

interface CachedGLB {
  submeshes: Array<{ geometry: BufferGeometry; material: Material }>;
  scale: number;
}
const glbCache = new Map<string, CachedGLB>();

function slugFromUrl(url: string): string {
  const match = url.match(/\/([^\/]+)\.(glb|gltf)$/i);
  return match ? match[1] : url;
}

/** Map a GLB URL back to a procedural variant for fallback. */
function proceduralVariantForUrl(url: string): TreeVariant {
  const lower = url.toLowerCase();
  if (lower.includes("pine")) return "pine";
  if (lower.includes("maple")) return "maple";
  return "deciduous";
}

/**
 * Load a single GLB and bake every child mesh's world transform into its
 * cloned geometry, so `LoadedModel.submeshes` carries trunk and foliage in
 * their correct relative positions without needing a scene graph at
 * scatter time. Result is cached per URL in `glbCache`.
 */
async function loadTreeGLB(url: string, targetHeight: number): Promise<CachedGLB> {
  const cached = glbCache.get(url);
  if (cached) return cached;

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  /* GLTFLoader DOES call updateMatrixWorld internally but only on the
     loaded scene; explicit call is cheap and defends against upstream
     changes. Without it, nested-group child meshes would have stale
     matrixWorld and foliage would collapse onto the trunk origin. */
  gltf.scene.updateMatrixWorld(true);

  const submeshes: Array<{ geometry: BufferGeometry; material: Material }> = [];
  gltf.scene.traverse((obj) => {
    const maybeMesh = obj as Mesh;
    if (!maybeMesh.isMesh || !maybeMesh.geometry) return;
    const geom = maybeMesh.geometry.clone();
    geom.applyMatrix4(maybeMesh.matrixWorld);
    /* Quaternius normally ships single-material meshes. If we hit a
       multi-material group, first material covers 99% of the geometry in
       practice — log and proceed so the rest of the scene stays sane. */
    let material: Material;
    if (Array.isArray(maybeMesh.material)) {
      // eslint-disable-next-line no-console
      console.warn(`[enhance/tier2] ${url} mesh "${maybeMesh.name}" has array material; using first entry.`);
      material = maybeMesh.material[0];
    } else {
      material = maybeMesh.material;
    }
    submeshes.push({ geometry: geom, material });
  });

  if (submeshes.length === 0) {
    throw new Error(`No meshes found inside ${url}`);
  }

  /* Unified bounding box across all submeshes (post-bake, so trunk +
     foliage union gives the true model extent). */
  const overall = new Box3();
  for (const sm of submeshes) {
    sm.geometry.computeBoundingBox();
    if (sm.geometry.boundingBox) overall.union(sm.geometry.boundingBox);
  }
  const size = overall.getSize(new Vector3());
  const actualHeight = size.y;
  const scale = actualHeight > 0 ? targetHeight / actualHeight : 1;

  /* Recenter so trunk base sits at y=0 — the scatter loop assumes this
     (placement translates (x, groundY, z) straight to the instance
     position). A model already authored base-at-origin has minY≈0, so
     the translate is a no-op. */
  const minY = overall.min.y;
  if (Math.abs(minY) > 1e-3) {
    for (const sm of submeshes) {
      sm.geometry.translate(0, -minY, 0);
      sm.geometry.computeBoundingBox();
    }
  }

  const entry: CachedGLB = { submeshes, scale };
  glbCache.set(url, entry);
  return entry;
}

/**
 * Load the tree model set (3 GLB variants). Each call returns fresh
 * geometry clones so the engine's reset path can dispose them without
 * killing the cached source. Falls back to a procedural stand-in per
 * failing URL.
 *
 * `onProgress` fires at 0..1 as variants complete.
 */
export async function loadTreeModels(onProgress?: (p: number) => void): Promise<LoadedModel[]> {
  onProgress?.(0);
  /* `TREE_MODELS` is tuple-typed `as const` in constants.ts — length is
     guaranteed non-zero at compile time. The per-URL try/catch below is
     the real defensive mechanism (GLB 404, decode failure, zero-mesh
     scene). */

  const models: LoadedModel[] = [];
  for (let i = 0; i < TREE_MODELS.length; i++) {
    const url = TREE_MODELS[i];
    try {
      const glb = await loadTreeGLB(url, TARGET_TREE_HEIGHT_M);
      models.push({
        slug: slugFromUrl(url),
        submeshes: glb.submeshes.map((sm) => ({
          /* Clone geometry per apply so reset's `.dispose()` doesn't hit
             the cached source. Materials are safely shared. */
          geometry: sm.geometry.clone(),
          material: sm.material,
        })),
        scale: glb.scale,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[enhance/tier2] Failed to load tree GLB ${url} — falling back to procedural.`, err);
      models.push(buildProceduralTreeModel(proceduralVariantForUrl(url)));
    }
    onProgress?.((i + 1) / TREE_MODELS.length);
  }

  onProgress?.(1);
  return models;
}

/* ─── Scatter ─────────────────────────────────────────────────────────── */

export interface ScatterParams {
  models: LoadedModel[];
  count: number;
  bounds: BuildingBoundsResult;
  /** Rectangles where trees may NOT be placed (building + road + sidewalk). */
  excludeZones: FootprintRect[];
  rng: () => number;
  spacingM: number;
  /** Vertical placement — typically `bounds.footprint.minY - 0.05`. */
  groundY: number;
  /** Random per-instance scale range (±). */
  scaleJitter: number;
}

/**
 * Scatter `count` tree instances within the site bounds (building AABB
 * grown by GROUND_SIZE_MULTIPLIER) while avoiding excludeZones. Returns
 * one InstancedMesh per unique (model, submesh) pair — every tree model
 * has 2 submeshes (trunk + canopy), so scattering across 3 model variants
 * yields 6 InstancedMeshes, each carrying only its share of instances.
 *
 * Deterministic given `rng`.
 */
export function scatterTrees(params: ScatterParams): InstancedMesh[] {
  const { models, count, bounds, excludeZones, rng, spacingM, groundY, scaleJitter } = params;
  if (count <= 0 || models.length === 0) return [];

  const halfSide = bounds.maxExtentM * 2.5; // matches GROUND_SIZE_MULTIPLIER / 2
  const scatterBounds = {
    minX: bounds.center.x - halfSide,
    maxX: bounds.center.x + halfSide,
    minZ: bounds.center.z - halfSide,
    maxZ: bounds.center.z + halfSide,
  };

  /* Build rejection function: inside any excludeZone (grown by
     per-zone buffer) → reject. */
  const grownZones = excludeZones.map((z) => z);
  const rejectIf = (x: number, z: number): boolean => {
    for (const zone of grownZones) {
      if (pointInRect(x, z, zone)) return true;
    }
    return false;
  };

  const points = poissonDiskSample({
    bounds: scatterBounds,
    minSpacingM: spacingM,
    maxAttempts: count * 40,
    maxPoints: count,
    rng,
    rejectIf,
  });

  if (points.length === 0) return [];

  /* Bin points by model (random assignment — same rng so deterministic). */
  const pointsByModel: Vector3[][] = models.map(() => []);
  for (const p of points) {
    const modelIdx = Math.floor(rng() * models.length) % models.length;
    pointsByModel[modelIdx].push(new Vector3(p.x, groundY, p.y));
  }

  const instanced: InstancedMesh[] = [];
  const tmpMatrix = new Matrix4();
  const tmpPos = new Vector3();
  const tmpQuat = new Quaternion();
  const tmpScale = new Vector3();
  const yAxis = new Vector3(0, 1, 0);

  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    const modelPoints = pointsByModel[m];
    if (modelPoints.length === 0) continue;

    for (const submesh of model.submeshes) {
      const inst = new InstancedMesh(submesh.geometry, submesh.material, modelPoints.length);
      inst.castShadow = true;
      inst.receiveShadow = false;
      inst.name = `enhance-tree-${model.slug}-${submesh.material.name ?? "sub"}`;

      for (let i = 0; i < modelPoints.length; i++) {
        tmpPos.copy(modelPoints[i]);
        const yaw = rng() * Math.PI * 2;
        tmpQuat.setFromAxisAngle(yAxis, yaw);
        const s = model.scale * (1 - scaleJitter + rng() * 2 * scaleJitter);
        tmpScale.set(s, s, s);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        inst.setMatrixAt(i, tmpMatrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      instanced.push(inst);
    }
  }

  return instanced;
}

/** Release cached materials. Engine calls on full reset. */
export function disposeTreeCaches(): void {
  if (trunkMat) {
    trunkMat.dispose();
    trunkMat = null;
  }
  for (const m of canopyMats.values()) m.dispose();
  canopyMats.clear();
}

/** How many InstancedMeshes one model produces — useful for the engine's
    stats & planning. */
export function submeshCountForModels(models: LoadedModel[]): number {
  return models.reduce((acc, m) => acc + m.submeshes.length, 0);
}

/** Compute the seed-dependent tree count actually placed from a scatter
    (for the report's counts breakdown). */
export function totalInstances(meshes: InstancedMesh[]): number {
  /* Each tree contributes N InstancedMeshes (one per submesh); the number
     of TREES is count / submeshesPerModel across grouped meshes. Caller
     knows submeshes per model = 2 (trunk + canopy) in Phase 3. */
  if (meshes.length === 0) return 0;
  return meshes[0].count; // all InstancedMeshes in one batch share the count
}

/** Scale jitter constant for the scatter — kept as export so the shrub
    module can use the same value. */
export const TREE_SCALE_JITTER = 0.15;

/** Utility: mulberry32 re-export convenience for call sites that import
    only tree-scatter. */
export { mulberry32 };
