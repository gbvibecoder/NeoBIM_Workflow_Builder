/**
 * KOS BIM (Week 5A) — pure filename → SKU / category / accessory-type
 * classifiers for the Dincel/Kalzen family package. No I/O — safe to
 * unit-test and to call from the dry-run path without touching APS or the
 * database.
 *
 * The Dincel package is organised into four folders:
 *   profiles/   → vertical PANEL components   → KosBimPanelType
 *   vertical/   → vertical ACCESSORY parts    → KosBimAccessory
 *   horizontal/ → horizontal ACCESSORY parts  → KosBimAccessory
 *   systems/    → ASSEMBLY definitions         → KosBimAssembly
 *   <root>.dwg  → REFERENCE catalog drawing    → family row only
 *
 * Filenames carry the SKU after an optional "<Word>_" prefix, e.g.
 * "Profile_DIN-200P-1.rfa" or "Corner_DIN_110P-3.rfa". Some files use an
 * underscore separator after DIN ("DIN_110P-3") which we normalise to a
 * hyphen so every SKU lands in the canonical "DIN-<size>-<variant>" form.
 */

import type {
  KosBimAccessoryType,
  KosBimFamilyCategory,
} from "@prisma/client";
import {
  KOS_BIM_MIME_BY_EXTENSION,
  SUPPORTED_BIM_EXTENSIONS,
  type SupportedBimExtension,
} from "@/features/kos/lib/kos-bim-constants";

/** Strip any directory and the final extension. */
function baseName(filename: string): string {
  return filename.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
}

/** Lower-cased extension including the dot, e.g. ".rfa". "" if none. */
export function fileExtension(filename: string): string {
  const m = filename.toLowerCase().match(/\.[^.\\/]+$/);
  return m ? m[0] : "";
}

export function isSupportedBimExtension(
  ext: string,
): ext is SupportedBimExtension {
  return (SUPPORTED_BIM_EXTENSIONS as readonly string[]).includes(
    ext.toLowerCase(),
  );
}

/** APS content type for a source extension; octet-stream as a safe default. */
export function mimeTypeForExtension(ext: string): string {
  return KOS_BIM_MIME_BY_EXTENSION[ext.toLowerCase()] ?? "application/octet-stream";
}

/**
 * Extract the canonical SKU code from a family filename.
 *
 *   "Profile_DIN-200P-1.rfa" → "DIN-200P-1"
 *   "Track_DIN-110P-EG.rfa"  → "DIN-110P-EG"
 *   "Corner_DIN_110P-3.rfa"  → "DIN-110P-3"   (underscore normalised)
 *   "DIN-200P-Standard.rfa"  → "DIN-200P-Standard"
 *   "EndCap_DIN_200P-EC.rfa" → "DIN-200P-EC"
 *   "Finishes_DIN.rfa"       → "DIN"
 */
export function extractSkuFromFilename(filename: string): string {
  const base = baseName(filename);
  // Strip a leading "<Word>_" prefix ONLY when it's immediately followed
  // by "DIN" — so "Profile_DIN…" loses "Profile_" but a bare "DIN-…"
  // (systems/) is untouched.
  let sku = base.replace(/^[A-Za-z][A-Za-z]*_(?=DIN)/i, "");
  // Normalise the "DIN_" separator to "DIN-" (Corner_/EndCap_/etc. files).
  sku = sku.replace(/^DIN_/i, "DIN-");
  return sku;
}

const ACCESSORY_PREFIX_MAP: Record<string, KosBimAccessoryType> = {
  track: "TRACK",
  finishes: "FINISH",
  voids: "VOID",
  corner: "CORNER",
  joiner: "JOINER",
  endcap: "END_CAP",
  stopend: "STOP_END",
  spacer: "SPACER",
  angle: "ANGLE",
};

/**
 * Map an accessory filename to its KosBimAccessoryType via its "<Word>_"
 * prefix. Unknown prefixes → OTHER.
 */
export function detectAccessoryType(filename: string): KosBimAccessoryType {
  const prefix = baseName(filename).split("_")[0].toLowerCase();
  return ACCESSORY_PREFIX_MAP[prefix] ?? "OTHER";
}

/**
 * Map a source folder (+ filename for the root .dwg) to its family
 * category.
 *   profiles → PANEL · vertical/horizontal → ACCESSORY · systems →
 *   ASSEMBLY · root .dwg → REFERENCE · anything else → OTHER.
 */
export function detectCategoryFromFolder(
  sourceFolder: string | null | undefined,
  filename: string,
): KosBimFamilyCategory {
  switch (sourceFolder) {
    case "profiles":
      return "PANEL";
    case "vertical":
    case "horizontal":
      return "ACCESSORY";
    case "systems":
      return "ASSEMBLY";
  }
  if (!sourceFolder && fileExtension(filename) === ".dwg") {
    return "REFERENCE";
  }
  return "OTHER";
}
