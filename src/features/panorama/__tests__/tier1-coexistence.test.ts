/* @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  Color,
  Group,
  type Mesh,
  PerspectiveCamera,
  Scene,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from "three";

import {
  createPanoramaController,
} from "@/features/panorama/lib/panorama-controller";

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

const ASSET: PanoramaAsset = {
  slug: "balcony",
  bucket: "residential-apartment",
  displayName: "Apt Balcony",
  fileName: "balcony.jpg",
  fileSizeBytes: 1_500_000,
  source: "polyhaven",
  license: "CC0",
  horizonRow: 0.5,
  groundAnchorDistance: 5,
  groundAnchorPixelXY: { x: 0.5, y: 0.85 },
};

function buildHarness() {
  const scene = new Scene();
  scene.background = new Color(0xf6f7f9);
  /* Tier 1 owns scene.environment: simulate the post-Tier-1 state by
     pre-assigning an HDRI texture before panorama applies. */
  const hdriTexture = new Texture();
  scene.environment = hdriTexture;
  const camera = new PerspectiveCamera();
  const renderer = { dispose: () => {} } as unknown as WebGLRenderer;
  const modelGroup = new Group();
  let blueprintVisible = true;
  let panoramaActive = false;

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
    getModelBoundingBox: () => null,
    getSlabMeshes: () => [],
    translateModelTo: (pos: Vector3) => {
      modelGroup.position.copy(pos);
    },
    restoreModelPosition: () => {
      modelGroup.position.set(0, 0, 0);
    },
  };

  return { handle, scene, hdriTexture };
}

describe("Tier 1 + V6 panorama coexistence", () => {
  beforeEach(() => {
    __resetPanoramaCacheForTests();
    installInMemoryLocalStorage();
    vi.restoreAllMocks();
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
  });

  it("after panorama apply, scene.environment is unchanged (Tier 1 HDRI) and dome+disc are mesh children of scene", async () => {
    const h = buildHarness();
    const ctl = createPanoramaController(h.handle);
    await ctl.apply(ASSET);
    /* Tier 1 still owns scene.environment — PBR reflections work. */
    expect(h.scene.environment).toBe(h.hdriTexture);
    /* V6: visible backdrop is the dome+disc mesh pair, not scene.background. */
    expect(h.scene.background).toBeNull();
    const dome = h.scene.getObjectByName("panorama-dome") as Mesh | undefined;
    const disc = h.scene.getObjectByName("panorama-disc") as Mesh | undefined;
    expect(dome).toBeDefined();
    expect(disc).toBeDefined();
  });

  it("after panorama reset, scene.background reverts to prior and scene.environment still holds Tier 1 HDRI", async () => {
    const h = buildHarness();
    const priorBackground = h.scene.background;
    const ctl = createPanoramaController(h.handle);
    await ctl.apply(ASSET);
    ctl.reset();
    expect(h.scene.background).toBe(priorBackground);
    expect(h.scene.getObjectByName("panorama-dome")).toBeUndefined();
    expect(h.scene.getObjectByName("panorama-disc")).toBeUndefined();
    /* Tier 1 still active. */
    expect(h.scene.environment).toBe(h.hdriTexture);
  });

  it("isPanoramaActive() returns true between apply and reset, false otherwise", async () => {
    const h = buildHarness();
    const ctl = createPanoramaController(h.handle);
    expect(h.handle.isPanoramaActive()).toBe(false);
    await ctl.apply(ASSET);
    expect(h.handle.isPanoramaActive()).toBe(true);
    ctl.reset();
    expect(h.handle.isPanoramaActive()).toBe(false);
  });
});
