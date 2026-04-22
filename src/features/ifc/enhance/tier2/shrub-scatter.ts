/* ─── IFC Enhance — Tier 2 shrub scatter ──────────────────────────────────
   Primary path (Phase 3 GLB swap): loads Quaternius shrub GLBs from
   `SHRUB_MODELS` via GLTFLoader. Materials used AS-IS from the GLB.
   Defensive fallback to procedural stand-ins if a GLB fails to load. */

import {
  Box3,
  BufferGeometry,
  Color,
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
import { SHRUB_MODELS, TARGET_SHRUB_HEIGHT_M } from "../constants";
import {
  poissonDiskSample,
  pointInRect,
  type BuildingBoundsResult,
  type FootprintRect,
} from "./placement-utils";
import type { LoadedModel } from "./tree-scatter";

/* Shared procedural materials — cached per call site. */
let stemMat: MeshStandardMaterial | null = null;
const foliageMats = new Map<string, MeshStandardMaterial>();

function getStemMaterial(): MeshStandardMaterial {
  if (stemMat) return stemMat;
  stemMat = new MeshStandardMaterial({
    color: 0x5a4226,
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 1.0,
    side: DoubleSide,
  });
  stemMat.name = "enhance-shrub-stem";
  return stemMat;
}

function getFoliageMaterial(hex: number, name: string): MeshStandardMaterial {
  const key = `${name}-${hex}`;
  const cached = foliageMats.get(key);
  if (cached) return cached;
  const mat = new MeshStandardMaterial({
    color: new Color(hex),
    roughness: 0.85,
    metalness: 0,
    envMapIntensity: 1.0,
    side: DoubleSide,
  });
  mat.name = `enhance-shrub-foliage-${name}`;
  foliageMats.set(key, mat);
  return mat;
}

type ShrubVariant = "round" | "tall";

function buildProceduralShrubModel(variant: ShrubVariant): LoadedModel {
  /* Very low stem (just a visible brown disc at ground), big green ball. */
  const stemH = variant === "tall" ? 0.4 : 0.25;
  const stemR = 0.06;
  const stem = new CylinderGeometry(stemR, stemR, stemH, 6);
  stem.translate(0, stemH / 2, 0);

  const foliageR = variant === "tall" ? 0.9 : 0.7;
  const foliageColor = variant === "tall" ? 0x4c7c38 : 0x5b8c4a;
  const foliage = new SphereGeometry(foliageR, 12, 10);
  foliage.translate(0, stemH + foliageR * 0.7, 0);

  const modelHeight = stemH + foliageR * 2 * 0.85;

  return {
    slug: `procedural-shrub-${variant}`,
    submeshes: [
      { geometry: stem, material: getStemMaterial() },
      { geometry: foliage, material: getFoliageMaterial(foliageColor, variant) },
    ],
    scale: TARGET_SHRUB_HEIGHT_M / modelHeight,
  };
}

/* ─── GLB loader + session-scoped cache ────────────────────────────────
   Same pattern as tree-scatter: parse-once per URL, return cloned
   geometries per call so the engine's reset-time dispose touches clones
   only. */

interface CachedGLB {
  submeshes: Array<{ geometry: BufferGeometry; material: Material }>;
  scale: number;
}
const glbCache = new Map<string, CachedGLB>();

function slugFromUrl(url: string): string {
  const match = url.match(/\/([^\/]+)\.(glb|gltf)$/i);
  return match ? match[1] : url;
}

function proceduralVariantForUrl(url: string): ShrubVariant {
  return url.toLowerCase().includes("tall") ? "tall" : "round";
}

async function loadShrubGLB(url: string, targetHeight: number): Promise<CachedGLB> {
  const cached = glbCache.get(url);
  if (cached) return cached;

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);

  const submeshes: Array<{ geometry: BufferGeometry; material: Material }> = [];
  gltf.scene.traverse((obj) => {
    const maybeMesh = obj as Mesh;
    if (!maybeMesh.isMesh || !maybeMesh.geometry) return;
    const geom = maybeMesh.geometry.clone();
    geom.applyMatrix4(maybeMesh.matrixWorld);
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

  if (submeshes.length === 0) throw new Error(`No meshes found inside ${url}`);

  const overall = new Box3();
  for (const sm of submeshes) {
    sm.geometry.computeBoundingBox();
    if (sm.geometry.boundingBox) overall.union(sm.geometry.boundingBox);
  }
  const size = overall.getSize(new Vector3());
  const actualHeight = size.y;
  const scale = actualHeight > 0 ? targetHeight / actualHeight : 1;

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

export async function loadShrubModels(onProgress?: (p: number) => void): Promise<LoadedModel[]> {
  onProgress?.(0);
  /* `SHRUB_MODELS` is tuple-typed `as const`; per-URL try/catch below
     covers the real failure modes. */

  const models: LoadedModel[] = [];
  for (let i = 0; i < SHRUB_MODELS.length; i++) {
    const url = SHRUB_MODELS[i];
    try {
      const glb = await loadShrubGLB(url, TARGET_SHRUB_HEIGHT_M);
      models.push({
        slug: slugFromUrl(url),
        submeshes: glb.submeshes.map((sm) => ({
          geometry: sm.geometry.clone(),
          material: sm.material,
        })),
        scale: glb.scale,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[enhance/tier2] Failed to load shrub GLB ${url} — falling back to procedural.`, err);
      models.push(buildProceduralShrubModel(proceduralVariantForUrl(url)));
    }
    onProgress?.((i + 1) / SHRUB_MODELS.length);
  }

  onProgress?.(1);
  return models;
}

export interface ShrubScatterParams {
  models: LoadedModel[];
  count: number;
  bounds: BuildingBoundsResult;
  excludeZones: FootprintRect[];
  rng: () => number;
  spacingM: number;
  groundY: number;
  scaleJitter: number;
}

export function scatterShrubs(params: ShrubScatterParams): InstancedMesh[] {
  const { models, count, bounds, excludeZones, rng, spacingM, groundY, scaleJitter } = params;
  if (count <= 0 || models.length === 0) return [];

  const halfSide = bounds.maxExtentM * 2.5;
  const scatterBounds = {
    minX: bounds.center.x - halfSide,
    maxX: bounds.center.x + halfSide,
    minZ: bounds.center.z - halfSide,
    maxZ: bounds.center.z + halfSide,
  };

  const rejectIf = (x: number, z: number): boolean => {
    for (const zone of excludeZones) {
      if (pointInRect(x, z, zone)) return true;
    }
    return false;
  };

  const points = poissonDiskSample({
    bounds: scatterBounds,
    minSpacingM: spacingM,
    maxAttempts: count * 50,
    maxPoints: count,
    rng,
    rejectIf,
  });
  if (points.length === 0) return [];

  const pointsByModel: Vector3[][] = models.map(() => []);
  for (const p of points) {
    const idx = Math.floor(rng() * models.length) % models.length;
    pointsByModel[idx].push(new Vector3(p.x, groundY, p.y));
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
      inst.name = `enhance-shrub-${model.slug}-${submesh.material.name ?? "sub"}`;

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

export function disposeShrubCaches(): void {
  if (stemMat) {
    stemMat.dispose();
    stemMat = null;
  }
  for (const m of foliageMats.values()) m.dispose();
  foliageMats.clear();
}
