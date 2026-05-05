/* ─── Panorama feature — texture loader (V1) ───────────────────────────────
   Loads an equirectangular JPG and configures it for use on a panoramic
   inverted sphere. Reference-counted cache so swapping between two
   panoramas without unmounting the controller doesn't cause a second
   network fetch.

   We deliberately use `THREE.TextureLoader` — NOT `EXRLoader` and NOT a
   PMREM round-trip. PMREM is required for IBL / reflections (that's what
   Tier 1's HDRI-loader does for `scene.environment`); the panorama only
   feeds the BackSide-sphere's `map` slot, which the renderer samples
   directly without pre-filtering. Skipping PMREM is the entire reason
   JPG-as-backdrop is cheap. */

import {
  TextureLoader,
  EquirectangularReflectionMapping,
  SRGBColorSpace,
  LinearFilter,
  type Texture,
} from "three";

interface CacheEntry {
  texture: Texture;
  /** How many `loadPanorama` calls are still holding this texture. */
  refCount: number;
}

const cache = new Map<string, CacheEntry>();

function loadFromNetwork(url: string, signal?: AbortSignal): Promise<Texture> {
  const loader = new TextureLoader();
  return new Promise<Texture>((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    loader.load(
      url,
      (tex) => {
        signal?.removeEventListener("abort", onAbort);
        if (aborted) {
          /* Race: load completed while abort fired in the same microtask. */
          tex.dispose();
          return;
        }
        tex.mapping = EquirectangularReflectionMapping;
        tex.colorSpace = SRGBColorSpace;
        tex.minFilter = LinearFilter;
        tex.magFilter = LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      (err) => {
        signal?.removeEventListener("abort", onAbort);
        const message = err instanceof ErrorEvent ? err.message : String(err);
        reject(new Error(`Failed to load panorama ${url}: ${message}`));
      },
    );
  });
}

/**
 * Load (or reuse cached) equirectangular panorama texture. Refcount is
 * incremented on every successful call — every successful call must be
 * paired with a `disposePanorama` once the consumer is done.
 */
export async function loadPanorama(
  url: string,
  signal?: AbortSignal,
): Promise<Texture> {
  const cached = cache.get(url);
  if (cached) {
    cached.refCount += 1;
    return cached.texture;
  }

  const texture = await loadFromNetwork(url, signal);
  /* Recheck the cache: a parallel call may have populated it while we were
     awaiting. Avoid a leak by using whichever entry landed first. */
  const now = cache.get(url);
  if (now) {
    texture.dispose();
    now.refCount += 1;
    return now.texture;
  }
  cache.set(url, { texture, refCount: 1 });
  return texture;
}

/**
 * Drop one reference to a cached panorama texture. When refcount falls to
 * zero the texture is `.dispose()`d and removed from the cache.
 */
export function disposePanorama(texture: Texture): void {
  for (const [url, entry] of cache.entries()) {
    if (entry.texture !== texture) continue;
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      texture.dispose();
      cache.delete(url);
    }
    return;
  }
  /* Texture wasn't in cache — caller is double-disposing or holding a stale
     reference. Just dispose defensively. */
  texture.dispose();
}

/** Internal — for tests only. Resets cache state. */
export function __resetPanoramaCacheForTests(): void {
  for (const entry of cache.values()) entry.texture.dispose();
  cache.clear();
}

/** Internal — for tests only. Reports cache size. */
export function __panoramaCacheSizeForTests(): number {
  return cache.size;
}
