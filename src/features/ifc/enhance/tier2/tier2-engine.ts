/* ─── IFC Enhance — Tier 2 orchestrator ───────────────────────────────────
   Mirrors Tier1Engine's apply/reset shape. Phase 3 is purely additive: it
   mounts a root Group under the tier-2 slot of the enhancement group via
   ViewportHandle.mountEnhancements(..., { tier: 2 }) and never touches
   IFC model materials.

   Order of operations on apply:
     1 · Compute building bounds (seed + exclusion zones come from here)
     2 · Ground plane (grass / concrete / asphalt)
     3 · Sidewalk ring around building
     4 · Road along requested side + dashed markers
     5 · Scatter trees (Poisson-disk, InstancedMesh grouped by model)
     6 · Scatter shrubs
     7 · Place lamps along the road's far edge
     8 · Mount everything to tier-2 slot

   Reset drops the whole tier-2 group via unmountEnhancements(2). */

import {
  Group,
  Mesh,
  type InstancedMesh,
  type Material,
  type Object3D,
  type Vector3,
  Vector3 as Vec3,
} from "three";
import type { ViewportHandle } from "@/types/ifc-viewer";
import {
  GROUND_SIZE_MULTIPLIER,
  LAMP,
  PLACEMENT_EXCLUSION,
  SIDEWALK,
} from "../constants";
import type {
  HDRIPreset,
  MaterialQuality,
  Tier2ApplyResult,
  Tier2Toggles,
} from "../types";
import { buildGround, buildRoad, buildSidewalkRing, resolveGroundType } from "./ground-builder";
import {
  buildLampUnit,
  disposeLampCaches,
  placeLampsAlongLine,
  updateLampsForPreset,
} from "./lamp-builder";
import {
  disposeTreeCaches,
  loadTreeModels,
  scatterTrees,
  TREE_SCALE_JITTER,
} from "./tree-scatter";
import {
  disposeShrubCaches,
  loadShrubModels,
  scatterShrubs,
} from "./shrub-scatter";
import {
  expandRect,
  getBuildingBounds,
  mulberry32,
  seedFromBox,
  type BuildingBoundsResult,
  type FootprintRect,
} from "./placement-utils";

type ProgressCb = (step: string, progress: number) => void;

export class Tier2Engine {
  private mountedGroup: Group | null = null;
  private lampUnits: Group[] = [];
  private applied = false;
  private currentHDRIPreset: HDRIPreset = "day";
  private treesPlaced = 0;
  private shrubsPlaced = 0;
  private groundAreaM2 = 0;

  constructor(private viewport: ViewportHandle) {}

  isApplied(): boolean {
    return this.applied;
  }

  async apply(
    toggles: Tier2Toggles,
    hdriPreset: HDRIPreset,
    quality: MaterialQuality,
    onProgress: ProgressCb,
  ): Promise<Tier2ApplyResult> {
    const start = performance.now();
    this.currentHDRIPreset = hdriPreset;

    /* Double-apply guard — reset before re-apply. */
    if (this.applied) await this.reset();

    if (!toggles.context) {
      return {
        success: true,
        message: "Context master toggle off — skipped.",
        groundAreaM2: 0,
        treesPlaced: 0,
        shrubsPlaced: 0,
        lampsPlaced: 0,
        durationMs: performance.now() - start,
      };
    }

    onProgress("Computing site bounds", 0.02);
    const refs = this.viewport.getSceneRefs();
    if (!refs) {
      return {
        success: false,
        message: "Model not loaded — upload an IFC first.",
        groundAreaM2: 0,
        treesPlaced: 0,
        shrubsPlaced: 0,
        lampsPlaced: 0,
        durationMs: 0,
      };
    }

    const { renderer, modelGroup } = refs;
    const bounds = getBuildingBounds(modelGroup);
    if (!isFinite(bounds.maxExtentM) || bounds.maxExtentM <= 0) {
      return {
        success: false,
        message: "Model has zero extent — nothing to scatter around.",
        groundAreaM2: 0,
        treesPlaced: 0,
        shrubsPlaced: 0,
        lampsPlaced: 0,
        durationMs: performance.now() - start,
      };
    }

    const root = new Group();
    root.name = "enhance-tier2-root";

    /* ── 2 · Ground ────────────────────────────────────────── */
    if (toggles.ground) {
      onProgress("Building ground", 0.12);
      const groundType = resolveGroundType(toggles.groundType, toggles.road && toggles.roadSide !== "none");
      const ground = await buildGround({ bounds, groundType, quality, renderer });
      root.add(ground);
      const side = bounds.maxExtentM * GROUND_SIZE_MULTIPLIER;
      this.groundAreaM2 = Math.round(side * side);
    }

    /* ── 3 · Sidewalk ring ─────────────────────────────────── */
    if (toggles.sidewalk) {
      onProgress("Building sidewalk", 0.22);
      const sidewalk = await buildSidewalkRing({ bounds, quality, renderer });
      root.add(sidewalk);
    }

    /* ── 4 · Road ─────────────────────────────────────────── */
    let roadGroup: Group | null = null;
    if (toggles.road && toggles.roadSide !== "none") {
      onProgress("Building road", 0.32);
      roadGroup = await buildRoad({ bounds, side: toggles.roadSide, quality, renderer });
      root.add(roadGroup);
    }

    /* ── 5 · Tree models + scatter ───────────────────────── */
    let treeMeshes: InstancedMesh[] = [];
    if (toggles.treeCount > 0) {
      onProgress("Loading tree models", 0.44);
      const treeModels = await loadTreeModels((p) => onProgress("Loading tree models", 0.44 + p * 0.05));

      onProgress("Scattering trees", 0.55);
      const seed = seedFromBox(bounds.box);
      const rngTrees = mulberry32(seed);
      treeMeshes = scatterTrees({
        models: treeModels,
        count: toggles.treeCount,
        bounds,
        excludeZones: this.buildExclusionZones(bounds, toggles, roadGroup),
        rng: rngTrees,
        spacingM: PLACEMENT_EXCLUSION.treeSpacingM,
        groundY: bounds.footprint.minY - 0.05,
        scaleJitter: TREE_SCALE_JITTER,
      });
      for (const m of treeMeshes) root.add(m);
      /* Count TREES (not InstancedMeshes) — each tree contributes 2
         instanced meshes (trunk + canopy) that share an instance count. */
      this.treesPlaced = treeMeshes.length > 0 ? this.countTreesAcrossMeshes(treeMeshes, 2) : 0;
    }

    /* ── 6 · Shrubs ────────────────────────────────────────── */
    let shrubMeshes: InstancedMesh[] = [];
    if (toggles.shrubCount > 0) {
      onProgress("Scattering shrubs", 0.7);
      /* Different seed per stream so trees and shrubs don't collide at
         identical xy coordinates. Deriving from base seed keeps the
         determinism contract. */
      const seedShrubs = seedFromBox(bounds.box) ^ 0x9e3779b9;
      const rngShrubs = mulberry32(seedShrubs);
      shrubMeshes = scatterShrubs({
        models: await loadShrubModels(),
        count: toggles.shrubCount,
        bounds,
        excludeZones: this.buildExclusionZones(bounds, toggles, roadGroup),
        rng: rngShrubs,
        spacingM: PLACEMENT_EXCLUSION.shrubSpacingM,
        groundY: bounds.footprint.minY - 0.05,
        scaleJitter: 0.25,
      });
      for (const m of shrubMeshes) root.add(m);
      this.shrubsPlaced = shrubMeshes.length > 0 ? this.countTreesAcrossMeshes(shrubMeshes, 2) : 0;
    }

    /* ── 7 · Street lamps ──────────────────────────────────── */
    let lampsPlaced = 0;
    if (toggles.lamps && roadGroup) {
      onProgress("Placing lamps", 0.86);
      const lamps = this.placeLampsOnRoad(bounds, roadGroup, hdriPreset);
      for (const lamp of lamps) root.add(lamp);
      this.lampUnits = lamps;
      lampsPlaced = lamps.length;
    }

    /* ── 8 · Mount ─────────────────────────────────────────── */
    onProgress("Mounting", 0.96);
    this.viewport.mountEnhancements([root], { tier: 2 });
    this.mountedGroup = root;
    this.applied = true;
    onProgress("Done", 1);

    return {
      success: true,
      groundAreaM2: this.groundAreaM2,
      treesPlaced: this.treesPlaced,
      shrubsPlaced: this.shrubsPlaced,
      lampsPlaced,
      durationMs: performance.now() - start,
    };
  }

  async reset(): Promise<void> {
    if (!this.applied) return;

    /* Unmount drops the tier-2 subgroup; Viewport disposes the subtree. */
    this.viewport.unmountEnhancements(2);

    /* Dispose geometries + material caches we own — textures stay in the
       Phase 2 texture cache for fast re-apply. */
    if (this.mountedGroup) {
      this.mountedGroup.traverse((obj) => {
        if (obj instanceof Mesh || (obj as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
          const mesh = obj as Mesh | InstancedMesh;
          mesh.geometry.dispose();
          /* Don't blanket-dispose materials here — shared caches (trunk,
             canopy, lamp post, …) are reused across a re-apply. Dedicated
             cache disposers handle them. */
        }
      });
    }
    disposeTreeCaches();
    disposeShrubCaches();
    disposeLampCaches();

    this.mountedGroup = null;
    this.lampUnits = [];
    this.treesPlaced = 0;
    this.shrubsPlaced = 0;
    this.groundAreaM2 = 0;
    this.applied = false;
  }

  /**
   * Swap lamp lighting for a new HDRI preset without a full re-apply.
   * Idempotent. If the new preset is the same as the currently applied
   * one, no-op.
   */
  updateForHDRIPreset(preset: HDRIPreset): void {
    if (!this.applied) return;
    if (preset === this.currentHDRIPreset) return;
    this.currentHDRIPreset = preset;
    updateLampsForPreset(this.lampUnits, preset);
  }

  /** Merge the Phase 3 exclusion zones: building footprint, sidewalk ring
      outer rect, and road rect — all grown by their respective buffers. */
  private buildExclusionZones(
    bounds: BuildingBoundsResult,
    toggles: Tier2Toggles,
    roadGroup: Group | null,
  ): FootprintRect[] {
    const zones: FootprintRect[] = [];

    /* Building: footprint + buildingBuffer. */
    zones.push(expandRect(bounds.footprint, PLACEMENT_EXCLUSION.buildingBufferM));

    /* Sidewalk ring: outer rect of ring + sidewalkBuffer — treated as a
       single rect (good enough; slight over-exclusion around corners is
       acceptable for Phase 3). */
    if (toggles.sidewalk) {
      zones.push(
        expandRect(
          expandRect(bounds.footprint, SIDEWALK.widthM),
          PLACEMENT_EXCLUSION.sidewalkBufferM,
        ),
      );
    }

    /* Road rect from the stash we set in buildRoad. */
    if (roadGroup) {
      const center = roadGroup.userData.roadCenter as { x: number; z: number } | undefined;
      const axis = roadGroup.userData.roadAxis as "z" | "x" | undefined;
      const length = roadGroup.userData.roadLength as number | undefined;
      const width = roadGroup.userData.roadWidth as number | undefined;
      if (center && axis && length && width) {
        const buf = PLACEMENT_EXCLUSION.roadBufferM;
        if (axis === "z") {
          zones.push({
            minX: center.x - width / 2 - buf,
            maxX: center.x + width / 2 + buf,
            minZ: center.z - length / 2 - buf,
            maxZ: center.z + length / 2 + buf,
            minY: bounds.footprint.minY,
            maxY: bounds.footprint.minY + 1,
          });
        } else {
          zones.push({
            minX: center.x - length / 2 - buf,
            maxX: center.x + length / 2 + buf,
            minZ: center.z - width / 2 - buf,
            maxZ: center.z + width / 2 + buf,
            minY: bounds.footprint.minY,
            maxY: bounds.footprint.minY + 1,
          });
        }
      }
    }

    return zones;
  }

  /**
   * Lay lamps along the road's FAR edge (away from the building). Returns
   * an array of positioned, preset-configured lamp Groups.
   */
  private placeLampsOnRoad(bounds: BuildingBoundsResult, roadGroup: Group, preset: HDRIPreset): Group[] {
    const center = roadGroup.userData.roadCenter as { x: number; z: number };
    const axis = roadGroup.userData.roadAxis as "z" | "x";
    const length = roadGroup.userData.roadLength as number;
    const width = roadGroup.userData.roadWidth as number;
    const roadSide = roadGroup.userData.roadSide as string;

    const groundY = bounds.footprint.minY - 0.04;
    const lampTemplate = buildLampUnit();

    let start: Vector3;
    let end: Vector3;

    /* "Far" edge = the road edge opposite the building. */
    if (axis === "z") {
      const farX = roadSide === "east" ? center.x + width / 2 + 0.5 : center.x - width / 2 - 0.5;
      start = new Vec3(farX, groundY, center.z - length / 2 + LAMP.spacingM / 2);
      end = new Vec3(farX, groundY, center.z + length / 2 - LAMP.spacingM / 2);
    } else {
      const farZ = roadSide === "south" ? center.z + width / 2 + 0.5 : center.z - width / 2 - 0.5;
      start = new Vec3(center.x - length / 2 + LAMP.spacingM / 2, groundY, farZ);
      end = new Vec3(center.x + length / 2 - LAMP.spacingM / 2, groundY, farZ);
    }

    /* rng seeded from bounds so each building's lamp yaw jitter is stable. */
    const rng = mulberry32(seedFromBox(bounds.box) ^ 0xabcdef12);
    return placeLampsAlongLine({
      start,
      end,
      spacingM: LAMP.spacingM,
      lampTemplate,
      hdriPreset: preset,
      rng,
    });
  }

  /** Given a batch of InstancedMeshes (all from one scatter), the number
      of TREES or SHRUBS is the per-batch instance count divided by
      submeshes per model. We grouped instance matrices so ALL submeshes of
      one model have the same instance count — summing one-per-model gives
      total items. */
  private countTreesAcrossMeshes(meshes: InstancedMesh[], submeshesPerModel: number): number {
    /* meshes come back in groups of `submeshesPerModel` per model — so
       total items = sum(first mesh of each group's count). */
    let total = 0;
    for (let i = 0; i < meshes.length; i += submeshesPerModel) {
      total += meshes[i].count;
    }
    return total;
  }
}

export function createTier2Engine(viewport: ViewportHandle): Tier2Engine {
  return new Tier2Engine(viewport);
}
