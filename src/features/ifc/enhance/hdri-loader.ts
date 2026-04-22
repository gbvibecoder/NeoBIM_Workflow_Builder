/* ─── IFC Enhance — HDRI loader ───────────────────────────────────────────
   Loads an .exr, runs it through PMREM, and returns a texture ready to
   assign to scene.environment. Returning the PMREM-processed texture (NOT
   the raw equirect) avoids the "one frame of wrong lighting" flash that
   happens if the async PMREM is triggered by scene.environment=... */

import {
  FloatType,
  PMREMGenerator,
  type Texture,
  type WebGLRenderer,
} from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { HDRI_PATHS } from "./constants";
import type { HDRIPreset } from "./types";

/** preset → PMREM-processed env texture. */
const cache = new Map<HDRIPreset, Texture>();

function loadEXR(url: string): Promise<Texture> {
  const loader = new EXRLoader();
  /* Poly Haven daylight EXRs carry direct-sun pixel values > 65504 (the
     half-float max). EXRLoader defaults to HalfFloatType output, which
     triggers `THREE.DataUtils.toHalfFloat(): Value out of range` warnings
     once per out-of-range pixel during load (6+ per sky on `day.exr`).
     Loading as FloatType preserves precision and skips the down-conversion
     entirely — PMREMGenerator accepts both types and bakes to a small cube
     afterwards, so the extra precision only lives in memory momentarily. */
  loader.setDataType(FloatType);
  return new Promise<Texture>((resolve, reject) => {
    loader.load(
      url,
      (tex) => resolve(tex),
      undefined,
      (err) => reject(new Error(`Failed to load HDRI ${url}: ${err instanceof ErrorEvent ? err.message : String(err)}`)),
    );
  });
}

/**
 * Load (or reuse cached) HDRI and pre-process through PMREM. The raw EXR is
 * disposed after PMREM is done; only the PMREM result is retained.
 */
export async function loadHDRI(
  preset: HDRIPreset,
  renderer: WebGLRenderer,
): Promise<Texture> {
  const cached = cache.get(preset);
  if (cached) return cached;

  const url = HDRI_PATHS[preset];
  const rawEnv = await loadEXR(url);

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envRT = pmrem.fromEquirectangular(rawEnv);
  const processed = envRT.texture;

  /* PMREM is done — dispose the raw EXR (we only need the cube). The
     generator itself can be disposed; the output texture survives. */
  rawEnv.dispose();
  pmrem.dispose();

  cache.set(preset, processed);
  return processed;
}

export function disposeHDRICache(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}

export function isHDRICached(preset: HDRIPreset): boolean {
  return cache.has(preset);
}
