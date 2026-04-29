/**
 * Font registration for the editorial PDF compile worker.
 *
 * Server-side only — uses `fs.readFileSync` to load TTF assets from
 * `public/fonts/`. The compile worker runs on Vercel Node.js runtime
 * with full filesystem access to the bundled `public/` tree.
 *
 * Phase 5 ships the registration code + a README in `public/fonts/`.
 * Rutik drops the actual `inter-regular.ttf` and `inter-bold.ttf`
 * binaries before deploy; without them, jspdf falls back to its
 * bundled Helvetica (latin-1 / WinAnsi encoding — handles ä, ö, ü, ß
 * but with weaker typographic finish than Inter).
 *
 * Logger-routed warnings on missing TTFs — never `console.*`. The
 * fallback is a quality regression, not a hard failure, so the
 * pipeline continues.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { jsPDF } from "jspdf";

// ─── Constants ──────────────────────────────────────────────────────

/** Font family registered with jspdf when Inter loads successfully. */
export const FONT_FAMILY_INTER = "Inter";

/** Fallback when Inter TTFs are missing — jspdf's bundled Helvetica. */
export const FONT_FAMILY_HELVETICA = "helvetica";

/** Resolved font family — read by composers as the "primary" font. */
export type FontFamily = typeof FONT_FAMILY_INTER | typeof FONT_FAMILY_HELVETICA;

interface InterFontBuffers {
  regular: string;
  bold: string;
}

interface JsPDFLike {
  addFileToVFS(filename: string, base64: string): void;
  addFont(filename: string, family: string, style: string): void;
}

// ─── Buffer loader ──────────────────────────────────────────────────
//
// Lazy `fs.readFileSync` so test environments without TTFs don't
// crash at module import. Returns null when either file is missing.

let _cachedBuffers: InterFontBuffers | null = null;
let _cachedAttempted = false;

export function loadInterFontBuffers(): InterFontBuffers | null {
  if (_cachedBuffers) return _cachedBuffers;
  if (_cachedAttempted) return null;
  _cachedAttempted = true;

  const cwd = process.cwd();
  const regularPath = path.join(cwd, "public", "fonts", "inter-regular.ttf");
  const boldPath = path.join(cwd, "public", "fonts", "inter-bold.ttf");

  try {
    if (!fs.existsSync(regularPath) || !fs.existsSync(boldPath)) {
      return null;
    }
    const regular = fs.readFileSync(regularPath).toString("base64");
    const bold = fs.readFileSync(boldPath).toString("base64");
    _cachedBuffers = { regular, bold };
    return _cachedBuffers;
  } catch {
    return null;
  }
}

/** Reset the load cache. Test-only. */
export function _resetFontCacheForTest(): void {
  _cachedBuffers = null;
  _cachedAttempted = false;
}

// ─── Public API ─────────────────────────────────────────────────────

export interface RegisterFontResult {
  /** Family name to pass to `doc.setFont(...)` after registration. */
  family: FontFamily;
  /** True when Inter TTFs loaded; false when falling back to Helvetica. */
  interLoaded: boolean;
}

/**
 * Register Inter Regular + Bold on the supplied jsPDF doc, or fall
 * back to Helvetica when the TTFs are missing. Returns the resolved
 * font family + a flag indicating whether Inter loaded.
 *
 * The Stage 4 orchestrator inspects `interLoaded === false` and folds
 * the degradation into its own `endStage` summary (we deliberately do
 * NOT log here so this helper remains synchronous + side-effect-free
 * apart from the doc mutation).
 */
export function registerInterFont(doc: jsPDF): RegisterFontResult {
  const buffers = loadInterFontBuffers();
  if (!buffers) {
    return { family: FONT_FAMILY_HELVETICA, interLoaded: false };
  }

  // jspdf's font-registration surface accepts loose `any`-typed args
  // through its type definitions. Cast through a minimal local type
  // (defined above) so this file's public surface stays `any`-free.
  const docAsFontHost = doc as unknown as JsPDFLike;
  docAsFontHost.addFileToVFS("Inter-Regular.ttf", buffers.regular);
  docAsFontHost.addFont("Inter-Regular.ttf", FONT_FAMILY_INTER, "normal");
  docAsFontHost.addFileToVFS("Inter-Bold.ttf", buffers.bold);
  docAsFontHost.addFont("Inter-Bold.ttf", FONT_FAMILY_INTER, "bold");

  return { family: FONT_FAMILY_INTER, interLoaded: true };
}
