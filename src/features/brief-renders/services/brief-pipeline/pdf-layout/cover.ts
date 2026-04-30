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

  // Masthead vertical offset: push the title block down so it sits in
  // the upper third of the page with breathing room above (matches the
  // editorial deck reference). Without this the cover anchored at the
  // top margin and felt cramped.
  const MASTHEAD_TOP_OFFSET_MM = 40;
  let cursorY = MARGIN_TOP_MM + MASTHEAD_TOP_OFFSET_MM;
  const pageCenterX = PAGE_WIDTH_MM / 2;

  // ── Project title (split at first comma so long addresses don't overflow)
  // The brief frequently sets `projectTitle` to a full address line:
  //   "Marxstraße 12, 76571 Gaggenau — EG (ground floor)"
  // At 22pt that's ~58 chars × ~3.4 mm/char = 197 mm, blowing the
  // 174 mm content width and clipping at the right edge. We split at
  // the first comma so the building name becomes the title and the
  // remainder folds into the subtitle. If there's no comma, falls back
  // to splitTextToSize wrapping across multiple lines.
  if (presentString(spec.projectTitle)) {
    const { title: titleText, tail } = splitTitleAtFirstComma(
      spec.projectTitle,
    );
    doc.setFont(fontFamily, "bold");
    doc.setFontSize(FONT_SIZE_PROJECT_TITLE);
    doc.setTextColor(COLOR_TEXT_PRIMARY);
    const titleLines = doc.splitTextToSize(titleText, CONTENT_WIDTH_MM);
    cursorY += FONT_SIZE_PROJECT_TITLE * 0.4;
    const titleLineArray: string[] = Array.isArray(titleLines)
      ? titleLines
      : [titleText];
    // Title is centered horizontally for a proper editorial-deck
    // masthead (matches the reference layout). Body content below
    // the masthead reverts to left-alignment.
    for (let i = 0; i < titleLineArray.length; i++) {
      doc.text(titleLineArray[i], pageCenterX, cursorY, { align: "center" });
      if (i < titleLineArray.length - 1) {
        cursorY += FONT_SIZE_PROJECT_TITLE * 0.45;
      }
    }
    cursorY += SPACING_BLOCK_MM;

    // If the title carried a tail after the first comma, render it as
    // the leading subtitle so the address details aren't lost.
    if (tail.length > 0) {
      doc.setFont(fontFamily, "normal");
      doc.setFontSize(FONT_SIZE_PROJECT_SUBTITLE);
      doc.setTextColor(COLOR_TEXT_SECONDARY);
      cursorY += FONT_SIZE_PROJECT_SUBTITLE * 0.4;
      const tailLines = doc.splitTextToSize(tail, CONTENT_WIDTH_MM);
      const tailLineArray: string[] = Array.isArray(tailLines)
        ? tailLines
        : [tail];
      for (let i = 0; i < tailLineArray.length; i++) {
        doc.text(tailLineArray[i], pageCenterX, cursorY, { align: "center" });
        if (i < tailLineArray.length - 1) {
          cursorY += FONT_SIZE_PROJECT_SUBTITLE * 0.5;
        }
      }
      cursorY += SPACING_BLOCK_MM;
    }
  }

  // ── Project subtitle (location + type, joined null-safely) ─────
  const subtitle = composeSubtitle(spec.projectLocation, spec.projectType);
  if (subtitle.length > 0) {
    doc.setFont(fontFamily, "normal");
    doc.setFontSize(FONT_SIZE_PROJECT_SUBTITLE);
    doc.setTextColor(COLOR_TEXT_SECONDARY);
    cursorY += FONT_SIZE_PROJECT_SUBTITLE * 0.4;
    doc.text(subtitle, pageCenterX, cursorY, { align: "center" });
    cursorY += SPACING_BLOCK_MM;
  }

  // After the masthead, add a small visual gap before content reverts
  // to left-aligned body sections.
  cursorY += SPACING_BLOCK_MM * 2;

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

  // ── Body paragraph — short summary of brief.additionalNotes ──
  // The raw `additionalNotes` field on a real brief is a long
  // shot-list mandate (200+ words: positive list, negative list,
  // file naming convention, source plan reference). Dumping it on
  // the cover makes the page look like a draft, not a client deck.
  // We trim it to the first 1-2 sentences (≤ COVER_BODY_CHAR_BUDGET
  // chars), preserving the "Audience / Source" preamble that's
  // genuinely useful to a client reader.
  const COVER_BODY_CHAR_BUDGET = 220;
  if (presentString(spec.baseline.additionalNotes)) {
    const summary = summariseForCover(
      spec.baseline.additionalNotes,
      COVER_BODY_CHAR_BUDGET,
    );
    if (summary.length > 0) {
      doc.setFont(fontFamily, "normal");
      doc.setFontSize(FONT_SIZE_BODY);
      doc.setTextColor(COLOR_TEXT_SECONDARY);
      const wrapped = doc.splitTextToSize(summary, CONTENT_WIDTH_MM);
      cursorY += SPACING_BLOCK_MM;
      doc.text(wrapped, MARGIN_LEFT_MM, cursorY);
      cursorY += wrapped.length * (FONT_SIZE_BODY * 0.5) + SPACING_BLOCK_MM;
    }
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

/**
 * Split a `projectTitle` at the first comma, returning the left half
 * as `title` and the rest (sans the comma) as `tail`. A title with
 * no comma returns `tail = ""`.
 *
 * Example:
 *   "Marxstraße 12, 76571 Gaggenau — EG (ground floor)"
 *     → { title: "Marxstraße 12", tail: "76571 Gaggenau — EG (ground floor)" }
 */
function splitTitleAtFirstComma(raw: string): { title: string; tail: string } {
  const trimmed = raw.trim();
  const idx = trimmed.indexOf(",");
  if (idx < 0) return { title: trimmed, tail: "" };
  const title = trimmed.slice(0, idx).trim();
  const tail = trimmed.slice(idx + 1).trim();
  return { title, tail };
}

/**
 * Trim a long brief paragraph down to a cover-friendly summary.
 *
 * Strategy:
 *   1. Pull complete sentences off the front until adding the next
 *      sentence would exceed `maxChars`.
 *   2. If even the first sentence is too long, hard-cut at a word
 *      boundary near `maxChars` and append "…".
 *   3. Strict-faithfulness preserved: empty input returns `""`, never
 *      a synthesised "Untitled" / "N/A" / etc.
 */
function summariseForCover(raw: string, maxChars: number): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length <= maxChars) return trimmed;

  // Sentence-by-sentence accumulator.
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  let acc = "";
  for (const s of sentences) {
    const candidate = acc.length === 0 ? s : `${acc} ${s}`;
    if (candidate.length > maxChars) break;
    acc = candidate;
  }
  if (acc.length > 0) return acc;

  // First sentence already over budget — hard-cut near a word boundary.
  const slice = trimmed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()}…`;
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

  // Collapse all baseline leaves into ONE compact paragraph instead
  // of the prior labelled-line dump (which read like a draft brief
  // instead of a client deck — see the resres.pdf comparison). Each
  // present field becomes a short sentence prefixed with its label;
  // null fields are silently dropped.
  const sentences: string[] = [];
  const pushSentence = (label: string, value: string | null | undefined) => {
    if (presentString(value)) {
      const cleaned = value.trim().replace(/\.+$/, "");
      sentences.push(`${label} ${cleaned}.`);
    }
  };
  pushSentence("Visual style —", baseline.visualStyle);
  pushSentence("Material palette —", baseline.materialPalette);
  pushSentence("Lighting —", baseline.lightingBaseline);
  pushSentence("Camera —", baseline.cameraBaseline);
  pushSentence("Quality —", baseline.qualityTarget);

  if (sentences.length > 0) {
    const paragraph = sentences.join(" ");
    doc.setFont(fontFamily, "normal");
    doc.setFontSize(FONT_SIZE_BODY);
    doc.setTextColor(COLOR_TEXT_PRIMARY);
    const wrapped = doc.splitTextToSize(paragraph, CONTENT_WIDTH_MM);
    doc.text(wrapped, MARGIN_LEFT_MM, cursorY);
    const lineCount = Array.isArray(wrapped) ? wrapped.length : 1;
    cursorY += lineCount * (FONT_SIZE_BODY * 0.5) + SPACING_LINE_MM;
  }

  return cursorY;
}
