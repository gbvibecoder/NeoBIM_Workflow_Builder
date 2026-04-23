/* ─── IFC Enhance — Tier 4 building details orchestrator ─────────────────
   Phase 4a hotfix: windows are now processed per ELEMENT (expressID), not
   per sub-mesh, so the "36 windows shown as 144" banner bug is gone. The
   balcony pipeline is polygon-aware (see `balcony-detector.ts`) and the
   railing builder consumes polygons with per-edge rail-provenance so
   railings wrap the actual balcony shape and never overhang into empty
   space. Pure additive geometry — never touches IFC model materials or
   visibility. Reset drops the tier-4 mount in one call. */

import {
  Box3,
  Group,
  type InstancedMesh,
  type Material,
  Mesh,
  Vector2,
} from "three";
import type { ViewportHandle } from "@/types/ifc-viewer";
import { classifyAll } from "../classifier";
import type { EnhanceTag, Tier4ApplyResult, Tier4Toggles } from "../types";
import { detectBalconyPolygons } from "./balcony-detector";
import { buildRailingsForPolygons } from "./railing-builder";
import { buildWindowFrames, type WindowElement } from "./window-frame-builder";
import { buildWindowSills } from "./window-sill-builder";

type ProgressCb = (step: string, progress: number) => void;

export class Tier4Engine {
  private mountedGroup: Group | null = null;
  private applied = false;
  private ownedMaterials = new Set<Material>();
  private lastResult: Tier4ApplyResult | null = null;

  constructor(private viewport: ViewportHandle) {}

  isApplied(): boolean {
    return this.applied;
  }

  getLastResult(): Tier4ApplyResult | null {
    return this.lastResult;
  }

  async apply(
    toggles: Tier4Toggles,
    onProgress: ProgressCb,
  ): Promise<Tier4ApplyResult> {
    const start = performance.now();

    if (this.applied) await this.reset();

    const emptyResult: Tier4ApplyResult = {
      success: true,
      balconyEdgesDetected: 0,
      railingsBuilt: 0,
      windowsFramed: 0,
      sillsBuilt: 0,
      balconyCount: 0,
      durationMs: 0,
    };

    if (!toggles.enabled) {
      const result: Tier4ApplyResult = {
        ...emptyResult,
        message: "Building details disabled.",
        durationMs: performance.now() - start,
      };
      this.lastResult = result;
      return result;
    }

    const refs = this.viewport.getSceneRefs();
    if (!refs) {
      const result: Tier4ApplyResult = {
        ...emptyResult,
        success: false,
        message: "Model not loaded — upload an IFC first.",
        durationMs: performance.now() - start,
      };
      this.lastResult = result;
      return result;
    }
    const { modelGroup } = refs;

    onProgress("Classifying elements", 0.05);
    const meshMap = this.viewport.getMeshMap();
    const typeMap = this.viewport.getTypeMap();
    const wallPsets = new Map(this.viewport.getWallPsets());
    const classified = classifyAll(meshMap, typeMap, wallPsets, modelGroup);

    onProgress("Collecting meshes", 0.1);
    const windowElements = collectWindowElements(meshMap, classified.tags);
    const buildingCenter = computeBuildingCenter(meshMap, classified.tags);

    const root = new Group();
    root.name = "enhance-tier4-root";

    const result: Tier4ApplyResult = { ...emptyResult };

    try {
      /* ── Railings (polygon-aware) ───────────────────────────── */
      if (toggles.railings) {
        onProgress("Detecting balconies", 0.2);
        const polygons = detectBalconyPolygons(meshMap, classified.tags);
        result.balconyEdgesDetected = polygons.length;

        if (polygons.length > 0) {
          onProgress("Building railings", 0.3);
          const rails = buildRailingsForPolygons(polygons, toggles.railingStyle);
          this.collectMaterials(rails.group);
          root.add(rails.group);
          result.balconyCount = rails.count;
          /* Keep `railingsBuilt` pointing at balcony count for summary-row
             compatibility. */
          result.railingsBuilt = rails.count;
        }
      }

      /* ── Window frames ──────────────────────────────────── */
      if (toggles.windowFrames) {
        onProgress("Building window frames", 0.5);
        const framesOut = buildWindowFrames(
          windowElements,
          toggles.frameColor,
          buildingCenter,
        );
        this.collectMaterials(framesOut.group);
        root.add(framesOut.group);
        result.windowsFramed = framesOut.count;
      }

      /* ── Window sills ───────────────────────────────────── */
      if (toggles.windowSills) {
        onProgress("Building window sills", 0.8);
        const sillsOut = buildWindowSills(windowElements, buildingCenter);
        this.collectMaterials(sillsOut.group);
        root.add(sillsOut.group);
        result.sillsBuilt = sillsOut.count;
      }
    } catch (err) {
      this.disposeOwned();
      const failed: Tier4ApplyResult = {
        ...emptyResult,
        success: false,
        message: err instanceof Error ? err.message : "Building details build failed.",
        durationMs: performance.now() - start,
      };
      this.lastResult = failed;
      return failed;
    }

    onProgress("Mounting", 0.95);
    this.viewport.mountEnhancements([root], { tier: 4 });
    this.mountedGroup = root;
    this.applied = true;

    onProgress("Done", 1);
    result.durationMs = performance.now() - start;
    this.lastResult = result;
    return result;
  }

  async reset(): Promise<void> {
    if (!this.applied) {
      this.disposeOwned();
      return;
    }

    this.viewport.unmountEnhancements(4);

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

    this.disposeOwned();

    this.mountedGroup = null;
    this.applied = false;
    this.lastResult = null;
  }

  private collectMaterials(root: Group): void {
    root.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => this.ownedMaterials.add(m));
      else this.ownedMaterials.add(mat);
    });
  }

  private disposeOwned(): void {
    for (const mat of this.ownedMaterials) mat.dispose();
    this.ownedMaterials.clear();
  }
}

export function createTier4Engine(viewport: ViewportHandle): Tier4Engine {
  return new Tier4Engine(viewport);
}

/* ─── Internals ──────────────────────────────────────────────────── */

/**
 * Group window meshes by expressID — one entry per IFC window element,
 * carrying every Mesh the classifier tagged under that element. Fixes
 * the 144/36 miscount: frame + sill counts are now "distinct windows",
 * not "distinct sub-meshes".
 */
function collectWindowElements(
  meshMap: ReadonlyMap<number, Mesh[]>,
  tags: ReadonlyMap<number, EnhanceTag>,
): WindowElement[] {
  const out: WindowElement[] = [];
  for (const [expressID, meshes] of meshMap.entries()) {
    if (tags.get(expressID) !== "window-glass") continue;
    if (meshes.length === 0) continue;
    out.push({ expressID, meshes });
  }
  return out;
}

/**
 * Building centre in the XZ plane — used by the window-frame/sill
 * builders to disambiguate ±X / ±Z outward sign.
 */
function computeBuildingCenter(
  meshMap: ReadonlyMap<number, Mesh[]>,
  tags: ReadonlyMap<number, EnhanceTag>,
): Vector2 {
  const pool: Mesh[] = [];
  for (const [expressID, meshes] of meshMap.entries()) {
    if (tags.get(expressID) === "wall-exterior") pool.push(...meshes);
  }
  if (pool.length === 0) {
    for (const meshes of meshMap.values()) pool.push(...meshes);
  }
  if (pool.length === 0) return new Vector2(0, 0);

  const box = new Box3();
  for (const m of pool) {
    m.updateMatrixWorld(true);
    box.expandByObject(m);
  }
  return new Vector2((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2);
}
