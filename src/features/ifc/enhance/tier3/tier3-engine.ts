/* ─── IFC Enhance — Tier 3 roof treatment orchestrator ───────────────────
   Phase 3.5a: hybrid roof treatment. Detects whether the model is a
   bungalow or multi-storey, picks the right roof style, hides the
   original flat roof slab(s) via visibility (never swaps materials on the
   IFC model), and mounts the new roof geometry under tier slot 3.

   Design parallels Tier2Engine so the panel can wire it with the same
   apply/reset shape. Tier 3 builds its own wall / tile / deck materials
   using Phase 2's shared texture cache (`loadPBRTextures` is keyed by
   slug+quality, so re-applies are instant and no textures are duplicated
   on the GPU). */

import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  type InstancedMesh,
  type Material,
  MeshStandardMaterial,
  Vector2,
} from "three";
import type { ViewportHandle } from "@/types/ifc-viewer";
import { classifyAll } from "../classifier";
import { PBR_BY_TAG, QUALITY_PRESETS } from "../constants";
import { loadPBRTextures } from "../texture-loader";
import type {
  HDRIPreset,
  MaterialQuality,
  Tier3ApplyResult,
  Tier3Toggles,
} from "../types";
import { buildBulkheadsWithStats } from "./bulkhead-builder";
import { buildDeck } from "./deck-builder";
import { buildGableWithStats } from "./gable-builder";
import { buildParapetWithStats } from "./parapet-builder";
import { extractFootprint } from "./polygon-extractor";
import {
  detectStoreyCount,
  findRoofSlabMeshes,
  resolveRoofStyle,
} from "./roof-detector";
import { SlabHider } from "./slab-hider";

type ProgressCb = (step: string, progress: number) => void;

export class Tier3Engine {
  private mountedGroup: Group | null = null;
  private applied = false;
  private slabHider = new SlabHider();
  /** Materials we built ourselves — disposed on reset. */
  private ownedMaterials = new Set<Material>();
  /** Last-run stats — surfaced via status banner. */
  private lastResult: Tier3ApplyResult | null = null;

  constructor(private viewport: ViewportHandle) {}

  isApplied(): boolean {
    return this.applied;
  }

  getLastResult(): Tier3ApplyResult | null {
    return this.lastResult;
  }

  async apply(
    toggles: Tier3Toggles,
    _hdriPreset: HDRIPreset,
    quality: MaterialQuality,
    onProgress: ProgressCb,
  ): Promise<Tier3ApplyResult> {
    const start = performance.now();

    /* Double-apply guard — reset before re-apply so slab visibility and
       owned materials stay consistent. */
    if (this.applied) await this.reset();

    if (!toggles.enabled) {
      const result: Tier3ApplyResult = {
        success: true,
        resolvedStyle: "skipped",
        message: "Roof synthesis disabled.",
        durationMs: performance.now() - start,
      };
      this.lastResult = result;
      return result;
    }

    const refs = this.viewport.getSceneRefs();
    if (!refs) {
      const result: Tier3ApplyResult = {
        success: false,
        resolvedStyle: "skipped",
        message: "Model not loaded — upload an IFC first.",
        durationMs: performance.now() - start,
      };
      this.lastResult = result;
      return result;
    }
    const { renderer, modelGroup } = refs;

    onProgress("Detecting storeys", 0.05);
    const meshMap = this.viewport.getMeshMap();
    const typeMap = this.viewport.getTypeMap();
    const wallPsetsRO = this.viewport.getWallPsets();
    const wallPsets = new Map(wallPsetsRO);
    const classified = classifyAll(meshMap, typeMap, wallPsets, modelGroup);

    const storeyCount = detectStoreyCount(classified.counts);

    onProgress("Locating roof slabs", 0.1);
    const slabMeshes = findRoofSlabMeshes(meshMap, classified.tags);
    if (slabMeshes.length === 0) {
      const result: Tier3ApplyResult = {
        success: true,
        resolvedStyle: "skipped",
        message: "No roof-slab detected — leaving model untouched.",
        durationMs: performance.now() - start,
      };
      this.lastResult = result;
      return result;
    }

    /* Extract footprint BEFORE resolving style — the polygon's shapeType
       feeds into the style decision (circular → forced flat-terrace). */
    onProgress("Extracting footprint", 0.2);
    let footprint;
    try {
      footprint = extractFootprint(slabMeshes);
    } catch (err) {
      const result: Tier3ApplyResult = {
        success: false,
        resolvedStyle: "skipped",
        message: err instanceof Error ? err.message : "Footprint extraction failed.",
        durationMs: performance.now() - start,
      };
      this.lastResult = result;
      return result;
    }

    onProgress("Resolving roof style", 0.25);
    const resolvedStyle = resolveRoofStyle(
      toggles.style,
      storeyCount,
      footprint.shapeType,
    );

    /* If the user explicitly asked for gable but we're forced to flat by
       a circular footprint, surface this in the result message so the
       panel status banner can explain the behaviour. */
    const circularOverride =
      footprint.shapeType === "circular" && toggles.style === "gable";

    /* Hide the original flat slab now — if anything below throws, reset()
       will restore visibility via slabHider. */
    onProgress("Hiding original slabs", 0.3);
    this.slabHider.hide(slabMeshes);

    const root = new Group();
    root.name = "enhance-tier3-root";

    /* Every Mesh material we build goes into `ownedMaterials` so reset()
       can dispose them; renderer.unmountEnhancements will also traverse
       the group and call dispose() — Three.js dispose() is idempotent so
       the double-call is safe. */
    const result: Tier3ApplyResult = {
      success: true,
      resolvedStyle,
      durationMs: 0,
      shapeType: footprint.shapeType,
      vertexCount: footprint.vertexCount,
      usedFallback: footprint.isFallback,
      ...(circularOverride && {
        message: "Circular footprint — gable overridden to flat-terrace.",
      }),
    };

    try {
      if (resolvedStyle === "flat-terrace") {
        onProgress("Loading materials", 0.35);
        const wallMaterial = await buildWallMaterial(quality, renderer);
        this.ownedMaterials.add(wallMaterial);

        onProgress("Building parapet", 0.5);
        const parapet = buildParapetWithStats(footprint, wallMaterial);
        root.add(parapet.group);
        result.parapetLengthM = parapet.perimeterM;

        onProgress("Laying deck", 0.65);
        const deck = await buildDeck({
          footprint,
          deckMaterial: toggles.deckMaterial,
          quality,
          renderer,
        });
        this.ownedMaterials.add(deck.material as Material);
        root.add(deck);
        /* Polygon-aware: use the actual polygon area, not widthM × depthM. */
        result.deckAreaM2 = Math.round(footprint.areaM2);

        if (toggles.bulkheads) {
          onProgress("Placing bulkheads", 0.8);
          const bulk = buildBulkheadsWithStats(footprint, wallMaterial);
          /* Collect the fresh HVAC + door materials so reset disposes them. */
          bulk.group.traverse((obj) => {
            if (obj instanceof Mesh) {
              const mat = obj.material;
              if (Array.isArray(mat)) mat.forEach((m) => this.ownedMaterials.add(m));
              else this.ownedMaterials.add(mat);
            }
          });
          /* wallMaterial is already tracked — adding it twice via the set
             is a no-op. */
          root.add(bulk.group);
          result.hvacCount = bulk.hvacCount;
          result.stairBulkhead = bulk.hasStairBulkhead;
        } else {
          result.hvacCount = 0;
          result.stairBulkhead = false;
        }
      } else {
        /* gable */
        onProgress("Loading materials", 0.4);
        const tileMaterial = await buildTileMaterial(quality, renderer);
        const wallMaterial = await buildWallMaterial(quality, renderer);
        this.ownedMaterials.add(tileMaterial);
        this.ownedMaterials.add(wallMaterial);

        onProgress("Framing gable roof", 0.6);
        const gable = buildGableWithStats(
          footprint,
          toggles.pitchDeg,
          toggles.ridgeDirection,
          tileMaterial,
          wallMaterial,
        );
        root.add(gable.group);
        result.pitchDeg = gable.clampedPitchDeg;
        result.ridgeDirection = gable.resolvedDirection;
      }
    } catch (err) {
      /* Roll back slab visibility before bubbling up. */
      this.slabHider.restore();
      this.disposeOwned();
      const failed: Tier3ApplyResult = {
        success: false,
        resolvedStyle: "skipped",
        message: err instanceof Error ? err.message : "Roof build failed.",
        durationMs: performance.now() - start,
      };
      this.lastResult = failed;
      return failed;
    }

    onProgress("Mounting", 0.95);
    this.viewport.mountEnhancements([root], { tier: 3 });
    this.mountedGroup = root;
    this.applied = true;

    onProgress("Done", 1);
    result.durationMs = performance.now() - start;
    this.lastResult = result;
    return result;
  }

  async reset(): Promise<void> {
    if (!this.applied) {
      /* Still honour any pre-apply slab hiding from a previous run that
         didn't mark applied — belt-and-suspenders. */
      this.slabHider.restore();
      this.disposeOwned();
      return;
    }

    /* 1. Unmount — Viewport traverses the tier group and disposes mesh
       geometries + materials. Our owned-materials set tracks the same
       materials; double-dispose is safe (three.js dispose is idempotent). */
    this.viewport.unmountEnhancements(3);

    /* 2. Traverse once ourselves so we catch any geometries/materials not
       caught by Viewport (belt-and-suspenders — mirrors tier2-engine). */
    if (this.mountedGroup) {
      this.mountedGroup.traverse((obj) => {
        if (
          obj instanceof Mesh ||
          (obj as unknown as { isInstancedMesh?: boolean }).isInstancedMesh
        ) {
          const mesh = obj as Mesh | InstancedMesh;
          mesh.geometry.dispose();
        }
      });
    }

    /* 3. Dispose every material we explicitly built — textures remain in
       the Phase 2 cache for fast re-apply. */
    this.disposeOwned();

    /* 4. CRITICAL — restore original roof slab visibility. Without this
       the building ends up topless. */
    this.slabHider.restore();

    this.mountedGroup = null;
    this.applied = false;
    this.lastResult = null;
  }

  /**
   * No-op after Phase 3.5a — roof elements already react to HDRI via
   * MeshStandardMaterial. Retained for parity with Tier1/Tier2 engines so
   * the panel's preset-change wiring stays simple.
   */
  updateForHDRIPreset(_preset: HDRIPreset): void {
    /* intentionally empty */
  }

  private disposeOwned(): void {
    for (const mat of this.ownedMaterials) mat.dispose();
    this.ownedMaterials.clear();
  }
}

export function createTier3Engine(viewport: ViewportHandle): Tier3Engine {
  return new Tier3Engine(viewport);
}

/* ─── Private: material builders ─────────────────────────────────────── */

/**
 * Build a brick (wall-exterior) MeshStandardMaterial using Phase 2's
 * shared texture cache. Tier 3 owns the material; the textures are
 * shared with Tier 1's catalog but never disposed by Tier 3.
 */
async function buildWallMaterial(
  quality: MaterialQuality,
  renderer: Parameters<typeof loadPBRTextures>[2],
): Promise<MeshStandardMaterial> {
  const spec = PBR_BY_TAG["wall-exterior"];
  if (!spec) throw new Error("tier3: wall-exterior PBR spec missing");
  const textures = await loadPBRTextures(spec, quality, renderer);
  const useAO = QUALITY_PRESETS[quality].useAO && Boolean(textures.aoMap);
  const mat = new MeshStandardMaterial({
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: DoubleSide,
    envMapIntensity: 1.0,
    normalScale: new Vector2(1, 1),
    ...(textures.map && { map: textures.map }),
    ...(textures.normalMap && { normalMap: textures.normalMap }),
    ...(textures.roughnessMap && { roughnessMap: textures.roughnessMap }),
    ...(useAO && { aoMap: textures.aoMap }),
  });
  if (spec.colorTint) {
    mat.color = new Color(spec.colorTint[0], spec.colorTint[1], spec.colorTint[2]);
  }
  mat.name = "enhance-tier3-wall-exterior";
  return mat;
}

/**
 * Build a roof-tile MeshStandardMaterial. Only used by the gable path.
 */
async function buildTileMaterial(
  quality: MaterialQuality,
  renderer: Parameters<typeof loadPBRTextures>[2],
): Promise<MeshStandardMaterial> {
  const spec = PBR_BY_TAG["roof-slab"];
  if (!spec) throw new Error("tier3: roof-slab PBR spec missing");
  const textures = await loadPBRTextures(spec, quality, renderer);
  const useAO = QUALITY_PRESETS[quality].useAO && Boolean(textures.aoMap);
  const mat = new MeshStandardMaterial({
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: DoubleSide,
    envMapIntensity: 1.0,
    normalScale: new Vector2(1, 1),
    ...(textures.map && { map: textures.map }),
    ...(textures.normalMap && { normalMap: textures.normalMap }),
    ...(textures.roughnessMap && { roughnessMap: textures.roughnessMap }),
    ...(useAO && { aoMap: textures.aoMap }),
  });
  if (spec.colorTint) {
    mat.color = new Color(spec.colorTint[0], spec.colorTint[1], spec.colorTint[2]);
  }
  mat.name = "enhance-tier3-roof-tile";
  return mat;
}
