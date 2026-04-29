/**
 * Cover-page composer.
 *
 * Renders the editorial cover from a `BriefSpec` with **strict
 * faithfulness**: null source fields render as empty space, never as
 * `"null"` / `"N/A"` / `"Untitled"`. Layout adapts when fields are
 * missing — e.g. a brief with no `projectTitle` simply pushes the
 * subtitle up.
 *
 * Pure function: receives the doc, mutates it in place. No I/O. No
 * `Date.now()`. No `Math.random()`. Same input → same output (modulo
 * jspdf's internal object IDs which we don't observe externally).
 *
 * Field-mapping note: the Phase 1 stub exposes
 *   `BriefSpec.projectTitle / projectLocation / projectType`
 * (NOT a nested `projectMeta` block). This composer adapts to the
 * actual schema; see the Phase 5 report §10 for the divergence note.
 */

import type { jsPDF } from "jspdf";

import type {
  ApartmentSpec,
  BaselineSpec,
  BriefSpec,
} from "../types";
import {
  COLOR_DIVIDER_GREY,
  COLOR_HERO_GOLD,
  COLOR_TEXT_PRIMARY,
  COLOR_TEXT_SECONDARY,
  COLOR_TEXT_TERTIARY,
  CONTENT_WIDTH_MM,
  FONT_SIZE_BODY,
  FONT_SIZE_LABEL,
  FONT_SIZE_PROJECT_SUBTITLE,
  FONT_SIZE_PROJECT_TITLE,
  FONT_SIZE_SECTION_HEADER,
  FONT_SIZE_TABLE_BODY,
  MARGIN_LEFT_MM,
  MARGIN_RIGHT_MM,
  MARGIN_TOP_MM,
  PAGE_WIDTH_MM,
  SPACING_BLOCK_MM,
  SPACING_LINE_MM,
  TABLE_CELL_PADDING_MM,
  TABLE_HEADER_HEIGHT_MM,
  TABLE_ROW_HEIGHT_MM,
} from "./constants";
import {
  LABEL_BASELINE_HEADER,
  LABEL_PHOTOREALISTIC_COUNT,
  LABEL_TABLE_APARTMENT,
  LABEL_TABLE_AREA,
  LABEL_TABLE_LAYOUT,
  LABEL_TABLE_PERSONA,
  LABEL_TABLE_SHOTS,
} from "./labels";
import { drawPageFooter, drawPageHeader } from "./page-chrome";

// ─── Public API ─────────────────────────────────────────────────────

export interface RenderCoverPageArgs {
  spec: BriefSpec;
  totalShots: number;
  /** Brief version for the footer right-text. */
  version: string;
  /** Font family resolved by `pdf-fonts.ts` (Inter or Helvetica). */
  fontFamily: string;
}

/**
 * Render the cover page on the current jspdf page (page 1).
 *
 * Caller guarantees the doc is on page 1 — this function does NOT
 * call `addPage()`.
 */
export function renderCoverPage(
  doc: jsPDF,
  args: RenderCoverPageArgs,
): void {
  const { spec, totalShots, version, fontFamily } = args;

  // Top confidentiality strip.
  drawPageHeader(doc);

  let cursorY = MARGIN_TOP_MM;

  // ── Project title ──────────────────────────────────────────────
  if (presentString(spec.projectTitle)) {
    doc.setFont(fontFamily, "bold");
    doc.setFontSize(FONT_SIZE_PROJECT_TITLE);
    doc.setTextColor(COLOR_TEXT_PRIMARY);
    cursorY += FONT_SIZE_PROJECT_TITLE * 0.4;
    doc.text(spec.projectTitle.trim(), MARGIN_LEFT_MM, cursorY);
    cursorY += SPACING_BLOCK_MM;
  }

  // ── Project subtitle (location + type, joined null-safely) ─────
  const subtitle = composeSubtitle(spec.projectLocation, spec.projectType);
  if (subtitle.length > 0) {
    doc.setFont(fontFamily, "normal");
    doc.setFontSize(FONT_SIZE_PROJECT_SUBTITLE);
    doc.setTextColor(COLOR_TEXT_SECONDARY);
    cursorY += FONT_SIZE_PROJECT_SUBTITLE * 0.4;
    doc.text(subtitle, MARGIN_LEFT_MM, cursorY);
    cursorY += SPACING_BLOCK_MM;
  }

  // ── "N PHOTOREALISTIC INTERIOR RENDERINGS" ─────────────────────
  doc.setFont(fontFamily, "bold");
  doc.setFontSize(FONT_SIZE_SECTION_HEADER);
  doc.setTextColor(COLOR_TEXT_PRIMARY);
  cursorY += SPACING_BLOCK_MM;
  doc.text(
    LABEL_PHOTOREALISTIC_COUNT(totalShots),
    MARGIN_LEFT_MM,
    cursorY,
  );
  cursorY += SPACING_BLOCK_MM;

  // ── Body paragraph (closest schema match: baseline.additionalNotes) ──
  if (presentString(spec.baseline.additionalNotes)) {
    doc.setFont(fontFamily, "normal");
    doc.setFontSize(FONT_SIZE_BODY);
    doc.setTextColor(COLOR_TEXT_SECONDARY);
    const wrapped = doc.splitTextToSize(
      spec.baseline.additionalNotes.trim(),
      CONTENT_WIDTH_MM,
    );
    cursorY += SPACING_BLOCK_MM;
    doc.text(wrapped, MARGIN_LEFT_MM, cursorY);
    cursorY += wrapped.length * (FONT_SIZE_BODY * 0.5) + SPACING_BLOCK_MM;
  }

  // ── Apartment summary table ────────────────────────────────────
  cursorY += SPACING_BLOCK_MM;
  cursorY = drawApartmentTable(doc, fontFamily, spec.apartments, cursorY);

  // ── Baseline block ─────────────────────────────────────────────
  cursorY += SPACING_BLOCK_MM * 2;
  cursorY = drawBaselineBlock(doc, fontFamily, spec.baseline, totalShots, cursorY);

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
 * Compose the subtitle from `projectLocation` + `projectType` without
 * inventing punctuation when either is null. Examples:
 *   loc="Berlin", type="residential"   → "Berlin · residential"
 *   loc="Berlin", type=null            → "Berlin"
 *   loc=null,    type="residential"    → "residential"
 *   loc=null,    type=null             → "" (caller skips render)
 */
function composeSubtitle(
  location: string | null,
  type: string | null,
): string {
  const parts: string[] = [];
  if (presentString(location)) parts.push(location.trim());
  if (presentString(type)) parts.push(type.trim());
  return parts.join(" · ");
}

/**
 * Build the LAYOUT cell text from an apartment's rooms count.
 * "2BR/1BA" when both are populated; falls back to whichever is present.
 */
function composeLayoutCell(apt: ApartmentSpec): string {
  const parts: string[] = [];
  if (presentNumber(apt.bedrooms)) parts.push(`${apt.bedrooms}BR`);
  if (presentNumber(apt.bathrooms)) parts.push(`${apt.bathrooms}BA`);
  return parts.join("/");
}

function composeAreaCell(apt: ApartmentSpec): string {
  if (!presentNumber(apt.totalAreaSqm)) return "";
  return `${apt.totalAreaSqm} m²`;
}

// ─── Apartment table ────────────────────────────────────────────────

function drawApartmentTable(
  doc: jsPDF,
  fontFamily: string,
  apartments: ApartmentSpec[],
  startY: number,
): number {
  // Five columns. Width distribution:
  //   APARTMENT  18%
  //   LAYOUT     14%
  //   AREA       14%
  //   PERSONA    44%
  //   SHOTS      10%
  const widths: number[] = [
    CONTENT_WIDTH_MM * 0.18,
    CONTENT_WIDTH_MM * 0.14,
    CONTENT_WIDTH_MM * 0.14,
    CONTENT_WIDTH_MM * 0.44,
    CONTENT_WIDTH_MM * 0.1,
  ];
  const colXs: number[] = [];
  let x = MARGIN_LEFT_MM;
  for (const w of widths) {
    colXs.push(x);
    x += w;
  }

  const headers = [
    LABEL_TABLE_APARTMENT,
    LABEL_TABLE_LAYOUT,
    LABEL_TABLE_AREA,
    LABEL_TABLE_PERSONA,
    LABEL_TABLE_SHOTS,
  ];

  // Header row.
  doc.setFont(fontFamily, "bold");
  doc.setFontSize(FONT_SIZE_LABEL);
  doc.setTextColor(COLOR_TEXT_TERTIARY);
  const headerBaselineY = startY + TABLE_HEADER_HEIGHT_MM - 1;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], colXs[i] + TABLE_CELL_PADDING_MM, headerBaselineY);
  }

  // Hairline under header.
  let cursorY = startY + TABLE_HEADER_HEIGHT_MM;
  doc.setDrawColor(COLOR_DIVIDER_GREY);
  doc.setLineWidth(0.2);
  doc.line(
    MARGIN_LEFT_MM,
    cursorY,
    PAGE_WIDTH_MM - MARGIN_RIGHT_MM,
    cursorY,
  );

  // Body rows.
  doc.setFont(fontFamily, "normal");
  doc.setFontSize(FONT_SIZE_TABLE_BODY);
  doc.setTextColor(COLOR_TEXT_PRIMARY);

  for (const apt of apartments) {
    const cells = [
      presentString(apt.label) ? apt.label.trim() : "",
      composeLayoutCell(apt),
      composeAreaCell(apt),
      presentString(apt.description) ? apt.description.trim() : "",
      String(apt.shots.length),
    ];

    const rowBaselineY = cursorY + TABLE_ROW_HEIGHT_MM - SPACING_LINE_MM;
    for (let i = 0; i < cells.length; i++) {
      const wrapped = doc.splitTextToSize(
        cells[i],
        widths[i] - TABLE_CELL_PADDING_MM * 2,
      );
      // Render only the first line in the row body — long descriptions
      // are truncated. The full description would push pagination
      // unpredictably; the cover stays consistent at one row per apt.
      const firstLine =
        Array.isArray(wrapped) && wrapped.length > 0 ? wrapped[0] : "";
      doc.text(
        firstLine,
        colXs[i] + TABLE_CELL_PADDING_MM,
        rowBaselineY,
      );
    }
    cursorY += TABLE_ROW_HEIGHT_MM;

    // Hairline under each row.
    doc.line(
      MARGIN_LEFT_MM,
      cursorY,
      PAGE_WIDTH_MM - MARGIN_RIGHT_MM,
      cursorY,
    );
  }

  return cursorY;
}

// ─── Baseline block ─────────────────────────────────────────────────

function drawBaselineBlock(
  doc: jsPDF,
  fontFamily: string,
  baseline: BaselineSpec,
  totalShots: number,
  startY: number,
): number {
  doc.setFont(fontFamily, "bold");
  doc.setFontSize(FONT_SIZE_LABEL);
  doc.setTextColor(COLOR_HERO_GOLD);
  doc.text(LABEL_BASELINE_HEADER(totalShots), MARGIN_LEFT_MM, startY);

  let cursorY = startY + SPACING_BLOCK_MM;

  // Compose the multi-line baseline body from non-null leaves. Each
  // labelled line keeps the source's intent visible to a human reader
  // (contractor, designer) without inventing punctuation when fields
  // are silent.
  const lines: string[] = [];
  const pushLine = (label: string, value: string | null | undefined) => {
    if (presentString(value)) {
      lines.push(`${label}  ${value.trim()}`);
    }
  };
  pushLine("Visual style:", baseline.visualStyle);
  pushLine("Material palette:", baseline.materialPalette);
  pushLine("Lighting baseline:", baseline.lightingBaseline);
  pushLine("Camera baseline:", baseline.cameraBaseline);
  pushLine("Quality target:", baseline.qualityTarget);

  if (lines.length > 0) {
    doc.setFont(fontFamily, "normal");
    doc.setFontSize(FONT_SIZE_BODY);
    doc.setTextColor(COLOR_TEXT_PRIMARY);
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(line, CONTENT_WIDTH_MM);
      doc.text(wrapped, MARGIN_LEFT_MM, cursorY);
      cursorY += wrapped.length * (FONT_SIZE_BODY * 0.5) + SPACING_LINE_MM;
    }
  }

  return cursorY;
}
