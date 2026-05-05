/* ─── Panorama feature — controller ────────────────────────────────────────
   Public lifecycle the parent panel drives. Owns:
     · `scene.background` while a panorama is active
     · the procedural blueprint-grid visibility (hidden during apply)
     · the dome (upper hemisphere) and ground disc (lower hemisphere) meshes
     · the BIM model's world position (translated per `bimOffsetXZ`,
       restored on reset)
     · Tier 2 ground-plane coordination (auto-disable + override)
     · the `buildflow.panorama.last-applied-slug` localStorage hint —
       used to restore the previous user choice on next session, NOT for
       auto-apply on model load.

   Always-on model: panorama is staged in the panel; the global Apply
   Enhancement button drives `apply()`; the Reset button drives `reset()`. */

import type { Mesh, Texture } from "three";
import type { ViewportHandle } from "@/types/ifc-viewer";
import {
  PANORAMA_BUCKETS,
  PANORAMA_MANIFEST,
  type PanoramaAsset,
  type PanoramaBucket,
  panoramaUrlFor,
} from "../constants";
import { loadPanorama, disposePanorama } from "./panorama-loader";
import { computePanoramaAnchor } from "./panorama-anchor";
import { buildDome, disposeDome } from "./dome-builder";
import { buildGroundDisc, disposeGroundDisc } from "./ground-disc-builder";

const LS_LAST_APPLIED_SLUG_KEY = "buildflow.panorama.last-applied-slug";

export interface PanoramaState {
  /** Mirrors `hasActiveTexture` for legacy subscribers; not persisted. */
  enabled: boolean;
  bucket: PanoramaBucket | null;
  slug: string | null;
  /** True iff `apply` was called and reset has not yet run. */
  hasActiveTexture: boolean;
  /** True iff Tier 2 was mounted at apply time and we auto-unmounted it. */
  tier2WasAutoDisabled: boolean;
  /** Last apply duration (ms). Surfaced to the status row. */
  lastApplyDurationMs: number;
  /** Last error message, if any. */
  lastError: string | null;
}

export interface PanoramaTier2Adapter {
  isMounted: () => boolean;
  unmount: () => void | Promise<void>;
  remount: () => Promise<void>;
}

/** No-op adapter for tests + environments where Tier 2 is unreachable. */
export const noopTier2Adapter: PanoramaTier2Adapter = {
  isMounted: () => false,
  unmount: () => {},
  remount: async () => {},
};

export interface ApplyResult {
  success: boolean;
  durationMs: number;
  message?: string;
}

export interface PanoramaController {
  apply: (asset: PanoramaAsset) => Promise<ApplyResult>;
  swap: (asset: PanoramaAsset) => Promise<ApplyResult>;
  reset: () => { success: boolean; message?: string };
  getState: () => PanoramaState;
  subscribe: (listener: (state: PanoramaState) => void) => () => void;
  /** "Keep ground anyway" override — re-mount Tier 2 immediately and
   *  forget that we ever auto-disabled it. */
  keepTier2Anyway: () => Promise<void>;
}

interface InternalState extends PanoramaState {
  /** Saved scene.background at first apply — restored on reset. May be
   *  null, a THREE.Color, or a Texture (Tier 1 HDRI). */
  priorBackground: unknown;
  priorBlueprintGridVisible: boolean;
  texture: Texture | null;
  domeMesh: Mesh | null;
  discMesh: Mesh | null;
  /** True iff the BIM has been translated; reset uses this to decide
   *  whether to call `restoreModelPosition`. */
  modelTranslated: boolean;
}

function safeReadLS(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteLS(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* Storage blocked — degrade silently. */
  }
}

export function createPanoramaController(
  viewport: ViewportHandle,
  tier2: PanoramaTier2Adapter = noopTier2Adapter,
): PanoramaController {
  const state: InternalState = {
    enabled: false,
    bucket: null,
    slug: null,
    hasActiveTexture: false,
    tier2WasAutoDisabled: false,
    lastApplyDurationMs: 0,
    lastError: null,
    priorBackground: undefined,
    priorBlueprintGridVisible: true,
    texture: null,
    domeMesh: null,
    discMesh: null,
    modelTranslated: false,
  };

  const listeners = new Set<(s: PanoramaState) => void>();

  function snapshot(): PanoramaState {
    return {
      enabled: state.enabled,
      bucket: state.bucket,
      slug: state.slug,
      hasActiveTexture: state.hasActiveTexture,
      tier2WasAutoDisabled: state.tier2WasAutoDisabled,
      lastApplyDurationMs: state.lastApplyDurationMs,
      lastError: state.lastError,
    };
  }

  function notify(): void {
    const snap = snapshot();
    for (const fn of listeners) fn(snap);
  }

  async function applyInternal(
    asset: PanoramaAsset,
    isSwap: boolean,
  ): Promise<ApplyResult> {
    const start = performance.now();
    state.lastError = null;

    const refs = viewport.getSceneRefs();
    if (!refs) {
      state.lastError = "Model not loaded — upload an IFC first.";
      notify();
      return { success: false, durationMs: 0, message: state.lastError };
    }

    /* Save prior state on first apply only — subsequent swaps reuse it. */
    if (!isSwap || !state.hasActiveTexture) {
      state.priorBackground = refs.scene.background;
      state.priorBlueprintGridVisible = viewport.isBlueprintGridVisible();
      if (tier2.isMounted()) {
        try {
          await tier2.unmount();
          state.tier2WasAutoDisabled = true;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[panorama] Tier 2 auto-disable failed:", err);
        }
      } else {
        state.tier2WasAutoDisabled = false;
      }
    }

    /* Load the new texture before disposing the old one to avoid a
       single-frame flash of solid colour during a swap. */
    let texture: Texture;
    try {
      texture = await loadPanorama(panoramaUrlFor(asset));
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      notify();
      return {
        success: false,
        durationMs: performance.now() - start,
        message: state.lastError,
      };
    }

    const previousTexture = state.texture;
    const previousDome = state.domeMesh;
    const previousDisc = state.discMesh;

    const bbox = viewport.getModelBoundingBox();
    const anchor = computePanoramaAnchor(asset, bbox);

    /* Dev-only diagnostic — surfaces the alignment values that drive
       every visible artefact (panorama too big, BIM sinking, etc.). */
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log("[panorama-v7]", {
        slug: asset.slug,
        bboxMinY: bbox?.min.y ?? null,
        discY: anchor.discPosition.y,
        domeY: anchor.domePosition.y,
        radius: anchor.domeRadius,
        panoramaScale: asset.panoramaScale ?? 1.0,
        discInnerRadius: anchor.discInnerRadius,
      });
    }

    const domeMesh = buildDome(
      texture,
      anchor.domePosition,
      anchor.domeRadius,
      asset.horizonRow,
    );
    const discMesh = buildGroundDisc(
      texture,
      anchor.discPosition,
      anchor.discRadius,
      anchor.discInnerRadius,
      asset.horizonRow,
      asset.groundAnchorPixelXY,
    );

    refs.scene.add(domeMesh);
    refs.scene.add(discMesh);
    state.domeMesh = domeMesh;
    state.discMesh = discMesh;
    state.texture = texture;

    viewport.translateModelTo(anchor.bimAnchorPosition);
    state.modelTranslated = true;

    /* Dome owns the visible upper backdrop; clear scene.background so
       Three.js doesn't paint its implicit equirectangular path on top. */
    refs.scene.background = null;
    viewport.setBlueprintGridVisible(false);
    viewport.setPanoramaActive(true);

    /* Dispose the previous dome+disc from a swap. Texture refcount is
       managed by the loader and only drops here if the swap genuinely
       produced a new texture instance. */
    if (previousDome && previousDome !== domeMesh) {
      refs.scene.remove(previousDome);
      disposeDome(previousDome);
    }
    if (previousDisc && previousDisc !== discMesh) {
      refs.scene.remove(previousDisc);
      disposeGroundDisc(previousDisc);
    }
    if (isSwap && previousTexture && previousTexture !== texture) {
      disposePanorama(previousTexture);
    }

    state.bucket = asset.bucket;
    state.slug = asset.slug;
    state.enabled = true;
    state.hasActiveTexture = true;
    state.lastApplyDurationMs = performance.now() - start;
    safeWriteLS(LS_LAST_APPLIED_SLUG_KEY, asset.slug);

    notify();
    return { success: true, durationMs: state.lastApplyDurationMs };
  }

  function resetInternal(): { success: boolean; message?: string } {
    if (!state.hasActiveTexture) {
      return { success: true, message: "Panorama not active — nothing to reset." };
    }

    const refs = viewport.getSceneRefs();
    if (!refs) {
      /* Scene gone — release GPU memory but skip scene mutations. */
      if (state.domeMesh) {
        disposeDome(state.domeMesh);
        state.domeMesh = null;
      }
      if (state.discMesh) {
        disposeGroundDisc(state.discMesh);
        state.discMesh = null;
      }
      if (state.texture) disposePanorama(state.texture);
      state.texture = null;
      state.hasActiveTexture = false;
      state.enabled = false;
      state.modelTranslated = false;
      safeWriteLS(LS_LAST_APPLIED_SLUG_KEY, null);
      notify();
      return { success: true };
    }

    /* Restore the BIM first so a single redraw shows the cleaned-up
       scene — otherwise there's a frame where the meshes are gone but
       the model is still translated. */
    if (state.modelTranslated) {
      viewport.restoreModelPosition();
      state.modelTranslated = false;
    }

    if (state.domeMesh) {
      refs.scene.remove(state.domeMesh);
      disposeDome(state.domeMesh);
      state.domeMesh = null;
    }
    if (state.discMesh) {
      refs.scene.remove(state.discMesh);
      disposeGroundDisc(state.discMesh);
      state.discMesh = null;
    }

    refs.scene.background = state.priorBackground as typeof refs.scene.background;
    viewport.setBlueprintGridVisible(state.priorBlueprintGridVisible);
    viewport.setPanoramaActive(false);

    if (state.tier2WasAutoDisabled) {
      tier2.remount().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[panorama] Tier 2 remount failed:", err);
      });
    }
    state.tier2WasAutoDisabled = false;

    if (state.texture) disposePanorama(state.texture);
    state.texture = null;
    state.hasActiveTexture = false;
    state.enabled = false;
    safeWriteLS(LS_LAST_APPLIED_SLUG_KEY, null);

    notify();
    return { success: true };
  }

  return {
    apply: (asset) => applyInternal(asset, false),
    swap: (asset) => applyInternal(asset, true),
    reset: resetInternal,
    getState: snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    keepTier2Anyway: async () => {
      if (!state.tier2WasAutoDisabled) return;
      await tier2.remount();
      state.tier2WasAutoDisabled = false;
      notify();
    },
  };
}

/* ── Preselect helper (panel mount) ───────────────────────────────────────
   1. Use the LS-saved slug when it still exists in the manifest.
   2. Wipe the LS slug on miss (post-manifest-migration self-heal) and
      fall through to the detected bucket's first asset.
   3. Return null if the detected bucket happens to be empty. */
export function pickPreselectedAsset(
  detectedBucket: PanoramaBucket,
): PanoramaAsset | null {
  const lastSlug = safeReadLS(LS_LAST_APPLIED_SLUG_KEY);
  if (lastSlug) {
    for (const bucket of PANORAMA_BUCKETS) {
      const found = PANORAMA_MANIFEST[bucket].find((a) => a.slug === lastSlug);
      if (found) return found;
    }
    /* Stale slug after a manifest swap — clear so the next session is clean. */
    safeWriteLS(LS_LAST_APPLIED_SLUG_KEY, null);
  }
  return PANORAMA_MANIFEST[detectedBucket][0] ?? null;
}

/** Read the last-applied slug for the panel's "Last applied: <slug>" hint. */
export function getLastAppliedSlug(): string | null {
  return safeReadLS(LS_LAST_APPLIED_SLUG_KEY);
}
