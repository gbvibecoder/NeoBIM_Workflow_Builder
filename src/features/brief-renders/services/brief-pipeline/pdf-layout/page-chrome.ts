/**
 * Page chrome — header strip, footer, and page-number backfill.
 *
 * Every page in the PDF gets the footer (left: confidentiality text,
 * right: version + "M3 Full Draft", centre: "Page X of Y"). The cover
 * page additionally gets a top confidentiality strip.
 *
 * Page numbers use the same backfill pattern as `src/services/pdf-report.ts:
 * 1051-1062` — first pass writes the chrome with a placeholder page
 * count; second pass walks every page after content is finalised and
 * overwrites the placeholder with the real "Page X of Y" string.
 */

import type { jsPDF } from "jspdf";

import {
  COLOR_DIVIDER_GREY,
  COLOR_TEXT_TERTIARY,
  FONT_SIZE_FOOTER,
  FONT_SIZE_LABEL,
  MARGIN_BOTTOM_MM,
  MARGIN_LEFT_MM,
  MARGIN_RIGHT_MM,
  MARGIN_TOP_MM,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
} from "./constants";
import {
  LABEL_FOOTER_LEFT,
  LABEL_FOOTER_RIGHT,
} from "./labels";

// ─── Header (cover only — content pages skip) ───────────────────────

export interface PageHeaderOptions {
  /** Optional override for the confidentiality strip text. */
  confidentialityText?: string;
}

const DEFAULT_CONFIDENTIALITY_TEXT = "Confidential — for client review";

export function drawPageHeader(
  doc: jsPDF,
  opts: PageHeaderOptions = {},
): void {
  const text = opts.confidentialityText ?? DEFAULT_CONFIDENTIALITY_TEXT;

  doc.setFontSize(FONT_SIZE_LABEL);
  doc.setTextColor(COLOR_TEXT_TERTIARY);
  doc.text(text, MARGIN_LEFT_MM, MARGIN_TOP_MM - 6);

  // Hairline divider under the header.
  doc.setDrawColor(COLOR_DIVIDER_GREY);
  doc.setLineWidth(0.2);
  doc.line(
    MARGIN_LEFT_MM,
    MARGIN_TOP_MM - 4,
    PAGE_WIDTH_MM - MARGIN_RIGHT_MM,
    MARGIN_TOP_MM - 4,
  );
}

// ─── Footer ─────────────────────────────────────────────────────────

export interface PageFooterOptions {
  /** Brief version string (e.g. `"01"`, `"v2"`). */
  version: string;
  /**
   * Page number. Use a placeholder value (e.g. `0`) on the first pass
   * and call `backfillPageNumbers` later to overwrite with real values.
   */
  pageNumber?: number;
  /** Total pages — same caveat as `pageNumber`. */
  totalPages?: number;
}

export function drawPageFooter(
  doc: jsPDF,
  opts: PageFooterOptions,
): void {
  doc.setFontSize(FONT_SIZE_FOOTER);
  doc.setTextColor(COLOR_TEXT_TERTIARY);

  const baselineY = PAGE_HEIGHT_MM - MARGIN_BOTTOM_MM + 6;
  const rightX = PAGE_WIDTH_MM - MARGIN_RIGHT_MM;

  // Left text — confidentiality.
  doc.text(LABEL_FOOTER_LEFT, MARGIN_LEFT_MM, baselineY);

  // Centre — page number. ONLY drawn when real values are supplied.
  //
  // Why: jspdf's `text()` is additive — calling it on top of an
  // existing string layers both glyphs into the page, it does not
  // overwrite. Older versions of this file wrote a "__PG__" placeholder
  // on the first pass and let `backfillPageNumbers` overlay the real
  // "Page X of Y" — both ended up baked in, surfacing as e.g.
  // `Page▸G of 13` in the rendered PDF.
  // The fix: only the backfill pass (which knows totalPages) draws the
  // page-number text. The first pass leaves the slot empty.
  if (
    typeof opts.pageNumber === "number" &&
    typeof opts.totalPages === "number" &&
    opts.pageNumber > 0 &&
    opts.totalPages > 0
  ) {
    const centerX = PAGE_WIDTH_MM / 2;
    doc.text(
      `Page ${opts.pageNumber} of ${opts.totalPages}`,
      centerX,
      baselineY,
      { align: "center" },
    );
  }

  // Right text — version.
  doc.text(LABEL_FOOTER_RIGHT(opts.version), rightX, baselineY, {
    align: "right",
  });
}

// ─── Helpers for the orchestrator ───────────────────────────────────

export interface AddPageOptions {
  /** When true, render the footer immediately. */
  showFooter: boolean;
  /** Brief version for the footer right-text. */
  version: string;
}

/**
 * Add a fresh page and render its chrome. The page number is written as
 * a placeholder; `backfillPageNumbers` overwrites in the final pass.
 */
export function addPageWithChrome(
  doc: jsPDF,
  opts: AddPageOptions,
): void {
  doc.addPage();
  if (opts.showFooter) {
    drawPageFooter(doc, { version: opts.version });
  }
}

/**
 * Walk every page and write the `Page X of Y` value into the centre of
 * the footer. Called once after content + chrome are finalised so the
 * total page count is accurate.
 *
 * Draws ONLY the page-number text, not the whole footer — left/right
 * footer slots are already populated by `drawPageFooter` from the first
 * pass. Re-drawing the full footer here would layer the same text on
 * top of itself (jspdf is additive), thickening the glyphs.
 */
export function backfillPageNumbers(doc: jsPDF): void {
  const totalPages = doc.getNumberOfPages();
  const centerX = PAGE_WIDTH_MM / 2;
  const baselineY = PAGE_HEIGHT_MM - MARGIN_BOTTOM_MM + 6;

  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex++) {
    doc.setPage(pageIndex);
    doc.setFontSize(FONT_SIZE_FOOTER);
    doc.setTextColor(COLOR_TEXT_TERTIARY);
    doc.text(
      `Page ${pageIndex} of ${totalPages}`,
      centerX,
      baselineY,
      { align: "center" },
    );
  }
}
