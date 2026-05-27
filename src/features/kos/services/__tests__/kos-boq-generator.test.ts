/**
 * Unit tests for kos-boq-generator.ts.
 *
 * Covers:
 *  - happy path (returns BOQOutput verbatim)
 *  - schema-drift regression catcher (BOQContext.__init__ 422)
 *  - defensive validation: project_id / project_name / quote_date /
 *    quote_date format
 *  - field-count regression on the BOQ output fixture (16 keys)
 *  - request body shape (mapper_output + context)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callJsonSidecarMock } = vi.hoisted(() => ({
  callJsonSidecarMock: vi.fn(),
}));

vi.mock("@/features/kos/services/_sidecar-client", () => ({
  callJsonSidecar: callJsonSidecarMock,
}));

import { generateBoq } from "../kos-boq-generator";
import { KosError } from "@/features/kos/lib/kos-errors";
import type { BOQOutput, MapperOutput } from "@/features/kos/types/sidecar";

function buildMapperOutputFixture(): MapperOutput {
  return {
    project_name: "test",
    seismic_zone: "III",
    split_strategy_used: "minimize_cuts",
    wall_height_mm: 3000,
    wall_segments: [],
    custom_quote_requests: [],
    total_counts: {},
    total_cost_inr: 0,
    total_weight_kg: 0,
    total_skin_kg: 0,
    total_rib_kg: 0,
    total_raw_kg: 0,
    total_waste_kg: 0,
    warnings: [],
    assumptions_made: [],
    pending_karthik: [],
    info_notes: [],
    schema_version: "0.1.0",
    generated_at: "2026-05-27T00:00:00Z",
    waste_ratio: 0,
    downstream_ready: { boq: true, formwork: true, shop_drawings: true },
    duration_ms: 0,
  };
}

function buildBoqOutputFixture(): BOQOutput {
  return {
    boq_id: "boq_test",
    generated_at: "2026-05-27T00:00:00+00:00",
    schema_version: "0.1.0",
    tier_1_summary: {},
    tier_2_categories: {},
    tier_3_sku_types: [],
    tier_4_sku_details: [],
    tier_5_wall_segments: [],
    tier_6_panel_pieces: [],
    custom_quote_items: [],
    operator_review_items: [],
    commercial_terms: {},
    audit_trail: {},
    warnings: [],
    assumptions_made: [],
    pending_karthik: [],
  };
}

const validContext = {
  project_id: "proj-001",
  project_name: "test",
  quote_date: "2026-05-27",
};

describe("generateBoq", () => {
  beforeEach(() => {
    callJsonSidecarMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: returns sidecar response verbatim", async () => {
    const expected = buildBoqOutputFixture();
    callJsonSidecarMock.mockResolvedValueOnce(expected);

    const result = await generateBoq({
      tenantId: "tenant_1",
      mapperOutput: buildMapperOutputFixture(),
      context: validContext,
    });

    expect(result).toEqual(expected);
  });

  it("request body has mapper_output + context shape exactly", async () => {
    callJsonSidecarMock.mockResolvedValueOnce(buildBoqOutputFixture());
    const mapperOut = buildMapperOutputFixture();

    await generateBoq({
      tenantId: "tenant_1",
      mapperOutput: mapperOut,
      context: validContext,
    });

    const callArgs = callJsonSidecarMock.mock.calls[0][0];
    expect(callArgs.endpoint).toBe("/boq/generate");
    expect(callArgs.errorCodePrefix).toBe("KOS_BOQ_GEN");
    expect(callArgs.tenantId).toBe("tenant_1");
    expect(callArgs.timeoutMs).toBe(180_000);
    expect(callArgs.body.mapper_output).toBe(mapperOut);
    expect(callArgs.body.context).toEqual(validContext);
  });

  it("BOQ output fixture is 16 top-level keys (sidecar schema regression catcher)", () => {
    // This duplicates the check in sidecar.types.test.ts but here for
    // localised confidence — if BOQOutput drifts, both tests fail
    // independently.
    const keys = Object.keys(buildBoqOutputFixture());
    expect(keys).toHaveLength(16);
    expect(keys).toContain("commercial_terms");
    expect(keys).toContain("tier_6_panel_pieces");
  });

  describe("defensive context validation (BOQContext schema undocumented in OpenAPI)", () => {
    it("missing project_id → KosError KOS_BOQ_GEN_001 BEFORE calling sidecar", async () => {
      let caught: unknown;
      try {
        await generateBoq({
          tenantId: "tenant_1",
          mapperOutput: buildMapperOutputFixture(),
          context: { ...validContext, project_id: "" },
        });
      } catch (e) {
        caught = e;
      }
      const err = caught as KosError;
      expect(err.code).toBe("KOS_BOQ_GEN_001");
      expect(err.httpStatus).toBe(400);
      expect(callJsonSidecarMock).not.toHaveBeenCalled();
    });

    it("missing project_name → KosError KOS_BOQ_GEN_002", async () => {
      await expect(
        generateBoq({
          tenantId: "tenant_1",
          mapperOutput: buildMapperOutputFixture(),
          context: { ...validContext, project_name: "" },
        }),
      ).rejects.toMatchObject({ code: "KOS_BOQ_GEN_002" });
      expect(callJsonSidecarMock).not.toHaveBeenCalled();
    });

    it("missing quote_date → KosError KOS_BOQ_GEN_003", async () => {
      await expect(
        generateBoq({
          tenantId: "tenant_1",
          mapperOutput: buildMapperOutputFixture(),
          context: { ...validContext, quote_date: "" },
        }),
      ).rejects.toMatchObject({ code: "KOS_BOQ_GEN_003" });
      expect(callJsonSidecarMock).not.toHaveBeenCalled();
    });

    it("malformed quote_date '2026-5-27' (missing zero pad) → KosError KOS_BOQ_GEN_004", async () => {
      await expect(
        generateBoq({
          tenantId: "tenant_1",
          mapperOutput: buildMapperOutputFixture(),
          context: { ...validContext, quote_date: "2026-5-27" },
        }),
      ).rejects.toMatchObject({ code: "KOS_BOQ_GEN_004" });
      expect(callJsonSidecarMock).not.toHaveBeenCalled();
    });

    it("malformed quote_date '27/05/2026' → KosError KOS_BOQ_GEN_004", async () => {
      await expect(
        generateBoq({
          tenantId: "tenant_1",
          mapperOutput: buildMapperOutputFixture(),
          context: { ...validContext, quote_date: "27/05/2026" },
        }),
      ).rejects.toMatchObject({ code: "KOS_BOQ_GEN_004" });
    });
  });

  describe("schema-drift regression catcher", () => {
    it("simulated sidecar 422 with the canonical BOQContext missing-args envelope → surfaced via KOS_BOQ_GEN_SIDECAR_4XX", async () => {
      // This is the EXACT 422 body the sidecar returned in
      // temp_folder/sidecar-capture/REPORT.md §5 v1. If Karthik changes
      // BOQContext upstream (adds/removes required fields), the wrapper's
      // defensive validation in §defensive will start letting bad
      // requests through and this branch will start firing in
      // integration — this test guards the shape we're handling.
      callJsonSidecarMock.mockRejectedValueOnce(
        new KosError(
          "KOS_BOQ_GEN_SIDECAR_4XX",
          "BOQ_INPUT_INVALID: Failed to parse context: BOQContext.__init__() missing 2 required positional arguments: 'project_id' and 'quote_date' (hint: Verify context schema matches BOQContext.) [status=422]",
          400,
        ),
      );

      let caught: unknown;
      try {
        await generateBoq({
          tenantId: "tenant_1",
          mapperOutput: buildMapperOutputFixture(),
          context: validContext,
        });
      } catch (e) {
        caught = e;
      }
      const err = caught as KosError;
      expect(err.code).toBe("KOS_BOQ_GEN_SIDECAR_4XX");
      expect(err.message).toContain("BOQ_INPUT_INVALID");
      expect(err.message).toContain("BOQContext");
      expect(err.message).toContain("missing 2 required positional arguments");
    });
  });
});
