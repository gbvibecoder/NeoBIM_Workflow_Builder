import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  EquirectangularReflectionMapping,
  LinearFilter,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";

import {
  loadPanorama,
  disposePanorama,
  __resetPanoramaCacheForTests,
  __panoramaCacheSizeForTests,
} from "@/features/panorama/lib/panorama-loader";

/* TextureLoader.load is synchronous-callback-style; we mock it to return
   fresh Texture instances synchronously via the success callback. */
function mockTextureLoader() {
  const calls: string[] = [];
  vi.spyOn(TextureLoader.prototype, "load").mockImplementation(function (
    this: TextureLoader,
    url: string,
    onLoad?: (tex: Texture<HTMLImageElement>) => void,
  ) {
    calls.push(url);
    /* Defer to next microtask so `await` boundaries behave like real loads. */
    queueMicrotask(() => {
      const tex = new Texture() as unknown as Texture<HTMLImageElement>;
      // The mocked Texture's dispose method is real; spy on each instance.
      onLoad?.(tex);
    });
    return new Texture() as unknown as Texture<HTMLImageElement>;
  });
  return { calls };
}

describe("panorama-loader", () => {
  beforeEach(() => {
    __resetPanoramaCacheForTests();
    vi.restoreAllMocks();
  });

  it("sets equirectangular mapping, sRGB color space, and disables mipmaps", async () => {
    mockTextureLoader();
    const tex = await loadPanorama("/panoramas/test/a.jpg");
    expect(tex.mapping).toBe(EquirectangularReflectionMapping);
    expect(tex.colorSpace).toBe(SRGBColorSpace);
    expect(tex.minFilter).toBe(LinearFilter);
    expect(tex.generateMipmaps).toBe(false);
  });

  it("caches by URL — second load of same URL reuses the texture and skips the network", async () => {
    const { calls } = mockTextureLoader();
    const a = await loadPanorama("/panoramas/test/a.jpg");
    const b = await loadPanorama("/panoramas/test/a.jpg");
    expect(a).toBe(b);
    expect(calls.length).toBe(1);
    expect(__panoramaCacheSizeForTests()).toBe(1);
  });

  it("disposes only when refcount hits zero", async () => {
    mockTextureLoader();
    const tex = await loadPanorama("/panoramas/test/a.jpg");
    await loadPanorama("/panoramas/test/a.jpg");
    const disposeSpy = vi.spyOn(tex, "dispose");
    disposePanorama(tex);
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(__panoramaCacheSizeForTests()).toBe(1);
    disposePanorama(tex);
    expect(disposeSpy).toHaveBeenCalledOnce();
    expect(__panoramaCacheSizeForTests()).toBe(0);
  });

  it("aborts mid-load with AbortError and disposes the in-flight texture", async () => {
    /* Custom mock that never calls onLoad — so the abort is the only path. */
    vi.spyOn(TextureLoader.prototype, "load").mockImplementation(function (
      this: TextureLoader,
    ) {
      return new Texture() as unknown as Texture<HTMLImageElement>;
    });
    const ctrl = new AbortController();
    const promise = loadPanorama("/panoramas/test/never.jpg", ctrl.signal);
    ctrl.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts a pre-aborted signal synchronously", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      loadPanorama("/panoramas/test/x.jpg", ctrl.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
