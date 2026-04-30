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

  // ── 1. Header row 1 — apartment label (left) | hero badge (right) ──
  // Bold apartment label as the primary anchor, larger than the
  // tertiary stats line below it. Mirrors the reference layout where
  // "WE 01bb" gets visual weight on its own line.
  const aptLabel = presentString(apartment.label) ? apartment.label.trim() : "";
  const isHero = shotIndexInApartment === 0;
  const headerRow1Y = cursorY + FONT_SIZE_SHOT_SUBTITLE * 0.4;
  if (aptLabel.length > 0) {
    doc.setFont(fontFamily, "bold");
    doc.setFontSize(FONT_SIZE_SHOT_SUBTITLE);
    doc.setTextColor(COLOR_TEXT_PRIMARY);
    doc.text(aptLabel, MARGIN_LEFT_MM, headerRow1Y);
  }
  if (isHero) {
    drawHeroBadge(doc, fontFamily, headerRow1Y);
  }
  cursorY = headerRow1Y + SPACING_LINE_MM;

  // ── 2. Header row 2 — compact stats (left) | shot N of M (right) ──
  const aptStats = composeApartmentStats(apartment);
  const headerRow2Y = cursorY + SPACING_BLOCK_MM;
  if (aptStats.length > 0) {
    doc.setFont(fontFamily, "normal");
    doc.setFontSize(FONT_SIZE_LABEL);
    doc.setTextColor(COLOR_TEXT_TERTIARY);
    doc.text(aptStats, MARGIN_LEFT_MM, headerRow2Y);
  }
  doc.setFont(fontFamily, "normal");
  doc.setFontSize(FONT_SIZE_LABEL);
  doc.setTextColor(COLOR_TEXT_TERTIARY);
  doc.text(
    LABEL_SHOT_N_OF_M(shotIndexInApartment + 1, totalShotsInApartment),
    PAGE_WIDTH_MM - MARGIN_RIGHT_MM,
    headerRow2Y,
    { align: "right" },
  );
  cursorY = headerRow2Y + SPACING_BLOCK_MM;

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

  // ── 4b. Visual Notes paragraph (between subtitle and image) ──
  // Distils the shot's per-frame creative direction into a
  // client-readable paragraph so the image isn't alone on the page
  // without context. Sources: materialNotes + cameraDescription
  // (lighting stays in the metadata strip below the image so we
  // don't duplicate it). Empty when both sources are null —
  // strict-faithfulness, no synthesised filler.
  cursorY = drawVisualNotes(doc, fontFamily, shot, cursorY);

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
 * Compose the second header line — compact stats, NO apartment label
 * (which lives on row 1).
 *
 * Format: `${shortDescription} • ${area} m² • ${persona}`
 *
 * The full `apt.description` from a real brief tends to dump multiple
 * sentences (room count + cardinal location + façade + persona). We
 * intentionally distill:
 *   • shortDescription = first sentence of the description (room count)
 *   • persona          = parsed out of "Target persona: X" if present
 * so the header doesn't crowd into the title below it.
 */
function composeApartmentStats(apt: ApartmentSpec): string {
  const parts: string[] = [];
  const shortDescription = extractFirstSentence(apt.description);
  if (shortDescription.length > 0) parts.push(shortDescription);
  if (presentNumber(apt.totalAreaSqm)) parts.push(`${apt.totalAreaSqm} m²`);
  const persona = extractPersonaToken(apt.description);
  if (persona.length > 0) parts.push(persona);
  return parts.join(" • ");
}

/**
 * Trim a description to its first sentence. Strict: returns `""` for
 * null/empty so the caller can omit the field entirely (no inventing
 * placeholder text). The terminator set covers the period + the ASCII
 * hyphen-minus that some briefs use as a sentence break.
 */
function extractFirstSentence(text: string | null | undefined): string {
  if (!presentString(text)) return "";
  const trimmed = text.trim();
  // Splits on `. ` (period + space) so abbreviations like "m²." in the
  // middle of a sentence don't truncate prematurely. Falls back to the
  // whole string when no terminator is found.
  const match = trimmed.match(/^([^.!?]+)[.!?](?:\s|$)/);
  if (match && match[1].trim().length > 0) return match[1].trim();
  return trimmed;
}

/**
 * Pull a short persona label out of a description that follows the
 * brief convention `"…. Target persona: established couple / DINK …"`.
 * Returns the raw persona phrase, prefer-shortened to the first
 * comma/parenthesis to keep the header line narrow.
 *
 * Returns `""` when the description doesn't carry the convention —
 * preserves strict-faithfulness (we don't synthesise a persona).
 */
function extractPersonaToken(text: string | null | undefined): string {
  if (!presentString(text)) return "";
  const m = text.match(/Target persona:\s*([^.()]+)/i);
  if (!m) return "";
  // Cut at first comma so multi-clause personas collapse to the
  // primary archetype (e.g. "established couple / DINK couple"
  // → "established couple / DINK couple", but
  // "young family with one child, two-income, mid-career"
  // → "young family with one child").
  const raw = m[1].trim();
  const firstClause = raw.split(/,\s*/)[0]?.trim() ?? raw;
  return firstClause;
}

/**
 * Draw the optional VISUAL NOTES paragraph between the subtitle and
 * the image. Two source fields, both nullable:
 *   • shot.materialNotes      — material vocabulary for the frame
 *   • shot.cameraDescription  — focal length / perspective notes
 *
 * Both null → returns cursorY unchanged (no header rendered, no Y
 * advance). At least one present → renders the labelled section
 * header + a wrapped paragraph below. The image's auto-fit math
 * picks up the new cursor position, so the image shrinks gracefully
 * when notes are present.
 */
function drawVisualNotes(
  doc: jsPDF,
  fontFamily: string,
  shot: ShotSpec,
  startY: number,
): number {
  const segments: string[] = [];
  if (presentString(shot.materialNotes)) {
    segments.push(shot.materialNotes.trim().replace(/\.+$/, ""));
  }
  if (presentString(shot.cameraDescription)) {
    segments.push(shot.cameraDescription.trim().replace(/\.+$/, ""));
  }
  if (segments.length === 0) return startY;

  // Section header in the same secondary tone as the metadata strip
  // labels below the image.
  let cursorY = startY + SPACING_BLOCK_MM * 0.5;
  doc.setFont(fontFamily, "bold");
  doc.setFontSize(FONT_SIZE_LABEL);
  doc.setTextColor(COLOR_TEXT_TERTIARY);
  doc.text("VISUAL NOTES", MARGIN_LEFT_MM, cursorY);
  cursorY += SPACING_LINE_MM + FONT_SIZE_LABEL * 0.4;

  // Body paragraph — em-dash joined, capped to MAX_NOTES_LINES so a
  // brief that dumps a giant material vocabulary doesn't push the
  // image off the page.
  const MAX_NOTES_LINES = 4;
  const paragraph = segments.join(" — ");
  doc.setFont(fontFamily, "normal");
  doc.setFontSize(FONT_SIZE_BODY);
  doc.setTextColor(COLOR_TEXT_SECONDARY);
  const wrapped = doc.splitTextToSize(paragraph, CONTENT_WIDTH_MM);
  const lines: string[] = Array.isArray(wrapped)
    ? wrapped.slice(0, MAX_NOTES_LINES)
    : [paragraph];
  const lineHeightMm = FONT_SIZE_BODY * 0.5;
  for (let i = 0; i < lines.length; i++) {
    doc.text(lines[i], MARGIN_LEFT_MM, cursorY + i * lineHeightMm);
  }
  return cursorY + lines.length * lineHeightMm + SPACING_LINE_MM;
}

/**
 * Draw the "[GOLD ◆] HERO SHOT" badge on the right side of the page,
 * vertically aligned with `baselineY`.
 *
 * The diamond is rendered as filled geometry (a 4-vertex closed
 * polygon) instead of the U+25C6 glyph because that codepoint is
 * outside WinAnsi (Helvetica fallback) and renders as substitute
 * garbage when Inter TTFs are missing. Geometry sidesteps the font
 * dependency entirely.
 *
 * Coordinate model (jspdf, unit=mm, origin=top-left, Y increases down):
 *   start  → top vertex   (cx, cy - s)
 *   step 1 → right vertex (cx + s, cy)
 *   step 2 → bottom       (cx, cy + s)
 *   step 3 → left         (cx - s, cy)
 *   close  → back to top
 *   `closed=true` makes the polygon a closed rhombus that fills cleanly.
 */
function drawHeroBadge(
  doc: jsPDF,
  fontFamily: string,
  baselineY: number,
): void {
  const rightX = PAGE_WIDTH_MM - MARGIN_RIGHT_MM;
  const labelText = LABEL_HERO_SHOT;

  doc.setFont(fontFamily, "bold");
  doc.setFontSize(FONT_SIZE_LABEL);
  doc.setTextColor(COLOR_HERO_GOLD);
  // Measure the text so we can place the icon to its left.
  const textWidthMm = doc.getTextWidth(labelText);
  const textX = rightX - textWidthMm;
  doc.text(labelText, textX, baselineY);

  // Diamond half-side. 1.4 mm gives the same visual weight as a 7pt
  // U+25C6 glyph in the reference layout.
  const halfMm = 1.4;
  const iconGapMm = 1.6;
  // Centre of the diamond — sits to the left of the text, vertically
  // aligned with the text's cap-height (~ 0.7× font ascent above the
  // baseline). 7pt × 0.353 mm/pt × 0.7 ≈ 1.7 mm.
  const cx = textX - iconGapMm - halfMm;
  const cy = baselineY - 1.7;

  doc.setFillColor(COLOR_HERO_GOLD);
  doc.lines(
    [
      [halfMm, halfMm], // top → right
      [-halfMm, halfMm], // right → bottom
      [-halfMm, -halfMm], // bottom → left
      [halfMm, -halfMm], // left → top
    ],
    cx,
    cy - halfMm, // start at the top vertex
    [1, 1],
    "F",
    true,
  );
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
  // Allow up to MAX_VALUE_LINES per column so longer fields like
  // "Late afternoon golden hour. Long shafts catching the …" wrap
  // gracefully instead of truncating mid-word at the column edge.
  const MAX_VALUE_LINES = 2;
  const lineHeightMm = FONT_SIZE_BODY * 0.45;
  let maxLinesUsed = 1;
  for (let i = 0; i < cols.length; i++) {
    const wrapped = doc.splitTextToSize(
      cols[i].value,
      colWidth - SPACING_LINE_MM,
    );
    const lines: string[] = Array.isArray(wrapped)
      ? wrapped.slice(0, MAX_VALUE_LINES)
      : [];
    if (lines.length > maxLinesUsed) maxLinesUsed = lines.length;
    for (let li = 0; li < lines.length; li++) {
      doc.text(
        lines[li],
        MARGIN_LEFT_MM + colWidth * i,
        valueY + li * lineHeightMm,
      );
    }
  }

  return valueY + (maxLinesUsed - 1) * lineHeightMm + SPACING_BLOCK_MM;
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
