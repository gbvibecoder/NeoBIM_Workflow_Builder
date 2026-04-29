/**
 * DOCX text extractor for the Brief-to-Renders pipeline.
 *
 * Uses `mammoth` to produce both:
 *   • `html` — preserves table structure (load-bearing because Marx12-style
 *     briefs put apartment/shot data in tables; flattening loses row mapping).
 *   • `rawText` — fallback for the spec extractor when HTML is too noisy.
 *
 * `mammoth` is loaded via lazy `require()` (mirroring the pattern used in
 * `tr-001.ts` for `pdf-parse`) so that:
 *   1. TypeScript doesn't try to statically resolve the module — Phase 2
 *      ships the dep declaration in `package.json` but the install hasn't
 *      been run yet (Rutik runs `npm install` before testing).
 *   2. Build / type-check on a tree without `mammoth` in `node_modules`
 *      doesn't fail. The runtime import only fires if `extractDocxText`
 *      is actually called — and at that point Rutik has installed.
 *
 * Throws `EmptyDocxError` when neither the HTML body nor the raw text
 * contain any usable content.
 */

import { EmptyDocxError } from "../errors";

/** Minimal mammoth surface we use. Fields match the public API. */
interface MammothResult {
  value: string;
  messages: ReadonlyArray<{ type: string; message: string }>;
}

interface MammothModule {
  convertToHtml(input: { buffer: Buffer }): Promise<MammothResult>;
  extractRawText(input: { buffer: Buffer }): Promise<MammothResult>;
}

import { createRequire } from "node:module";

// `createRequire` produces a Node-native CJS require that works inside
// ESM modules. Replaces the previous `(0, eval)("require")` pattern,
// which throws `ReferenceError: require is not defined` at runtime in
// Next.js's ESM-bundled API routes (modern Node.js doesn't expose a
// global `require`). Build-time tree-shaking is unaffected — Webpack
// /Turbopack don't statically analyze `createRequire(...)` calls, so
// `mammoth` remains a runtime resolution.
const requireCjs = createRequire(import.meta.url);

let _cachedMammoth: MammothModule | null = null;

function loadMammoth(): MammothModule {
  if (_cachedMammoth) return _cachedMammoth;
  const mod = requireCjs("mammoth") as MammothModule;
  _cachedMammoth = mod;
  return mod;
}

/** Test seam — replace the loaded mammoth module. Restore by passing `null`. */
let _mammothOverride: MammothModule | null = null;
export function _setMammothForTest(mod: MammothModule | null): void {
  _mammothOverride = mod;
  // Reset the cache so next load picks up override / real module.
  _cachedMammoth = null;
}

/**
 * Extract structural HTML + raw text from a DOCX buffer.
 *
 * @throws {EmptyDocxError} when neither output contains usable content.
 * @throws Generic Error when mammoth itself throws (corrupt DOCX).
 */
export async function extractDocxText(
  docxBuffer: Buffer | Uint8Array,
): Promise<{ html: string; rawText: string }> {
  const buf = docxBuffer instanceof Buffer ? docxBuffer : Buffer.from(docxBuffer);
  const mammoth = _mammothOverride ?? loadMammoth();

  // Run both conversions in parallel — they read the same buffer
  // independently and combined wall time is ~half of sequential.
  const [htmlResult, rawResult] = await Promise.all([
    mammoth.convertToHtml({ buffer: buf }),
    mammoth.extractRawText({ buffer: buf }),
  ]);

  const html = htmlResult.value ?? "";
  const rawText = rawResult.value ?? "";

  if (html.trim().length === 0 && rawText.trim().length === 0) {
    throw new EmptyDocxError(
      "DOCX yielded no HTML or raw text. The file may be corrupt or empty.",
    );
  }

  return { html, rawText };
}
