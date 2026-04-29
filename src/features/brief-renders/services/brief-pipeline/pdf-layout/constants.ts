/**
 * Editorial-PDF design tokens.
 *
 * Every magic number used by the cover / per-shot composers lives here.
 * Layout files import named constants; never inline `mm` values, font
 * sizes, or hex colors at the call site. Keeps the visual identity in
 * one place when Phase 6 polish loops on the look-and-feel.
 *
 * Units: jspdf is initialised with `unit: "mm"` in `stage-4-pdf-compile.ts`,
 * so all numeric distances in this file are millimetres. Font sizes are
 * jspdf points (1 pt ≈ 0.353 mm).
 */

// ─── Page geometry — A4 portrait ────────────────────────────────────

export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;

export const MARGIN_LEFT_MM = 18;
export const MARGIN_RIGHT_MM = 18;
export const MARGIN_TOP_MM = 18;
export const MARGIN_BOTTOM_MM = 18;

export const CONTENT_WIDTH_MM =
  PAGE_WIDTH_MM - MARGIN_LEFT_MM - MARGIN_RIGHT_MM;
export const CONTENT_HEIGHT_MM =
  PAGE_HEIGHT_MM - MARGIN_TOP_MM - MARGIN_BOTTOM_MM;

/** Image rendering width on per-shot pages — full content width. */
export const IMAGE_WIDTH_MM = CONTENT_WIDTH_MM;

// ─── Color palette ──────────────────────────────────────────────────
//
// Hex literals chosen to match the reference layout's editorial tone.
// Hero gold accents the "◆ HERO SHOT" badge. Divider grey separates
// rows in the apartment summary table.

export const COLOR_TEXT_PRIMARY = "#181818";
export const COLOR_TEXT_SECONDARY = "#4A4A4A";
export const COLOR_TEXT_TERTIARY = "#7A7A7A";
export const COLOR_HERO_GOLD = "#B8893D";
export const COLOR_DIVIDER_GREY = "#D9D9D9";
export const COLOR_PAGE_BG = "#FFFFFF";

// ─── Font sizes (jspdf points) ──────────────────────────────────────

export const FONT_SIZE_PROJECT_TITLE = 22;
export const FONT_SIZE_PROJECT_SUBTITLE = 12;
export const FONT_SIZE_SECTION_HEADER = 11;
export const FONT_SIZE_SHOT_TITLE = 18;
export const FONT_SIZE_SHOT_SUBTITLE = 11;
export const FONT_SIZE_BODY = 9.5;
export const FONT_SIZE_TABLE_BODY = 9;
export const FONT_SIZE_FOOTER = 7.5;
export const FONT_SIZE_LABEL = 7;
export const FONT_SIZE_FILENAME_MONO = 8;

// ─── Vertical rhythm (mm) ───────────────────────────────────────────

/** Gap between major blocks (e.g. project title → subtitle). */
export const SPACING_BLOCK_MM = 4;
/** Gap between sentences inside a block. */
export const SPACING_LINE_MM = 1.6;
/** Padding cell-edge to text inside the apartment summary table. */
export const TABLE_CELL_PADDING_MM = 2;
/** Height of a single apartment table row. */
export const TABLE_ROW_HEIGHT_MM = 7;
/** Height of the apartment table header row. */
export const TABLE_HEADER_HEIGHT_MM = 6;

// ─── Aspect ratio → pixel proportions ───────────────────────────────
//
// The provider only emits 1024x1024, 1024x1536, 1536x1024 outputs.
// These ratios are width/height (so `1024x1536` is a portrait, ratio
// 2/3). Used by `per-shot-page.ts` to compute image height from
// IMAGE_WIDTH_MM while preserving aspect.

export const ASPECT_LANDSCAPE_3_2 = 3 / 2; // 1536x1024
export const ASPECT_PORTRAIT_2_3 = 2 / 3; // 1024x1536
export const ASPECT_SQUARE_1_1 = 1; // 1024x1024
export const ASPECT_DEFAULT = ASPECT_LANDSCAPE_3_2;
