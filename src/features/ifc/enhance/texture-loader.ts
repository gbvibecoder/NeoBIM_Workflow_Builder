/* ─── IFC Enhance — PBR texture loader with caching ──────────────────────
   Loads 4–5 Poly Haven maps per PBR spec, applies the correct color space,
   anisotropy and wrapping, and caches by (slug + quality) so re-applying
   never re-downloads. */

import {
  Texture,
  TextureLoader,
  SRGBColorSpace,
  RepeatWrapping,
  LinearMipmapLinearFilter,
  LinearFilter,
  type WebGLRenderer,
} from "three";
import { QUALITY_PRESETS, TEXTURE_SUFFIXES, type PBRSpec } from "./constants";
import type { MaterialQuality } from "./types";

export interface LoadedPBRTextures {
  map: Texture;
  normalMap: Texture;
  roughnessMap: Texture;
  aoMap?: Texture;
  metalnessMap?: Texture;
}

/** slug+quality → cached set of textures. All textures inside stay in GPU. */
const cache = new Map<string, LoadedPBRTextures>();

function cacheKey(spec: PBRSpec, quality: MaterialQuality): string {
  return `${spec.slug}::${quality}`;
}

function loadOne(
  loader: TextureLoader,
  url: string,
  onProgress?: () => void,
): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        onProgress?.();
        resolve(tex);
      },
      undefined,
      (err) => reject(new Error(`Failed to load texture ${url}: ${err instanceof ErrorEvent ? err.message : String(err)}`)),
    );
  });
}

function configureTexture(
  tex: Texture,
  opts: { sRGB: boolean; anisotropy: number },
): Texture {
  if (opts.sRGB) tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.anisotropy = opts.anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Load all maps for the given spec, respecting quality (drops AO on low).
 * `onProgress` fires with a 0..1 fraction as each map completes.
 */
export async function loadPBRTextures(
  spec: PBRSpec,
  quality: MaterialQuality,
  renderer: WebGLRenderer,
  onProgress?: (progress: number) => void,
): Promise<LoadedPBRTextures> {
  const key = cacheKey(spec, quality);
  const cached = cache.get(key);
  if (cached) {
    onProgress?.(1);
    return cached;
  }

  const { anisotropy: requested, useAO } = QUALITY_PRESETS[quality];
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const anisotropy = Math.min(requested, maxAniso);

  const loader = new TextureLoader();
  const base = `${spec.base}/${spec.slug}`;

  /* 3 mandatory maps + optional AO + optional metal. */
  const wantMetal = spec.hasMetal;
  const wantAO = useAO;

  const totalSteps = 3 + (wantAO ? 1 : 0) + (wantMetal ? 1 : 0);
  let completed = 0;
  const tick = () => {
    completed += 1;
    onProgress?.(completed / totalSteps);
  };

  /* Run in parallel — texture decode is GPU-bound and loaders handle it. */
  const [diffuse, rough, normal, aoOrNull, metalOrNull] = await Promise.all([
    loadOne(loader, `${base}${TEXTURE_SUFFIXES.diffuse}`, tick),
    loadOne(loader, `${base}${TEXTURE_SUFFIXES.rough}`, tick),
    loadOne(loader, `${base}${TEXTURE_SUFFIXES.normal}`, tick),
    wantAO ? loadOne(loader, `${base}${TEXTURE_SUFFIXES.ao}`, tick) : Promise.resolve(null),
    wantMetal ? loadOne(loader, `${base}${TEXTURE_SUFFIXES.metal}`, tick) : Promise.resolve(null),
  ]);

  /* CRITICAL color-space handling: diffuse is sRGB; rough/normal/AO/metal
     stay linear. Getting this wrong produces the #1 "why does my PBR look
     washed out" bug. */
  configureTexture(diffuse, { sRGB: true, anisotropy });
  configureTexture(rough, { sRGB: false, anisotropy });
  configureTexture(normal, { sRGB: false, anisotropy });
  if (aoOrNull) configureTexture(aoOrNull, { sRGB: false, anisotropy });
  if (metalOrNull) configureTexture(metalOrNull, { sRGB: false, anisotropy });

  const result: LoadedPBRTextures = {
    map: diffuse,
    roughnessMap: rough,
    normalMap: normal,
    ...(aoOrNull ? { aoMap: aoOrNull } : {}),
    ...(metalOrNull ? { metalnessMap: metalOrNull } : {}),
  };
  cache.set(key, result);
  return result;
}

export function disposeTextureCache(): void {
  for (const set of cache.values()) {
    set.map.dispose();
    set.normalMap.dispose();
    set.roughnessMap.dispose();
    set.aoMap?.dispose();
    set.metalnessMap?.dispose();
  }
  cache.clear();
}

export function getTextureCacheStats(): { count: number; estimatedBytes: number } {
  /* Each 2k JPG ≈ 3–5 MB decoded; 4 maps ≈ 14 MB per spec on GPU. */
  let bytes = 0;
  for (const set of cache.values()) {
    bytes += 5 * 1024 * 1024; // diffuse
    bytes += 4 * 1024 * 1024; // rough
    bytes += 5 * 1024 * 1024; // normal
    if (set.aoMap) bytes += 4 * 1024 * 1024;
    if (set.metalnessMap) bytes += 4 * 1024 * 1024;
  }
  return { count: cache.size, estimatedBytes: bytes };
}
