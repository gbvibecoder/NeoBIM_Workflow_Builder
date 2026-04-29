/**
 * Per-shot page composer.
 *
 * One PDF page per shot. Layout (top → bottom):
 *   1. Apartment header (small, secondary)
 *   2. Hero badge (gold, only when shotIndexInApartment === 0) and
 *      `Shot N of M` (right-aligned)
 *   3. Shot title (large, primary, English room name)
 *   4. Shot subtitle (italic, secondary, German room name)
 *   5. Full-width image — height computed from aspect ratio, scaled
 *      down if it would overflow the available space
 *   6. 3-column metadata: ROOM AREA · ASPECT · LIGHTING
 *   7. Filename block (label + monospace value)
 *
 * Strict-faithfulness: every field is null-safe. Empty source → no
 * render. Aspect ratio falls back to landscape-3-2 only when the source
 * provided no value at all (this is a structural default, not a content
 * default — same exception documented in `image-prompt-template.ts`).
 *
 * Pure function: receives the doc + already-fetched image base64. No
 * I/O. No `Date.now()` / `Math.random()`.
 */

import type { jsPDF } from "jspdf";

import type { ApartmentSpec, ShotSpec } from "../types";
import {
  ASPECT_DEFAULT,
  ASPECT_LANDSCAPE_3_2,
  ASPECT_PORTRAIT_2_3,
  ASPECT_SQUARE_1_1,
  COLOR_HERO_GOLD,
  COLOR_TEXT_PRIMARY,
  COLOR_TEXT_SECONDARY,
  COLOR_TEXT_TERTIARY,
  CONTENT_HEIGHT_MM,
  CONTENT_WIDTH_MM,
  FONT_SIZE_BODY,
  FONT_SIZE_FILENAME_MONO,
  FONT_SIZE_LABEL,
  FONT_SIZE_SHOT_SUBTITLE,
  FONT_SIZE_SHOT_TITLE,
  IMAGE_WIDTH_MM,
  MARGIN_LEFT_MM,
  MARGIN_RIGHT_MM,
  MARGIN_TOP_MM,
  PAGE_WIDTH_MM,
  SPACING_BLOCK_MM,
  SPACING_LINE_MM,
} from "./constants";
import {
  LABEL_ASPECT,
  LABEL_FILENAME_PREFIX,
  LABEL_HERO_SHOT,
  LABEL_LIGHTING,
  LABEL_ROOM_AREA,
  LABEL_SHOT_N_OF_M,
} from "./labels";
import { drawPageFooter } from "./page-chrome";

// ─── Public API ─────────────────────────────────────────────────────

export type ShotImageMimeType = "image/png" | "image/jpeg";

export interface RenderShotPageArgs {
  apartment: ApartmentSpec;
  shot: ShotSpec;
  /** 0-based index of this shot within its apartment (0 → hero badge). */
  shotIndexInApartment: number;
  /** Total shots in this apartment, for the "Shot N of M" label. */
  totalShotsInApartment: number;
  /** Base64-encoded image body (no data: prefix). Caller fetched + decoded. */
  imageBase64: string;
  imageMimeType: ShotImageMimeType;
  /** Brief version for the footer. */
  version: string;
  /** Font family resolved by `pdf-fonts.ts`. */
  fontFamily: string;
}

/**
 * Render the per-shot page on the current jspdf page (caller has
 * already called `addPage()`).
 */
export function renderShotPage(doc: jsPDF, args: RenderShotPageArgs): void {
  const {
    apartment,
    shot,
    shotIndexInApartment,
    totalShotsInApartment,
    imageBase64,
    imageMimeType,
    version,
    fontFamily,
  } = args;

  let cursorY = MARGIN_TOP_MM;

  // ── 1. Apartment header ───────────────────────────────────────
  const aptHeader = composeApartmentHeader(apartment);
  if (aptHeader.length > 0) {
    doc.setFont(fontFamily, "normal");
    doc.setFontSize(FONT_SIZE_LABEL);
    doc.setTextColor(COLOR_TEXT_TERTIARY);
    doc.text(aptHeader, MARGIN_LEFT_MM, cursorY);
    cursorY += SPACING_BLOCK_MM;
  }

  // ── 2. Hero badge + Shot N of M ───────────────────────────────
  const isHero = shotIndexInApartment === 0;
  if (isHero) {
    doc.setFont(fontFamily, "bold");
    doc.setFontSize(FONT_SIZE_LABEL);
    doc.setTextColor(COLOR_HERO_GOLD);
    doc.text(LABEL_HERO_SHOT, MARGIN_LEFT_MM, cursorY);
  }
  doc.setFont(fontFamily, "normal");
  doc.setFontSize(FONT_SIZE_LABEL);
  doc.setTextColor(COLOR_TEXT_TERTIARY);
  doc.text(
    LABEL_SHOT_N_OF_M(shotIndexInApartment + 1, totalShotsInApartment),
    PAGE_WIDTH_MM - MARGIN_RIGHT_MM,
    cursorY,
    { align: "right" },
  );
  cursorY += SPACING_BLOCK_MM;

  // ── 3. Shot title (English) ───────────────────────────────────
  if (presentString(shot.roomNameEn)) {
    doc.setFont(fontFamily, "bold");
    doc.setFontSize(FONT_SIZE_SHOT_TITLE);
    doc.setTextColor(COLOR_TEXT_PRIMARY);
    cursorY += FONT_SIZE_SHOT_TITLE * 0.4;
    doc.text(shot.roomNameEn.trim(), MARGIN_LEFT_MM, cursorY);
    cursorY += SPACING_BLOCK_MM;
  }

  // ── 4. Shot subtitle (German) ─────────────────────────────────
  if (presentString(shot.roomNameDe)) {
    doc.setFont(fontFamily, "italic");
    doc.setFontSize(FONT_SIZE_SHOT_SUBTITLE);
    doc.setTextColor(COLOR_TEXT_SECONDARY);
    doc.text(shot.roomNameDe.trim(), MARGIN_LEFT_MM, cursorY);
    cursorY += SPACING_BLOCK_MM;
  }

  // ── 5. Image ──────────────────────────────────────────────────
  cursorY += SPACING_BLOCK_MM;
  const { widthMm, heightMm } = computeImageDimensions(
    shot.aspectRatio,
    cursorY,
  );
  const imageDataUri = `data:${imageMimeType};base64,${imageBase64}`;
  // jspdf accepts the format hint as the second positional argument;
  // we pass uppercase per its expected enum values.
  doc.addImage(
    imageDataUri,
    imageMimeType === "image/png" ? "PNG" : "JPEG",
    MARGIN_LEFT_MM,
    cursorY,
    widthMm,
    heightMm,
  );
  cursorY += heightMm + SPACING_BLOCK_MM;

  // ── 6. Three-column metadata ──────────────────────────────────
  cursorY = drawMetadataRow(doc, fontFamily, shot, cursorY);

  // ── 7. Filename block ─────────────────────────────────────────
  cursorY += SPACING_BLOCK_MM;
  drawFilenameBlock(
    doc,
    fontFamily,
    apartment,
    shot,
    shotIndexInApartment,
    cursorY,
  );

  // Footer (placeholder page numbers — backfilled later).
  drawPageFooter(doc, { version });
}

// ─── Helpers ────────────────────────────────────────────────────────

function presentString(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function presentNumber(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Compose the apartment header line null-safely:
 *   `${label} · ${bedrooms}BR/${bathrooms}BA · ${area} m² · ${desc}`
 * with `·` separators only between present fields.
 */
function composeApartmentHeader(apt: ApartmentSpec): string {
  const parts: string[] = [];
  if (presentString(apt.label)) parts.push(apt.label.trim());
  const layout: string[] = [];
  if (presentNumber(apt.bedrooms)) layout.push(`${apt.bedrooms}BR`);
  if (presentNumber(apt.bathrooms)) layout.push(`${apt.bathrooms}BA`);
  if (layout.length > 0) parts.push(layout.join("/"));
  if (presentNumber(apt.totalAreaSqm)) parts.push(`${apt.totalAreaSqm} m²`);
  if (presentString(apt.description)) parts.push(apt.description.trim());
  return parts.join(" · ");
}

/**
 * Compute the image's rendered (width, height) in mm. Width is fixed
 * at IMAGE_WIDTH_MM; height = width / aspect (where aspect is W/H).
 *
 * If the natural height would push the image past the bottom margin
 * (CONTENT_HEIGHT_MM minus already-consumed cursor), scales BOTH
 * dimensions down proportionally so the image fits.
 *
 * Aspect-ratio fallback: when `shot.aspectRatio` is null, defaults to
 * landscape 3:2 — same structural default as the prompt-gen template.
 */
function computeImageDimensions(
  aspectRatioInput: string | null | undefined,
  cursorY: number,
): { widthMm: number; heightMm: number } {
  const aspect = parseAspectRatio(aspectRatioInput);
  const naturalWidth = IMAGE_WIDTH_MM;
  const naturalHeight = naturalWidth / aspect;

  // Reserve roughly 60 mm for the metadata + filename + footer below
  // the image. Without the reservation a portrait could push the
  // metadata off-page.
  const RESERVED_BELOW_MM = 60;
  const availableHeight =
    CONTENT_HEIGHT_MM + MARGIN_TOP_MM - cursorY - RESERVED_BELOW_MM;

  if (naturalHeight <= availableHeight || availableHeight <= 0) {
    return { widthMm: naturalWidth, heightMm: naturalHeight };
  }

  // Scale both axes down to fit.
  const scale = availableHeight / naturalHeight;
  return {
    widthMm: naturalWidth * scale,
    heightMm: naturalHeight * scale,
  };
}

function parseAspectRatio(input: string | null | undefined): number {
  if (!presentString(input)) return ASPECT_DEFAULT;
  const trimmed = input.trim();
  switch (trimmed) {
    case "1:1":
      return ASPECT_SQUARE_1_1;
    case "3:2":
    case "16:9":
      return ASPECT_LANDSCAPE_3_2;
    case "2:3":
    case "9:16":
      return ASPECT_PORTRAIT_2_3;
    default:
      return ASPECT_DEFAULT;
  }
}

/**
 * Display version of an aspect ratio for the metadata column.
 *
 *   "3:2"  → "Landscape 3:2"
 *   "2:3"  → "Portrait 2:3"
 *   "1:1"  → "Square 1:1"
 *   null   → ""
 */
function aspectDisplayLabel(input: string | null | undefined): string {
  if (!presentString(input)) return "";
  const trimmed = input.trim();
  switch (trimmed) {
    case "1:1":
      return "Square 1:1";
    case "3:2":
      return "Landscape 3:2";
    case "16:9":
      return "Landscape 16:9";
    case "2:3":
      return "Portrait 2:3";
    case "9:16":
      return "Portrait 9:16";
    default:
      return trimmed;
  }
}

function drawMetadataRow(
  doc: jsPDF,
  fontFamily: string,
  shot: ShotSpec,
  startY: number,
): number {
  const cols = [
    {
      label: LABEL_ROOM_AREA,
      value: presentNumber(shot.areaSqm) ? `${shot.areaSqm} m²` : "",
    },
    {
      label: LABEL_ASPECT,
      value: aspectDisplayLabel(shot.aspectRatio),
    },
    {
      label: LABEL_LIGHTING,
      value: presentString(shot.lightingDescription)
        ? shot.lightingDescription.trim()
        : "",
    },
  ];
  const colWidth = CONTENT_WIDTH_MM / cols.length;

  doc.setFont(fontFamily, "bold");
  doc.setFontSize(FONT_SIZE_LABEL);
  doc.setTextColor(COLOR_TEXT_TERTIARY);
  for (let i = 0; i < cols.length; i++) {
    doc.text(cols[i].label, MARGIN_LEFT_MM + colWidth * i, startY);
  }

  doc.setFont(fontFamily, "normal");
  doc.setFontSize(FONT_SIZE_BODY);
  doc.setTextColor(COLOR_TEXT_PRIMARY);
  const valueY = startY + SPACING_BLOCK_MM;
  for (let i = 0; i < cols.length; i++) {
    const wrapped = doc.splitTextToSize(
      cols[i].value,
      colWidth - SPACING_LINE_MM,
    );
    const firstLine =
      Array.isArray(wrapped) && wrapped.length > 0 ? wrapped[0] : "";
    doc.text(firstLine, MARGIN_LEFT_MM + colWidth * i, valueY);
  }

  return valueY + SPACING_BLOCK_MM;
}

function drawFilenameBlock(
  doc: jsPDF,
  fontFamily: string,
  apt: ApartmentSpec,
  shot: ShotSpec,
  shotIndexInApartment: number,
  startY: number,
): void {
  doc.setFont(fontFamily, "bold");
  doc.setFontSize(FONT_SIZE_LABEL);
  doc.setTextColor(COLOR_TEXT_TERTIARY);
  doc.text(LABEL_FILENAME_PREFIX, MARGIN_LEFT_MM, startY);

  const filename = composeFilename(apt, shot, shotIndexInApartment);
  if (filename.length > 0) {
    doc.setFont(fontFamily, "normal");
    doc.setFontSize(FONT_SIZE_FILENAME_MONO);
    doc.setTextColor(COLOR_TEXT_PRIMARY);
    doc.text(filename, MARGIN_LEFT_MM, startY + SPACING_BLOCK_MM);
  }
}

/**
 * Synthesise a canonical filename when the source brief doesn't supply
 * one. Matches the reference layout's `MARX12_WE01bb_S1_KitchenDining_v01`
 * shape — composed from the apartment label + shot index + room name.
 *
 * Returns `""` when neither label nor room name is present (rather than
 * inventing a placeholder), preserving strict-faithfulness.
 */
function composeFilename(
  apt: ApartmentSpec,
  shot: ShotSpec,
  shotIndexInApartment: number,
): string {
  const tokens: string[] = [];
  if (presentString(apt.label)) {
    tokens.push(apt.label.trim().replace(/\s+/g, ""));
  }
  tokens.push(`S${shotIndexInApartment + 1}`);
  if (presentString(shot.roomNameEn)) {
    tokens.push(
      shot.roomNameEn
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, "")
        .slice(0, 32),
    );
  }
  if (tokens.length <= 1) return ""; // only the auto S-tag, nothing meaningful
  return tokens.join("_");
}
