/* ─── IFC Enhance — Tier 2 orchestrator (ground-only, post-strip) ─────────
   Mirrors Tier1Engine's apply/reset shape. Phase 3 is purely additive: it
   mounts a root Group under the tier-2 slot of the enhancement group via
   ViewportHandle.mountEnhancements(..., { tier: 2 }) and never touches
   IFC model materials.

   Post-strip scope: the engine now builds ONLY a ground plane. Trees,
   shrubs, street lamps, road, and sidewalk ring were removed in the Phase
   3 strip and will return in a later phase with better design. */

import { Group, Mesh, type InstancedMesh, type Material } from "three";
import type { ViewportHandle } from "@/types/ifc-viewer";
import { GROUND_SIZE_MULTIPLIER } from "../constants";
import type {
  HDRIPreset,
  MaterialQuality,
  Tier2ApplyResult,
  Tier2Toggles,
} from "../types";
import { buildGround, resolveGroundType } from "./ground-builder";
import { getBuildingBounds } from "./placement-utils";

type ProgressCb = (step: string, progress: number) => void;

export class Tier2Engine {
  private mountedGroup: Group | null = null;
  private applied = false;
  private groundAreaM2 = 0;

  constructor(private viewport: ViewportHandle) {}

  isApplied(): boolean {
    return this.applied;
  }

  async apply(
    toggles: Tier2Toggles,
    _hdriPreset: HDRIPreset,
    quality: MaterialQuality,
    onProgress: ProgressCb,
  ): Promise<Tier2ApplyResult> {
    const start = performance.now();

    /* Double-apply guard — reset before re-apply. */
    if (this.applied) await this.reset();

    if (!toggles.context) {
      return {
        success: true,
        message: "Context master toggle off — skipped.",
        groundAreaM2: 0,
        durationMs: performance.now() - start,
      };
    }

    onProgress("Computing site bounds", 0.1);
    const refs = this.viewport.getSceneRefs();
    if (!refs) {
      return {
        success: false,
        message: "Model not loaded — upload an IFC first.",
        groundAreaM2: 0,
        durationMs: 0,
      };
    }

    const { renderer, modelGroup } = refs;
    const bounds = getBuildingBounds(modelGroup);
    if (!isFinite(bounds.maxExtentM) || bounds.maxExtentM <= 0) {
      return {
        success: false,
        message: "Model has zero extent — nothing to build a ground around.",
        groundAreaM2: 0,
        durationMs: performance.now() - start,
      };
    }

    const root = new Group();
    root.name = "enhance-tier2-root";

    /* ── Ground plane ───────────────────────────────────────── */
    if (toggles.ground) {
      onProgress("Building ground", 0.5);
      const groundType = resolveGroundType(toggles.groundType);
      const ground = await buildGround({ bounds, groundType, quality, renderer });
      root.add(ground);
      const side = bounds.maxExtentM * GROUND_SIZE_MULTIPLIER;
      this.groundAreaM2 = Math.round(side * side);
    }

    /* ── Mount ─────────────────────────────────────────────── */
    onProgress("Mounting", 0.9);
    this.viewport.mountEnhancements([root], { tier: 2 });
    this.mountedGroup = root;
    this.applied = true;
    onProgress("Done", 1);

    return {
      success: true,
      groundAreaM2: this.groundAreaM2,
      durationMs: performance.now() - start,
    };
  }

  async reset(): Promise<void> {
    if (!this.applied) return;

    /* Unmount drops the tier-2 subgroup; Viewport disposes the subtree. */
    this.viewport.unmountEnhancements(2);

    /* Dispose geometries we own — textures stay in the Phase 2 texture
       cache for fast re-apply. Materials are disposed too since each
       apply creates a fresh MeshStandardMaterial via buildGround. */
    if (this.mountedGroup) {
      this.mountedGroup.traverse((obj) => {
        if (obj instanceof Mesh || (obj as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
          const mesh = obj as Mesh | InstancedMesh;
          mesh.geometry.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            (mesh.material as Material).dispose();
          }
        }
      });
    }

    this.mountedGroup = null;
    this.groundAreaM2 = 0;
    this.applied = false;
  }

  /**
   * No-op after the Phase 3 strip. There is no preset-reactive Tier 2
   * geometry today (street lamps were removed). Retained as a stable
   * export so the panel's HDRI-preset-change wiring doesn't need to be
   * conditionally rewritten when preset-reactive elements return in a
   * later phase.
   */
  updateForHDRIPreset(_preset: HDRIPreset): void {
    /* intentionally empty */
  }
}

export function createTier2Engine(viewport: ViewportHandle): Tier2Engine {
  return new Tier2Engine(viewport);
}
