/* @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  BackSide,
  Box3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from "three";

import {
  createPanoramaController,
  pickPreselectedAsset,
  getLastAppliedSlug,
} from "@/features/panorama/lib/panorama-controller";

/* happy-dom in node-mode ships a stub localStorage that lacks setItem /
   removeItem. Install a tiny in-memory implementation so the controller's
   localStorage reads/writes are observable. */
function installInMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: ls,
    configurable: true,
    writable: true,
  });
}
import { __resetPanoramaCacheForTests } from "@/features/panorama/lib/panorama-loader";
import type { PanoramaAsset } from "@/features/panorama/constants";
import type { ViewportHandle } from "@/types/ifc-viewer";

const ASSET_A: PanoramaAsset = {
  slug: "balcony",
  bucket: "residential-apartment",
  displayName: "Apt Balcony",
  fileName: "balcony.jpg",
  fileSizeBytes: 1_500_000,
  source: "polyhaven",
  license: "CC0",
  horizonRow: 0.5,
  groundAnchorPixelXY: { x: 0.5, y: 0.85 },
  panoramaScale: 1.0,
};

const ASSET_B: PanoramaAsset = {
  slug: "rooftop_day",
  bucket: "office",
  displayName: "Urban Rooftop",
  fileName: "rooftop_day.jpg",
  fileSizeBytes: 1_300_000,
  source: "polyhaven",
  license: "CC0",
  horizonRow: 0.5,
  groundAnchorPixelXY: { x: 0.5, y: 0.85 },
  panoramaScale: 2.0,
};

function buildMockViewport(opts?: { modelBbox?: Box3 | null }) {
  const scene = new Scene();
  scene.background = new Color(0xf6f7f9);
  const camera = new PerspectiveCamera();
  const renderer = { dispose: () => {} } as unknown as WebGLRenderer;
  const modelGroup = new Group();
  let blueprintVisible = true;
  let panoramaActive = false;
  const modelBbox: Box3 | null = opts?.modelBbox ?? null;
  /* Track the model translation calls so tests can assert lifecycle. */
  const modelPositionLog: { x: number; y: number; z: number }[] = [];
  let restoreCalls = 0;

  const handle: ViewportHandle = {
    loadFile: async () => {},
    fitToView: () => {},
    fitToSelection: () => {},
    setViewMode: () => {},
    setColorBy: () => {},
    toggleEdges: () => {},
    toggleSectionPlane: () => {},
    startMeasurement: () => {},
    cancelMeasurement: () => {},
    clearMeasurements: () => {},
    takeScreenshot: () => {},
    setProjection: () => {},
    setPresetView: () => {},
    toggleGrid: () => {},
    hideSelected: () => {},
    isolateSelected: () => {},
    showAll: () => {},
    selectByExpressID: () => {},
    selectByType: () => {},
    getCSVData: () => "",
    unloadModel: () => {},
    setMeasureUnit: () => {},
    onCameraChange: () => {},

    getSceneRefs: () => ({ scene, camera, renderer, modelGroup }),
    getMeshMap: () => new Map(),
    getTypeMap: () => new Map(),
    getSpaceBounds: () => new Map(),
    mountEnhancements: () => {},
    unmountEnhancements: () => {},
    getPropertySets: async () => [],
    getWallPsets: () => new Map(),
    syncMeshBaseline: () => {},

    setBlueprintGridVisible: (v) => {
      blueprintVisible = v;
    },
    isBlueprintGridVisible: () => blueprintVisible,
    setPanoramaActive: (a) => {
      panoramaActive = a;
    },
    isPanoramaActive: () => panoramaActive,
    getModelBoundingBox: () => modelBbox,
    getSlabMeshes: () => [],
    translateModelTo: (pos: Vector3) => {
      modelGroup.position.copy(pos);
      modelPositionLog.push({ x: pos.x, y: pos.y, z: pos.z });
    },
    restoreModelPosition: () => {
      modelGroup.position.set(0, 0, 0);
      restoreCalls += 1;
    },
  };

  return {
    handle,
    scene,
    modelGroup,
    /** Probe helpers — read coordination state. */
    isBlueprintVisible: () => blueprintVisible,
    isPanoramaActive: () => panoramaActive,
    getModelTranslations: () => modelPositionLog.slice(),
    getRestoreCalls: () => restoreCalls,
  };
}

function mockLoaderToReturnTexture() {
  vi.spyOn(TextureLoader.prototype, "load").mockImplementation(function (
    this: TextureLoader,
    _url: string,
    onLoad?: (tex: Texture<HTMLImageElement>) => void,
  ) {
    queueMicrotask(() => {
      onLoad?.(new Texture() as unknown as Texture<HTMLImageElement>);
    });
    return new Texture() as unknown as Texture<HTMLImageElement>;
  });
}

describe("panorama-controller (V6)", () => {
  beforeEach(() => {
    __resetPanoramaCacheForTests();
    installInMemoryLocalStorage();
    vi.restoreAllMocks();
  });

  it("apply mounts a 'panorama-dome' (BackSide) and 'panorama-disc' (DoubleSide) and clears scene.background", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    const ctl = createPanoramaController(v.handle);
    const r = await ctl.apply(ASSET_A);
    expect(r.success).toBe(true);
    expect(v.scene.background).toBeNull();

    const dome = v.scene.getObjectByName("panorama-dome") as Mesh | undefined;
    const disc = v.scene.getObjectByName("panorama-disc") as Mesh | undefined;
    expect(dome).toBeDefined();
    expect(disc).toBeDefined();

    const domeMat = dome!.material as MeshBasicMaterial;
    const discMat = disc!.material as MeshBasicMaterial;
    expect(domeMat).toBeInstanceOf(MeshBasicMaterial);
    expect(domeMat.side).toBe(BackSide);
    expect(domeMat.map).toBeInstanceOf(Texture);
    expect(discMat.side).toBe(DoubleSide);
    /* Same texture used by both meshes — refcount stays consistent. */
    expect(discMat.map).toBe(domeMat.map);

    expect(v.isBlueprintVisible()).toBe(false);
    expect(v.isPanoramaActive()).toBe(true);
    expect(ctl.getState().slug).toBe("balcony");
  });

  it("V7: apply leaves BIM at world origin (translateModelTo to (0,0,0) = no-op for fresh model)", async () => {
    mockLoaderToReturnTexture();
    const bbox = new Box3(new Vector3(-10, 0, -10), new Vector3(10, 20, 10));
    const v = buildMockViewport({ modelBbox: bbox });
    const ctl = createPanoramaController(v.handle);
    await ctl.apply(ASSET_A);
    const log = v.getModelTranslations();
    expect(log.length).toBe(1);
    expect(log[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(v.modelGroup.position.x).toBe(0);
    expect(v.modelGroup.position.y).toBe(0);
    expect(v.modelGroup.position.z).toBe(0);
  });

  it("V7.1: an asset's bimOffsetXZ flows through to translateModelTo", async () => {
    mockLoaderToReturnTexture();
    const bbox = new Box3(new Vector3(-10, 0, -10), new Vector3(10, 20, 10));
    const v = buildMockViewport({ modelBbox: bbox });
    const ctl = createPanoramaController(v.handle);
    const offsetAsset: PanoramaAsset = {
      ...ASSET_A,
      bimOffsetXZ: { x: -7, z: 4 },
    };
    await ctl.apply(offsetAsset);
    const log = v.getModelTranslations();
    expect(log.length).toBe(1);
    expect(log[0]).toEqual({ x: -7, y: 0, z: 4 });
  });

  it("V7: apply anchors dome+disc Y to bbox.min.y directly (no slab/foundation buffer)", async () => {
    mockLoaderToReturnTexture();
    const bbox = new Box3(new Vector3(-10, 5, -10), new Vector3(10, 25, 10));
    const v = buildMockViewport({ modelBbox: bbox });
    const ctl = createPanoramaController(v.handle);
    await ctl.apply(ASSET_A);
    const dome = v.scene.getObjectByName("panorama-dome") as Mesh;
    const disc = v.scene.getObjectByName("panorama-disc") as Mesh;
    expect(dome.position.x).toBe(0);
    expect(dome.position.y).toBe(5);
    expect(dome.position.z).toBe(0);
    expect(disc.position.y).toBe(5);
  });

  it("V7: dome+disc radius is 50 m by default (panoramaScale = 1.0)", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    const ctl = createPanoramaController(v.handle);
    await ctl.apply(ASSET_A);
    const dome = v.scene.getObjectByName("panorama-dome") as Mesh;
    const disc = v.scene.getObjectByName("panorama-disc") as Mesh;
    /* SphereGeometry parameters expose .radius. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((dome.geometry as any).parameters?.radius as number) ?? 0).toBe(50);
    /* RingGeometry parameters expose .outerRadius. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((disc.geometry as any).parameters?.outerRadius as number) ?? 0).toBe(50);
  });

  it("V7: panoramaScale on the asset multiplies into the radius (asset_B uses 2x)", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    const ctl = createPanoramaController(v.handle);
    await ctl.apply(ASSET_B); /* panoramaScale: 2.0 */
    const dome = v.scene.getObjectByName("panorama-dome") as Mesh;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((dome.geometry as any).parameters?.radius as number) ?? 0).toBe(100);
  });

  it("apply unmounts Tier 2 when adapter reports it is mounted", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    let mounted = true;
    const tier2 = {
      isMounted: () => mounted,
      unmount: () => {
        mounted = false;
      },
      remount: async () => {
        mounted = true;
      },
    };
    const ctl = createPanoramaController(v.handle, tier2);
    await ctl.apply(ASSET_A);
    expect(mounted).toBe(false);
    expect(ctl.getState().tier2WasAutoDisabled).toBe(true);
  });

  it("swap reuses prior saved state and does NOT re-unmount Tier 2", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    let unmountCalls = 0;
    const tier2 = {
      isMounted: () => true,
      unmount: () => {
        unmountCalls += 1;
      },
      remount: async () => {},
    };
    const ctl = createPanoramaController(v.handle, tier2);
    await ctl.apply(ASSET_A);
    await ctl.swap(ASSET_B);
    expect(unmountCalls).toBe(1);
    expect(ctl.getState().slug).toBe("rooftop_day");
  });

  it("V7: swap rebuilds dome+disc with the new asset's panoramaScale (50m → 100m)", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    const ctl = createPanoramaController(v.handle);
    await ctl.apply(ASSET_A);   /* scale 1.0 → 50m */
    let dome = v.scene.getObjectByName("panorama-dome") as Mesh;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((dome.geometry as any).parameters?.radius as number) ?? 0).toBe(50);
    await ctl.swap(ASSET_B);    /* scale 2.0 → 100m */
    dome = v.scene.getObjectByName("panorama-dome") as Mesh;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(((dome.geometry as any).parameters?.radius as number) ?? 0).toBe(100);
  });

  it("V7: apply emits the [panorama-v7] dev-mode diagnostic with bbox/disc/dome Y values", async () => {
    mockLoaderToReturnTexture();
    const bbox = new Box3(new Vector3(-1, 2.5, -1), new Vector3(1, 5, 1));
    const v = buildMockViewport({ modelBbox: bbox });
    const ctl = createPanoramaController(v.handle);
    /* vitest defaults NODE_ENV to "test", so the dev-mode log path
       fires without any env manipulation. */
    expect(process.env.NODE_ENV).not.toBe("production");
    /* eslint-disable no-console */
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await ctl.apply(ASSET_A);
    const v7Calls = logSpy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("[panorama-v7]"),
    );
    expect(v7Calls.length).toBeGreaterThanOrEqual(1);
    const payload = v7Calls[0][1] as Record<string, unknown>;
    expect(payload.slug).toBe("balcony");
    expect(payload.bboxMinY).toBe(2.5);
    expect(payload.discY).toBe(2.5);
    expect(payload.domeY).toBe(2.5);
    expect(payload.radius).toBe(50);
    expect(payload.panoramaScale).toBe(1.0);
    expect(payload.discInnerRadius).toBe(5);
    /* eslint-enable no-console */
  });

  it("reset removes dome+disc, restores BIM original position, restores scene.background, remounts Tier 2", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    const priorBackground = v.scene.background;
    let mounted = true;
    let remounted = false;
    const tier2 = {
      isMounted: () => mounted,
      unmount: () => {
        mounted = false;
      },
      remount: async () => {
        remounted = true;
        mounted = true;
      },
    };
    const ctl = createPanoramaController(v.handle, tier2);
    await ctl.apply(ASSET_A);
    expect(v.scene.getObjectByName("panorama-dome")).toBeDefined();
    expect(v.scene.getObjectByName("panorama-disc")).toBeDefined();

    const r = ctl.reset();
    expect(r.success).toBe(true);
    expect(v.scene.getObjectByName("panorama-dome")).toBeUndefined();
    expect(v.scene.getObjectByName("panorama-disc")).toBeUndefined();
    expect(v.scene.background).toBe(priorBackground);
    expect(v.isBlueprintVisible()).toBe(true);
    expect(v.isPanoramaActive()).toBe(false);
    expect(v.getRestoreCalls()).toBe(1);
    /* remount fires async — wait a tick. */
    await new Promise((r) => setTimeout(r, 0));
    expect(remounted).toBe(true);
  });

  it("reset disposes both dome and disc geometries + materials", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    const ctl = createPanoramaController(v.handle);
    await ctl.apply(ASSET_A);
    const dome = v.scene.getObjectByName("panorama-dome") as Mesh;
    const disc = v.scene.getObjectByName("panorama-disc") as Mesh;
    const domeGeomDispose = vi.spyOn(dome.geometry, "dispose");
    const domeMatDispose = vi.spyOn(dome.material as MeshBasicMaterial, "dispose");
    const discGeomDispose = vi.spyOn(disc.geometry, "dispose");
    const discMatDispose = vi.spyOn(disc.material as MeshBasicMaterial, "dispose");
    ctl.reset();
    expect(domeGeomDispose).toHaveBeenCalled();
    expect(domeMatDispose).toHaveBeenCalled();
    expect(discGeomDispose).toHaveBeenCalled();
    expect(discMatDispose).toHaveBeenCalled();
  });

  it("subscribe fires on every state change; unsubscribe stops calls", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    const ctl = createPanoramaController(v.handle);
    const calls: number[] = [];
    const unsub = ctl.subscribe(() => calls.push(1));
    await ctl.apply(ASSET_A);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    unsub();
    ctl.reset();
    const after = calls.length;
    await ctl.apply(ASSET_A);
    expect(calls.length).toBe(after);
  });

  it("V2 persistence: apply writes only buildflow.panorama.last-applied-slug", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    const ctl = createPanoramaController(v.handle);
    await ctl.apply(ASSET_A);
    expect(window.localStorage.getItem("buildflow.panorama.last-applied-slug")).toBe(
      "balcony",
    );
    expect(window.localStorage.getItem("buildflow.panorama.enabled")).toBeNull();
    expect(window.localStorage.getItem("buildflow.panorama.last-slug")).toBeNull();
    expect(window.localStorage.getItem("buildflow.panorama.last-bucket")).toBeNull();
    expect(getLastAppliedSlug()).toBe("balcony");
  });

  it("V2: reset clears last-applied-slug (full clean slate)", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    const ctl = createPanoramaController(v.handle);
    await ctl.apply(ASSET_A);
    expect(getLastAppliedSlug()).toBe("balcony");
    ctl.reset();
    expect(getLastAppliedSlug()).toBeNull();
    expect(window.localStorage.getItem("buildflow.panorama.last-applied-slug")).toBeNull();
  });

  it("pickPreselectedAsset prefers last-applied-slug when valid, otherwise first asset of detected bucket", () => {
    /* Use a slug that lives in `residential-apartment` bucket so we can
       verify the cross-bucket lookup (last-applied-slug is searched
       across the whole manifest, not just the detected bucket). */
    window.localStorage.setItem(
      "buildflow.panorama.last-applied-slug",
      "wide_street_01",
    );
    const a = pickPreselectedAsset("office");
    expect(a?.slug).toBe("wide_street_01");
    expect(a?.bucket).toBe("residential-apartment");

    window.localStorage.removeItem("buildflow.panorama.last-applied-slug");
    const b = pickPreselectedAsset("office");
    expect(b?.bucket).toBe("office");
  });

  it("pickPreselectedAsset wipes stale last-applied-slug when the slug no longer exists in the manifest (manifest-version migration)", () => {
    /* Simulate a user upgrading from a previous manifest where "balcony"
       was a valid slug. The new manifest doesn't have it. The function
       should fall back to the detected bucket's first asset AND clear
       the stale LS so it doesn't linger forever. */
    window.localStorage.setItem(
      "buildflow.panorama.last-applied-slug",
      "balcony",
    );
    const a = pickPreselectedAsset("residential-apartment");
    /* Returns the new first asset of the detected bucket. */
    expect(a?.bucket).toBe("residential-apartment");
    expect(a?.slug).not.toBe("balcony");
    /* LS is wiped so the next call starts clean. */
    expect(window.localStorage.getItem("buildflow.panorama.last-applied-slug")).toBeNull();
  });

  it("keepTier2Anyway forces Tier 2 back on and clears the auto-disable flag", async () => {
    mockLoaderToReturnTexture();
    const v = buildMockViewport();
    let mounted = true;
    let remountCalls = 0;
    const tier2 = {
      isMounted: () => mounted,
      unmount: () => {
        mounted = false;
      },
      remount: async () => {
        remountCalls += 1;
        mounted = true;
      },
    };
    const ctl = createPanoramaController(v.handle, tier2);
    await ctl.apply(ASSET_A);
    expect(ctl.getState().tier2WasAutoDisabled).toBe(true);
    await ctl.keepTier2Anyway();
    expect(remountCalls).toBe(1);
    expect(ctl.getState().tier2WasAutoDisabled).toBe(false);
  });
});
