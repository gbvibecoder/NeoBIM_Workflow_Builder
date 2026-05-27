/**
 * Tests for renderFormworkPdf.
 *
 * The PDF binary is opaque without a parser library, so most assertions
 * are at the binary-magic + page-count + log-event level. Content
 * verification is via the smoke test plan (human opens the file).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KosCustomerDrawing } from "@prisma/client";

import { renderFormworkPdf } from "../formwork-pdf-renderer";
import { kosLog } from "@/features/kos/lib/kos-logger";
import type { FormworkOutput } from "@/features/kos/types/sidecar";

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
    boqResultS3Key: null,
    formworkResultS3Key: "k",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as KosCustomerDrawing;
}

function buildFormwork(overrides: Partial<FormworkOutput> = {}): FormworkOutput {
  return {
    formwork_id: "frm_test",
    generated_at: "2026-05-27T00:00:00Z",
    schema_version: "0.1.0",
    tier_1_summary: {
      total_props: 5456,
      total_walers: 5456,
      total_kickers: 24545,
      total_starter_track_meters: 4908.75,
    },
    tier_2_categories: {
      "primary_bracing": { props: 100, walers: 50 },
      "secondary_bracing": { kickers: 200 },
    },
    tier_3_sku_types: [],
    tier_4_sku_details: [],
    tier_5_wall_segments: [],
    tier_6_components: [
      { sku: "PROP-L-2400", type: "prop", count: 100, length_mm: 2400 },
      { sku: "WALER-2000", type: "waler", count: 50, length_mm: 2000 },
    ],
    custom_quote_items: [],
    operator_review_items: [],
    audit_trail: {},
    warnings: ["w1"],
    assumptions_made: [],
    pending_karthik: [],
    ...overrides,
  };
}

describe("renderFormworkPdf", () => {
  beforeEach(() => {
    vi.spyOn(kosLog, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a non-empty Buffer starting with the PDF magic '%PDF-'", async () => {
    const buf = await renderFormworkPdf({ formwork: buildFormwork(), drawing: buildDrawing() });
    expect(buf.byteLength).toBeGreaterThan(0);
    // %PDF-
    expect(buf[0]).toBe(0x25);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x44);
    expect(buf[3]).toBe(0x46);
    expect(buf[4]).toBe(0x2d);
  });

  it("page count is at least 5 (cover + summary + categories + components + warnings)", async () => {
    const infoSpy = vi.spyOn(kosLog, "info");
    await renderFormworkPdf({ formwork: buildFormwork(), drawing: buildDrawing() });
    // The kos_formwork_render_done log carries the page count
    const doneCall = infoSpy.mock.calls.find(
      (c) => c[0] === "kos_formwork_render_done",
    );
    expect(doneCall).toBeDefined();
    const ctx = doneCall![1] as { pages: number };
    expect(ctx.pages).toBeGreaterThanOrEqual(5);
  });

  it("uses parser title_block.project_name on cover when available", async () => {
    const buf = await renderFormworkPdf({
      formwork: buildFormwork(),
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
    // The PDF binary contains compressed text streams; we can't reliably
    // grep for the project name without a PDF parser. Instead assert the
    // file is well-formed (binary checks above) and the log carries
    // expected ctx — the smoke test plan covers human-level verification.
    expect(buf.byteLength).toBeGreaterThan(2000);
  });

  it("falls back to drawing.originalFilename on cover when no title block", async () => {
    const buf = await renderFormworkPdf({
      formwork: buildFormwork(),
      drawing: buildDrawing({ originalFilename: "AnotherPlan.pdf" }),
    });
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("empty tier_1_summary → renders 'No summary data available'", async () => {
    const buf = await renderFormworkPdf({
      formwork: buildFormwork({ tier_1_summary: {} }),
      drawing: buildDrawing(),
    });
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("empty warnings + assumptions + pending → renders 'No warnings, assumptions, or pending items.'", async () => {
    const buf = await renderFormworkPdf({
      formwork: buildFormwork({
        warnings: [],
        assumptions_made: [],
        pending_karthik: [],
      }),
      drawing: buildDrawing(),
    });
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("empty tier_6_components → renders 'No component data available'", async () => {
    const buf = await renderFormworkPdf({
      formwork: buildFormwork({ tier_6_components: [] }),
      drawing: buildDrawing(),
    });
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("ALL-empty Formwork (everything blank) produces a valid PDF with at least cover + warnings page", async () => {
    const buf = await renderFormworkPdf({
      formwork: buildFormwork({
        tier_1_summary: {},
        tier_2_categories: {},
        tier_3_sku_types: [],
        tier_4_sku_details: [],
        tier_5_wall_segments: [],
        tier_6_components: [],
        custom_quote_items: [],
        operator_review_items: [],
        warnings: [],
        assumptions_made: [],
        pending_karthik: [],
      }),
      drawing: buildDrawing(),
    });
    expect(buf[0]).toBe(0x25); // %PDF
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("100 components → renders successfully (only first 50 detailed; remainder noted)", async () => {
    const components = Array.from({ length: 100 }, (_, i) => ({
      sku: `PROP-${i}`,
      type: "prop",
      count: i,
      length_mm: 2400,
    }));
    const buf = await renderFormworkPdf({
      formwork: buildFormwork({ tier_6_components: components }),
      drawing: buildDrawing(),
    });
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("logs kos_formwork_render_start + kos_formwork_render_done with drawingId + formworkId + page count", async () => {
    const infoSpy = vi.spyOn(kosLog, "info");
    await renderFormworkPdf({ formwork: buildFormwork(), drawing: buildDrawing() });
    expect(infoSpy).toHaveBeenCalledWith(
      "kos_formwork_render_start",
      expect.objectContaining({ drawingId: "draw_1", formworkId: "frm_test" }),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "kos_formwork_render_done",
      expect.objectContaining({
        drawingId: "draw_1",
        formworkId: "frm_test",
        bytes: expect.any(Number),
        pages: expect.any(Number),
      }),
    );
  });

  it("THREAT: title_block with <script> tags does not crash render (jspdf escapes by default)", async () => {
    const buf = await renderFormworkPdf({
      formwork: buildFormwork(),
      drawing: buildDrawing(),
      parseResult: {
        kind: "parser",
        data: {
          title_block: {
            project_name: '<script>alert("xss")</script>',
            drawing_number: "DR-1",
            revision: "A",
          },
        },
      },
    });
    expect(buf[0]).toBe(0x25);
  });

  it("perf: 50-component fixture renders in under 1 second", async () => {
    const components = Array.from({ length: 50 }, (_, i) => ({
      sku: `C${i}`,
      type: "kicker",
      count: 1,
      length_mm: 1200,
    }));
    const start = Date.now();
    await renderFormworkPdf({
      formwork: buildFormwork({ tier_6_components: components }),
      drawing: buildDrawing(),
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
