/**
 * 5I PR 4 — BOQ JSON → Excel (.xlsx) renderer.
 *
 * Consumes a `BOQOutput` (16 top-level keys per PR 2a's sidecar capture)
 * and produces an 8-sheet `.xlsx` Buffer:
 *
 *   1. Summary                — project meta + tier_1 totals
 *   2. Categories             — tier_2_categories (dict)
 *   3. SKU Types              — tier_3_sku_types (array)
 *   4. SKU Details            — tier_4_sku_details (array)
 *   5. Wall Segments          — tier_5_wall_segments (array)
 *   6. Panel Pieces           — tier_6_panel_pieces (array; up to ~15.5k rows)
 *   7. Custom Quotes          — custom_quote_items (array)
 *   8. Warnings & Review      — warnings + assumptions + pending_karthik + operator_review_items
 *
 * Defensive: missing/empty fields produce "No data" rows or `null`
 * cells — never throws on shape mismatches. Only XLSX.utils library
 * errors propagate.
 *
 * Mirrors the API idioms used by `src/app/api/execute-node/handlers/ex-002.ts`
 * (the existing BOQ Excel exporter for a different schema): `book_new` +
 * `aoa_to_sheet` + `book_append_sheet` + `XLSX.write(wb, {bookType: "xlsx", type: "buffer"})`.
 */

import * as XLSX from "xlsx";
import type { KosCustomerDrawing } from "@prisma/client";

import { kosLog } from "@/features/kos/lib/kos-logger";
import type { BOQOutput } from "@/features/kos/types/sidecar";

export interface RenderBoqExcelArgs {
  boq: BOQOutput;
  drawing: KosCustomerDrawing;
  /**
   * Discriminated parse-result envelope from PR 2b. Used (optionally)
   * to surface title-block info on the Summary sheet. Shape:
   *   { kind: "parser" | "mapper" | "mapper_s3", data?: …, s3Key?: … }
   * We only mine the `parser` variant — mapper output has no title
   * block; if only mapper data is cached, Summary uses
   * `drawing.originalFilename` as the project label.
   */
  parseResult?: unknown;
}

type Cell = string | number | null;

export async function renderBoqExcel(args: RenderBoqExcelArgs): Promise<Buffer> {
  const startedAt = Date.now();

  kosLog.info("kos_boq_render_start", {
    drawingId: args.drawing.id,
    boqId: args.boq?.boq_id,
  });

  const wb = XLSX.utils.book_new();
  const titleBlock = extractTitleBlock(args.parseResult);

  // ── 1. Summary ──────────────────────────────────────────────────────
  const tier1 = (args.boq.tier_1_summary ?? {}) as Record<string, unknown>;
  const summaryRows: Cell[][] = [
    ["Project Name", titleBlock?.project_name ?? args.drawing.originalFilename ?? "N/A"],
    ["Drawing Number", titleBlock?.drawing_number ?? "N/A"],
    ["Revision", titleBlock?.revision ?? "N/A"],
    ["BOQ ID", args.boq.boq_id ?? "N/A"],
    ["Generated At", args.boq.generated_at ?? "N/A"],
    ["Schema Version", args.boq.schema_version ?? "N/A"],
    [],
    ["— Totals —"],
    ["Total Standard Panels", pickNumber(tier1, "total_standard_panels")],
    ["Grand Total INR", pickString(tier1, "grand_total_inr_formatted") ?? "N/A"],
    ["Custom Quotes Pending", pickNumber(tier1, "custom_quotes_pending_count")],
    ["Warnings", arrLen(args.boq.warnings)],
    ["Pending Karthik Items", arrLen(args.boq.pending_karthik)],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 28 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  // ── 2. Categories (tier_2_categories is a dict per PR 2a deviation #2) ─
  const categoriesRows = buildCategoriesRows(args.boq.tier_2_categories);
  const categoriesSheet = XLSX.utils.aoa_to_sheet(categoriesRows);
  categoriesSheet["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, categoriesSheet, "Categories");

  // ── 3. SKU Types ────────────────────────────────────────────────────
  const skuTypesHeaders = ["SKU Code", "Description", "Count", "Unit Price INR", "Line Total INR"];
  const skuTypesRows = buildArraySheet(
    args.boq.tier_3_sku_types,
    skuTypesHeaders,
    [["sku_code", "code", "sku"], ["description", "label", "name"], ["count", "quantity"], ["unit_price_inr", "unit_price", "rate"], ["line_total_inr", "total_inr", "total"]],
  );
  const skuTypesSheet = XLSX.utils.aoa_to_sheet(skuTypesRows);
  skuTypesSheet["!cols"] = [{ wch: 18 }, { wch: 35 }, { wch: 10 }, { wch: 15 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, skuTypesSheet, "SKU Types");

  // ── 4. SKU Details ──────────────────────────────────────────────────
  const skuDetailsHeaders = [
    "SKU Code",
    "Description",
    "Width mm",
    "Height mm",
    "Thickness mm",
    "Count",
    "Unit Price INR",
    "Line Total INR",
  ];
  const skuDetailsRows = buildArraySheet(
    args.boq.tier_4_sku_details,
    skuDetailsHeaders,
    [
      ["sku_code", "code", "sku"],
      ["description", "label", "name"],
      ["width_mm", "width"],
      ["height_mm", "height"],
      ["thickness_mm", "thickness"],
      ["count", "quantity"],
      ["unit_price_inr", "unit_price"],
      ["line_total_inr", "total_inr"],
    ],
  );
  const skuDetailsSheet = XLSX.utils.aoa_to_sheet(skuDetailsRows);
  skuDetailsSheet["!cols"] = [
    { wch: 18 },
    { wch: 28 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 15 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, skuDetailsSheet, "SKU Details");

  // ── 5. Wall Segments ────────────────────────────────────────────────
  const wallsHeaders = ["Wall ID", "Length mm", "Thickness mm", "Application", "Panel SKU", "Cost INR"];
  const wallsRows = buildArraySheet(
    args.boq.tier_5_wall_segments,
    wallsHeaders,
    [
      ["wall_id", "id"],
      ["length_mm", "length"],
      ["thickness_mm", "thickness"],
      ["application", "wall_type"],
      ["panel_sku", "sku"],
      ["cost_inr", "cost", "total_inr"],
    ],
  );
  const wallsSheet = XLSX.utils.aoa_to_sheet(wallsRows);
  XLSX.utils.book_append_sheet(wb, wallsSheet, "Wall Segments");

  // ── 6. Panel Pieces (can be very large — up to 15583+ rows) ────────
  const piecesHeaders = ["Piece ID", "Wall ID", "SKU", "Width mm", "Height mm", "Thickness mm", "Weight kg", "Cost INR"];
  const piecesRows = buildArraySheet(
    args.boq.tier_6_panel_pieces,
    piecesHeaders,
    [
      ["piece_id", "id"],
      ["wall_id"],
      ["sku", "sku_code"],
      ["width_mm", "width"],
      ["height_mm", "height"],
      ["thickness_mm", "thickness"],
      ["weight_kg", "weight"],
      ["cost_inr", "cost"],
    ],
  );
  const piecesSheet = XLSX.utils.aoa_to_sheet(piecesRows);
  XLSX.utils.book_append_sheet(wb, piecesSheet, "Panel Pieces");

  // ── 7. Custom Quotes ────────────────────────────────────────────────
  const customHeaders = ["Item", "Reason", "Notes"];
  const customRows = buildArraySheet(
    args.boq.custom_quote_items,
    customHeaders,
    [["item", "name"], ["reason", "category"], ["notes", "comment"]],
  );
  const customSheet = XLSX.utils.aoa_to_sheet(customRows);
  customSheet["!cols"] = [{ wch: 30 }, { wch: 25 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, customSheet, "Custom Quotes");

  // ── 8. Warnings & Operator Review ──────────────────────────────────
  const reviewRows: Cell[][] = [["Type", "Message"]];
  for (const w of safeArr(args.boq.warnings)) {
    reviewRows.push(["Warning", String(w)]);
  }
  for (const a of safeArr(args.boq.assumptions_made)) {
    reviewRows.push(["Assumption", String(a)]);
  }
  for (const p of safeArr(args.boq.pending_karthik)) {
    reviewRows.push(["Pending Karthik", JSON.stringify(p)]);
  }
  for (const r of safeArr(args.boq.operator_review_items)) {
    reviewRows.push(["Review Required", JSON.stringify(r)]);
  }
  if (reviewRows.length === 1) {
    reviewRows.push(["No data", "No warnings, assumptions, pending items, or review items"]);
  }
  const reviewSheet = XLSX.utils.aoa_to_sheet(reviewRows);
  reviewSheet["!cols"] = [{ wch: 18 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, reviewSheet, "Warnings & Review");

  // Serialize
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
  const durationMs = Date.now() - startedAt;

  kosLog.info("kos_boq_render_done", {
    drawingId: args.drawing.id,
    boqId: args.boq?.boq_id,
    bytes: buffer.byteLength,
    sheets: wb.SheetNames.length,
    durationMs,
  });

  return buffer;
}

// ── Helpers ────────────────────────────────────────────────────────────

interface TitleBlockShape {
  project_name?: string | null;
  drawing_number?: string | null;
  revision?: string | null;
}

function extractTitleBlock(parseResult: unknown): TitleBlockShape | null {
  if (!parseResult || typeof parseResult !== "object") return null;
  const pr = parseResult as { kind?: unknown; data?: unknown };
  if (pr.kind !== "parser") return null;
  const data = pr.data;
  if (!data || typeof data !== "object") return null;
  const tb = (data as { title_block?: unknown }).title_block;
  if (!tb || typeof tb !== "object") return null;
  return tb as TitleBlockShape;
}

function buildCategoriesRows(categories: unknown): Cell[][] {
  const rows: Cell[][] = [["Category", "Items", "Total INR"]];
  if (!categories || typeof categories !== "object" || Array.isArray(categories)) {
    rows.push(["No data", null, null]);
    return rows;
  }
  for (const [name, value] of Object.entries(categories as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      rows.push([name, null, null]);
      continue;
    }
    const v = value as Record<string, unknown>;
    rows.push([
      name,
      pickNumber(v, "total_items") ?? pickNumber(v, "count") ?? null,
      pickString(v, "total_inr_formatted") ?? pickString(v, "total_inr") ?? null,
    ]);
  }
  if (rows.length === 1) {
    rows.push(["No data", null, null]);
  }
  return rows;
}

/**
 * Walk an unknown array, projecting each item via the per-column key
 * fallback lists. Each header has a corresponding list of candidate
 * snake_case keys; the first matching key on the item is used.
 */
function buildArraySheet(
  arr: unknown,
  headers: string[],
  keyFallbacks: string[][],
): Cell[][] {
  const rows: Cell[][] = [headers];
  if (!Array.isArray(arr)) {
    rows.push(["(field is not an array)", ...Array<Cell>(headers.length - 1).fill(null)]);
    return rows;
  }
  if (arr.length === 0) {
    rows.push(["No data", ...Array<Cell>(headers.length - 1).fill(null)]);
    return rows;
  }
  for (const item of arr) {
    if (!item || typeof item !== "object") {
      rows.push([String(item), ...Array<Cell>(headers.length - 1).fill(null)]);
      continue;
    }
    // Skip prototype-polluted entries' inherited surface — use own
    // properties only via Object.hasOwn check below.
    const obj = item as Record<string, unknown>;
    const row: Cell[] = [];
    for (let i = 0; i < headers.length; i++) {
      const candidates = keyFallbacks[i] ?? [];
      let value: unknown = undefined;
      for (const key of candidates) {
        if (Object.hasOwn(obj, key)) {
          value = obj[key];
          break;
        }
      }
      // Final fallback: try the snake-cased header itself
      if (value === undefined) {
        const headerKey = headers[i].toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
        if (Object.hasOwn(obj, headerKey)) {
          value = obj[headerKey];
        }
      }
      row.push(normalizeCell(value));
    }
    rows.push(row);
  }
  return rows;
}

function normalizeCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  // For objects/arrays, JSON-stringify so the cell shows SOMETHING
  // useful rather than [object Object]
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pickNumber(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pickString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

function safeArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}
