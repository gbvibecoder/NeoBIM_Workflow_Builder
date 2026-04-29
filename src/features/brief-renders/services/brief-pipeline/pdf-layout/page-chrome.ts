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

/**
 * Token written by the first pass and overwritten by `backfillPageNumbers`.
 * Picked so it never appears in real chrome text.
 */
const PAGE_NUMBER_PLACEHOLDER_PREFIX = "​__PG__​";

function placeholderToken(): string {
  return PAGE_NUMBER_PLACEHOLDER_PREFIX;
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

  // Centre — page number, either real or placeholder.
  const centerX = PAGE_WIDTH_MM / 2;
  if (
    typeof opts.pageNumber === "number" &&
    typeof opts.totalPages === "number" &&
    opts.pageNumber > 0 &&
    opts.totalPages > 0
  ) {
    doc.text(
      `Page ${opts.pageNumber} of ${opts.totalPages}`,
      centerX,
      baselineY,
      { align: "center" },
    );
  } else {
    doc.text(placeholderToken(), centerX, baselineY, { align: "center" });
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
 * Walk every page and overwrite the placeholder page-number with the
 * real `Page X of Y` value. Mirrors `pdf-report.ts:1051-1062`.
 */
export function backfillPageNumbers(
  doc: jsPDF,
  opts: { version: string },
): void {
  const totalPages = doc.getNumberOfPages();
  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex++) {
    doc.setPage(pageIndex);
    // Re-draw the footer with real numbers — overwrites the placeholder.
    // The text is rendered on top of the existing placeholder; both are
    // anchored to the same coordinate, so the new draw effectively
    // replaces the placeholder visually.
    drawPageFooter(doc, {
      version: opts.version,
      pageNumber: pageIndex,
      totalPages,
    });
  }
}
