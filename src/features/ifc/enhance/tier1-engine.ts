/* ─── IFC Enhance — Tier 1 engine ─────────────────────────────────────────
   Orchestrates classify → load textures → load HDRI → swap materials →
   swap environment. Reversible: reset() restores every mesh material, the
   scene environment, and the key-light intensity exactly as they were. */

import {
  BufferAttribute,
  type BufferGeometry,
  DirectionalLight,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from "three";
import { classifyAll } from "./classifier";
import { buildMaterialCatalog, disposeMaterialCatalog, type MaterialCatalog } from "./material-catalog";
import { loadHDRI } from "./hdri-loader";
import { PBR_BY_TAG, HDRI_KEYLIGHT_INTENSITY } from "./constants";
import type { EnhanceTag, EnhanceToggles } from "./types";
import type { ViewportHandle } from "@/types/ifc-viewer";

export interface Tier1ApplyResult {
  success: boolean;
  message?: string;
  counts: Partial<Record<EnhanceTag, number>>;
  appliedMeshCount: number;
  durationMs: number;
  wallsUsedPset: boolean;
}

type ProgressCb = (step: string, progress: number) => void;

/**
 * Generate per-vertex box-projected UVs in world space. Uses the vertex's
 * own normal to pick the dominant projection plane, so hard-edged IFC
 * geometry (which already has duplicated vertices at corners) gets clean
 * per-face UVs without seams. Mutates the geometry in place; returns true
 * iff a `uv` attribute was added (so reset knows to remove it).
 */
function addBoxProjectedUV(geometry: BufferGeometry, tilingMetres: number): boolean {
  if (geometry.attributes.uv) return false;
  const position = geometry.attributes.position as BufferAttribute | undefined;
  const normal = geometry.attributes.normal as BufferAttribute | undefined;
  if (!position || !normal) return false;

  const count = position.count;
  const uv = new Float32Array(count * 2);
  const s = 1 / tilingMetres;

  for (let i = 0; i < count; i++) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const ax = Math.abs(normal.getX(i));
    const ay = Math.abs(normal.getY(i));
    const az = Math.abs(normal.getZ(i));

    let u = 0;
    let v = 0;
    if (ay >= ax && ay >= az) {
      u = px * s;
      v = pz * s;
    } else if (ax >= az) {
      u = pz * s;
      v = py * s;
    } else {
      u = px * s;
      v = py * s;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }

  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  return true;
}

/** Find the shadow-casting DirectionalLight — the "key light" in Viewport.tsx's 5-light rig. */
function findKeyLight(root: Object3D): DirectionalLight | null {
  let found: DirectionalLight | null = null;
  root.traverse((obj) => {
    if (found) return;
    if (obj instanceof DirectionalLight && obj.castShadow) found = obj;
  });
  return found;
}

/** Tiling (metres per tile) for a given tag. Fallback for untextured tags. */
function tilingFor(tag: EnhanceTag): number {
  const spec = PBR_BY_TAG[tag];
  if (spec) return spec.tilingMetres;
  return 2.0;
}

export class Tier1Engine {
  private originalMaterials = new Map<Mesh, Material | Material[]>();
  private injectedUVs = new Set<BufferGeometry>();
  private originalEnvironment: Texture | null = null;
  private environmentReplaced = false;
  private originalKeyLightIntensity: number | null = null;
  private keyLight: DirectionalLight | null = null;
  private catalog: MaterialCatalog | null = null;
  private hdriTexture: Texture | null = null;
  private applied = false;

  constructor(private viewport: ViewportHandle) {}

  isApplied(): boolean {
    return this.applied;
  }

  async apply(toggles: EnhanceToggles, onProgress: ProgressCb): Promise<Tier1ApplyResult> {
    const start = performance.now();
    onProgress("Initialising", 0.02);

    const refs = this.viewport.getSceneRefs();
    if (!refs) {
      return {
        success: false,
        message: "Model not loaded — upload an IFC first.",
        counts: {},
        appliedMeshCount: 0,
        durationMs: 0,
        wallsUsedPset: false,
      };
    }

    /* Don't double-apply — caller should reset first. */
    if (this.applied) {
      await this.reset();
    }

    const { scene, renderer, modelGroup } = refs;
    const meshMap = this.viewport.getMeshMap();
    const typeMap = this.viewport.getTypeMap();

    if (meshMap.size === 0) {
      return {
        success: false,
        message: "Model has no meshes — try re-uploading the IFC.",
        counts: {},
        appliedMeshCount: 0,
        durationMs: performance.now() - start,
        wallsUsedPset: false,
      };
    }

    /* Phase 1 pushed Pset_WallCommon data to Viewport at parse time; Phase 2
       added `getWallPsets()` to the handle so the classifier can read it.
       The classifier's data-sanity check (psetDataIsTrustworthy) still
       decides whether to use this data or fall through to the geometric
       heuristic — basic.ifc has all-false IsExternal, which triggers the
       fallback; realistic IFCs with mixed values use the Psets. */
    const psetsRO = this.viewport.getWallPsets();
    const wallPsets = new Map<number, { isExternal: boolean | null; fireRating: string | null }>(psetsRO);

    /* ── 1 · Classify ─────────────────────────────────────── */
    onProgress("Classifying elements", 0.08);
    const { tags, counts, wallsUsedPset } = classifyAll(meshMap, typeMap, wallPsets, modelGroup);

    /* ── 2 · Material catalog (textured + procedural + glass) ─ */
    if (toggles.materials) {
      onProgress("Loading textures", 0.12);
      this.catalog = await buildMaterialCatalog(
        toggles.quality,
        toggles.litInteriorWindows,
        toggles.hdriPreset,
        renderer,
        (step, sub) => onProgress(step, 0.12 + sub * 0.5),
      );
    }

    /* ── 3 · HDRI (PMREM-processed; no frame-of-wrong-light flash) ─ */
    if (toggles.hdri) {
      onProgress("Loading HDRI", 0.68);
      this.hdriTexture = await loadHDRI(toggles.hdriPreset, renderer);
    }

    /* ── 4 · Material swap ─────────────────────────────────── */
    let meshCount = 0;
    if (toggles.materials && this.catalog) {
      onProgress("Applying materials", 0.8);
      for (const [expressID, meshes] of meshMap.entries()) {
        const tag = tags.get(expressID);
        if (!tag || tag === "space") continue;
        const targetMaterial = this.catalog.get(tag);
        if (!targetMaterial) continue;

        const tiling = tilingFor(tag);

        for (const mesh of meshes) {
          /* Store the original material (first encounter only). */
          if (!this.originalMaterials.has(mesh)) {
            this.originalMaterials.set(mesh, mesh.material);
          }
          /* Generate UVs if the geometry has none — required for any
             texture-mapped material to render correctly. Skip UV gen on
             untextured tags (column/beam/stair/railing/other) as an
             optimisation — the neutral procedural materials don't read UVs. */
          if (PBR_BY_TAG[tag] !== undefined && mesh.geometry) {
            if (addBoxProjectedUV(mesh.geometry, tiling)) {
              this.injectedUVs.add(mesh.geometry);
            }
          }

          /* Array materials on an IFC mesh would mean multi-group geometry.
             StreamAllMeshes never emits those — but log a warning if it
             happens. We swap to the single shared material either way. */
          if (Array.isArray(mesh.material)) {
            // eslint-disable-next-line no-console
            console.warn(`[enhance] mesh #${expressID} has array material — swapping all groups to shared ${tag} material.`);
          }
          mesh.material = targetMaterial;
          /* Keep Viewport's hover/select baseline cache in lock-step with the
             swap so hover-out and select-release restore to the enhanced
             material, not the pre-Enhance gray. */
          this.viewport.syncMeshBaseline(mesh, targetMaterial);
          meshCount += 1;
        }
      }
    }

    /* ── 5 · Environment + lighting ──────────────────────────── */
    if (toggles.hdri && this.hdriTexture) {
      onProgress("Applying environment", 0.94);
      /* Preserve the *original* env the first time we replace it — do NOT
         overwrite it on a re-apply that followed a reset. */
      if (!this.environmentReplaced) {
        this.originalEnvironment = scene.environment;
        this.environmentReplaced = true;
      }
      scene.environment = this.hdriTexture;
      /* Deliberately DO NOT touch scene.background — the blueprint grid
         stays. Background-swap is a v2.1 toggle. */

      this.keyLight = findKeyLight(scene);
      if (this.keyLight) {
        if (this.originalKeyLightIntensity === null) {
          this.originalKeyLightIntensity = this.keyLight.intensity;
        }
        const multiplier = HDRI_KEYLIGHT_INTENSITY[toggles.hdriPreset];
        this.keyLight.intensity = this.originalKeyLightIntensity * multiplier;
      }
    }

    onProgress("Done", 1);
    this.applied = true;

    return {
      success: true,
      counts,
      appliedMeshCount: meshCount,
      durationMs: performance.now() - start,
      wallsUsedPset,
    };
  }

  async reset(): Promise<void> {
    if (!this.applied) return;

    /* Restore mesh materials. We don't dispose the original materials —
       they belong to the viewer's original state and were built with
       Viewport's getMaterialPreset. Also resync Viewport's baseline cache
       so hover-out and select-release land on the original gray again. */
    for (const [mesh, original] of this.originalMaterials.entries()) {
      mesh.material = original;
      this.viewport.syncMeshBaseline(mesh, original);
    }
    this.originalMaterials.clear();

    /* Remove UVs we injected. Geometries whose UVs we did NOT add remain
       untouched. */
    for (const geom of this.injectedUVs) {
      geom.deleteAttribute("uv");
    }
    this.injectedUVs.clear();

    /* Dispose the enhancement-only materials. Textures remain cached in
       texture-loader / hdri-loader for fast re-apply. */
    if (this.catalog) {
      disposeMaterialCatalog(this.catalog);
      this.catalog = null;
    }

    /* Restore environment + key light. */
    const refs = this.viewport.getSceneRefs();
    if (refs && this.environmentReplaced) {
      refs.scene.environment = this.originalEnvironment;
    }
    this.environmentReplaced = false;
    this.originalEnvironment = null;

    if (this.keyLight && this.originalKeyLightIntensity !== null) {
      this.keyLight.intensity = this.originalKeyLightIntensity;
    }
    this.keyLight = null;
    this.originalKeyLightIntensity = null;

    /* Safety: release any enhancement group mounts future tiers may have
       added. No-op today but keeps contracts tight. */
    this.viewport.unmountEnhancements(1);

    this.hdriTexture = null;
    this.applied = false;
  }

  /**
   * Helper for paranoid cleanup at unload-time. Currently does the same as
   * reset(); separated so future phases can add additional teardown
   * (e.g. disposing added glTF assets on Tier 3) without touching reset's
   * semantics. Fire-and-forget safe.
   */
  async dispose(): Promise<void> {
    await this.reset();
  }
}

/** Factory — keeps the concrete class constructor internal if we ever
    want to swap implementations. */
export function createTier1Engine(viewport: ViewportHandle): Tier1Engine {
  return new Tier1Engine(viewport);
}

/** Recommend sensible defaults for "Auto — apply recommended". */
export function recommendedToggles(elementCount: number): EnhanceToggles {
  /* Large models (>2000 elements): drop to medium quality so texture IO
     + UV injection stays under 8s. basic.ifc (199 elements) sails through
     at high. */
  const quality = elementCount > 2000 ? "medium" : elementCount > 5000 ? "low" : "high";
  return {
    materials: true,
    hdri: true,
    hdriPreset: "day",
    litInteriorWindows: true,
    quality,
  };
}

