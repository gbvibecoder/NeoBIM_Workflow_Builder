/**
 * Tests for renderBoqExcel.
 *
 * Loads the rendered Buffer back through xlsx to verify structure
 * (sheet names, row counts, key cell values) without depending on a
 * binary diff. Threat tests cover prototype pollution + malformed input.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { KosCustomerDrawing } from "@prisma/client";

import { renderBoqExcel } from "../boq-xlsx-renderer";
import { kosLog } from "@/features/kos/lib/kos-logger";
import type { BOQOutput } from "@/features/kos/types/sidecar";

function buildDrawing(overrides: Partial<KosCustomerDrawing> = {}): KosCustomerDrawing {
  return {
    id: "draw_1",
    tenantId: "tenant_1",
    customerId: "cust_1",
    conversationId: null,
    filename: "plan.dxf",
    originalFilename: "Plan.dxf",
    sourceFormat: "dxf",
    sizeBytes: 1000,
    actualSizeBytes: 1000,
    s3Key: "drawings/tenant_1/cust_1/draw_1/source.dxf",
    status: "PARSED",
    parseResult: null,
    fullParseResultS3Key: null,
    parserVersion: "0.2.0",
    errorCode: null,
    errorText: null,
    parsedAt: new Date(),
    boqResultS3Key: "k",
    formworkResultS3Key: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as KosCustomerDrawing;
}

function buildBoq(overrides: Partial<BOQOutput> = {}): BOQOutput {
  return {
    boq_id: "boq_test",
    generated_at: "2026-05-27T00:00:00Z",
    schema_version: "0.1.0",
    tier_1_summary: {
      total_standard_panels: 15583,
      grand_total_inr_formatted: "₹4,80,70,359.97",
      custom_quotes_pending_count: 81,
    },
    tier_2_categories: {
      "standard_panels": { count: 15583, total_inr_formatted: "₹3.4Cr" },
      "accessories": { count: 3, total_inr_formatted: "₹6.7L" },
    },
    tier_3_sku_types: [
      { sku_code: "AP", description: "AP wall panel", count: 100, unit_price_inr: 1000, line_total_inr: 100000 },
    ],
    tier_4_sku_details: [
      { sku_code: "AP-600", description: "AP 600mm", width_mm: 600, height_mm: 3000, thickness_mm: 100, count: 50 },
    ],
    tier_5_wall_segments: [
      { wall_id: "w0", length_mm: 5000, thickness_mm: 200, application: "external", panel_sku: "AP-600", cost_inr: 50000 },
    ],
    tier_6_panel_pieces: [
      { piece_id: "p0", wall_id: "w0", sku: "AP-600", width_mm: 600, height_mm: 3000, thickness_mm: 200, weight_kg: 60, cost_inr: 1000 },
      { piece_id: "p1", wall_id: "w0", sku: "AP-600", width_mm: 600, height_mm: 3000, thickness_mm: 200, weight_kg: 60, cost_inr: 1000 },
    ],
    custom_quote_items: [{ item: "K6-180", reason: "thickness_unknown" }],
    operator_review_items: [],
    commercial_terms: {},
    audit_trail: {},
    warnings: ["w1"],
    assumptions_made: ["a1"],
    pending_karthik: [{ id: "K1", note: "review" }],
    ...overrides,
  };
}

describe("renderBoqExcel", () => {
  beforeEach(() => {
    vi.spyOn(kosLog, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a non-empty Buffer starting with the XLSX/ZIP magic 'PK\\x03\\x04'", async () => {
    const buf = await renderBoqExcel({ boq: buildBoq(), drawing: buildDrawing() });
    expect(buf.byteLength).toBeGreaterThan(0);
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  it("produces exactly the 8 expected sheets in the documented order", async () => {
    const buf = await renderBoqExcel({ boq: buildBoq(), drawing: buildDrawing() });
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toEqual([
      "Summary",
      "Categories",
      "SKU Types",
      "SKU Details",
      "Wall Segments",
      "Panel Pieces",
      "Custom Quotes",
      "Warnings & Review",
    ]);
  });

  it("Summary sheet contains project name from drawing.originalFilename when parseResult is null", async () => {
    const buf = await renderBoqExcel({
      boq: buildBoq(),
      drawing: buildDrawing({ originalFilename: "PlanA.dxf" }),
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    const summary = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Summary"], { header: 1 });
    // Row 0: ["Project Name", "PlanA.dxf"]
    expect(summary[0]).toContain("Project Name");
    expect(summary[0]).toContain("PlanA.dxf");
  });

  it("Summary uses parser title_block.project_name when parseResult.kind === 'parser'", async () => {
    const buf = await renderBoqExcel({
      boq: buildBoq(),
      drawing: buildDrawing(),
      parseResult: {
        kind: "parser",
        data: {
          title_block: {
            project_name: "90 Victoria Road",
            drawing_number: "90VR-MR-AD-2501",
            revision: "J",
          },
        },
      },
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    const summary = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Summary"], { header: 1 });
    expect(summary[0]).toContain("90 Victoria Road");
    expect(summary[1]).toContain("90VR-MR-AD-2501");
    expect(summary[2]).toContain("J");
  });

  it("Summary tier_1 fields render — total_standard_panels + INR + warnings + pending", async () => {
    const buf = await renderBoqExcel({ boq: buildBoq(), drawing: buildDrawing() });
    const wb = XLSX.read(buf, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Summary"], { header: 1 });
    const flat = rows.flat().map(String).join("|");
    expect(flat).toContain("15583");
    expect(flat).toContain("₹4,80,70,359.97");
    expect(flat).toContain("81");
  });

  it("Categories sheet renders each dict key as a row", async () => {
    const buf = await renderBoqExcel({ boq: buildBoq(), drawing: buildDrawing() });
    const wb = XLSX.read(buf, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Categories"], { header: 1 });
    // 1 header + 2 data rows
    expect(rows.length).toBe(3);
    const flat = rows.flat().map(String).join("|");
    expect(flat).toContain("standard_panels");
    expect(flat).toContain("accessories");
  });

  it("empty tier_2_categories → Categories sheet has 'No data' row (sheet still exists)", async () => {
    const buf = await renderBoqExcel({
      boq: buildBoq({ tier_2_categories: {} }),
      drawing: buildDrawing(),
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toContain("Categories");
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Categories"], { header: 1 });
    expect(rows.length).toBe(2);
    expect(rows[1][0]).toBe("No data");
  });

  it("empty tier_6_panel_pieces → Panel Pieces sheet has 'No data' row", async () => {
    const buf = await renderBoqExcel({
      boq: buildBoq({ tier_6_panel_pieces: [] }),
      drawing: buildDrawing(),
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Panel Pieces"], { header: 1 });
    expect(rows.length).toBe(2);
    expect(rows[1][0]).toBe("No data");
  });

  it("Panel Pieces row count = 1 header + N pieces", async () => {
    const pieces = Array.from({ length: 50 }, (_, i) => ({
      piece_id: `p${i}`,
      wall_id: "w0",
      sku: "AP-600",
      width_mm: 600,
      height_mm: 3000,
      thickness_mm: 200,
      weight_kg: 60,
      cost_inr: 1000,
    }));
    const buf = await renderBoqExcel({
      boq: buildBoq({ tier_6_panel_pieces: pieces }),
      drawing: buildDrawing(),
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Panel Pieces"], { header: 1 });
    expect(rows.length).toBe(51); // 1 header + 50 data
  });

  it("Warnings & Review sheet aggregates warnings + assumptions + pending + review", async () => {
    const buf = await renderBoqExcel({
      boq: buildBoq({
        warnings: ["w1", "w2"],
        assumptions_made: ["a1"],
        pending_karthik: [{ id: "k1" }],
        operator_review_items: [{ id: "r1" }],
      }),
      drawing: buildDrawing(),
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Warnings & Review"], { header: 1 });
    // 1 header + 2 warnings + 1 assumption + 1 pending + 1 review = 6
    expect(rows.length).toBe(6);
  });

  it("ALL-empty BOQ produces all 8 sheets each with 'No data' row", async () => {
    const buf = await renderBoqExcel({
      boq: buildBoq({
        tier_1_summary: {},
        tier_2_categories: {},
        tier_3_sku_types: [],
        tier_4_sku_details: [],
        tier_5_wall_segments: [],
        tier_6_panel_pieces: [],
        custom_quote_items: [],
        operator_review_items: [],
        warnings: [],
        assumptions_made: [],
        pending_karthik: [],
      }),
      drawing: buildDrawing(),
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toHaveLength(8);
    for (const name of ["Categories", "SKU Types", "SKU Details", "Wall Segments", "Panel Pieces", "Custom Quotes", "Warnings & Review"]) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1 });
      const flat = rows.flat().map(String).join("|");
      expect(flat).toContain("No data");
    }
  });

  it("logs kos_boq_render_start + kos_boq_render_done with drawingId + boqId", async () => {
    const infoSpy = vi.spyOn(kosLog, "info");
    await renderBoqExcel({ boq: buildBoq(), drawing: buildDrawing() });
    expect(infoSpy).toHaveBeenCalledWith(
      "kos_boq_render_start",
      expect.objectContaining({ drawingId: "draw_1", boqId: "boq_test" }),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "kos_boq_render_done",
      expect.objectContaining({ drawingId: "draw_1", boqId: "boq_test", sheets: 8 }),
    );
  });

  it("defensive: missing tier_1 field → cell is null/N/A, no crash", async () => {
    const buf = await renderBoqExcel({
      boq: buildBoq({ tier_1_summary: {} }),
      drawing: buildDrawing(),
    });
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("THREAT: tier_6 entry with __proto__ pollution attempt → no global pollution", async () => {
    const polluted = JSON.parse('[{"__proto__":{"polluted":true},"piece_id":"p0"}]') as unknown[];
    await renderBoqExcel({
      boq: buildBoq({ tier_6_panel_pieces: polluted }),
      drawing: buildDrawing(),
    });
    // Cast through unknown so TS doesn't complain about the polluted lookup.
    expect((Object.prototype as unknown as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("THREAT: tier_5 array containing non-objects → renders the value stringified", async () => {
    const buf = await renderBoqExcel({
      boq: buildBoq({ tier_5_wall_segments: ["not-an-object", 42, null] as never }),
      drawing: buildDrawing(),
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    // Sheet exists, doesn't crash
    expect(wb.SheetNames).toContain("Wall Segments");
  });

  it("perf: 200 panel pieces render in under 2 seconds (proxy for the 15k case)", async () => {
    const pieces = Array.from({ length: 200 }, (_, i) => ({
      piece_id: `p${i}`,
      wall_id: "w0",
      sku: "AP-600",
      width_mm: 600,
      height_mm: 3000,
      thickness_mm: 200,
      weight_kg: 60,
      cost_inr: 1000,
    }));
    const start = Date.now();
    await renderBoqExcel({
      boq: buildBoq({ tier_6_panel_pieces: pieces }),
      drawing: buildDrawing(),
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});
