/**
 * Unit tests for kos-formwork-generator.ts.
 *
 * Mirrors kos-boq-generator.test.ts but with the formwork-specific
 * differences:
 *  - error-code prefix `KOS_FRM_GEN_*`
 *  - response fixture has 15 top-level keys (no `commercial_terms`)
 *  - sidecar error envelope canonical example is `FORMWORK_INPUT_INVALID`
 *  - response top-level includes `tier_6_components` (not tier_6_panel_pieces)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callJsonSidecarMock } = vi.hoisted(() => ({
  callJsonSidecarMock: vi.fn(),
}));

vi.mock("@/features/kos/services/_sidecar-client", () => ({
  callJsonSidecar: callJsonSidecarMock,
}));

import { generateFormwork } from "../kos-formwork-generator";
import { KosError } from "@/features/kos/lib/kos-errors";
import type {
  FormworkOutput,
  MapperOutput,
} from "@/features/kos/types/sidecar";

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

function buildFormworkOutputFixture(): FormworkOutput {
  return {
    formwork_id: "formwork_test",
    generated_at: "2026-05-27T00:00:00Z",
    schema_version: "0.1.0",
    tier_1_summary: {},
    tier_2_categories: {},
    tier_3_sku_types: [],
    tier_4_sku_details: [],
    tier_5_wall_segments: [],
    tier_6_components: [],
    custom_quote_items: [],
    operator_review_items: [],
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

describe("generateFormwork", () => {
  beforeEach(() => {
    callJsonSidecarMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: returns sidecar response verbatim", async () => {
    const expected = buildFormworkOutputFixture();
    callJsonSidecarMock.mockResolvedValueOnce(expected);

    const result = await generateFormwork({
      tenantId: "tenant_1",
      mapperOutput: buildMapperOutputFixture(),
      context: validContext,
    });
    expect(result).toEqual(expected);
  });

  it("request body has mapper_output + context shape; uses /formwork/generate endpoint with KOS_FRM_GEN prefix", async () => {
    callJsonSidecarMock.mockResolvedValueOnce(buildFormworkOutputFixture());
    const mapperOut = buildMapperOutputFixture();

    await generateFormwork({
      tenantId: "tenant_1",
      mapperOutput: mapperOut,
      context: validContext,
    });

    const callArgs = callJsonSidecarMock.mock.calls[0][0];
    expect(callArgs.endpoint).toBe("/formwork/generate");
    expect(callArgs.errorCodePrefix).toBe("KOS_FRM_GEN");
    expect(callArgs.tenantId).toBe("tenant_1");
    expect(callArgs.timeoutMs).toBe(180_000);
    expect(callArgs.body.mapper_output).toBe(mapperOut);
    expect(callArgs.body.context).toEqual(validContext);
  });

  it("Formwork output fixture is 15 top-level keys (NOT 16 — commercial_terms absent per Karthik 2026-05-26)", () => {
    const keys = Object.keys(buildFormworkOutputFixture());
    expect(keys).toHaveLength(15);
    expect(keys).not.toContain("commercial_terms");
    expect(keys).toContain("tier_6_components");
    expect(keys).not.toContain("tier_6_panel_pieces");
  });

  describe("defensive context validation", () => {
    it("missing project_id → KosError KOS_FRM_GEN_001 BEFORE calling sidecar", async () => {
      await expect(
        generateFormwork({
          tenantId: "tenant_1",
          mapperOutput: buildMapperOutputFixture(),
          context: { ...validContext, project_id: "" },
        }),
      ).rejects.toMatchObject({ code: "KOS_FRM_GEN_001", httpStatus: 400 });
      expect(callJsonSidecarMock).not.toHaveBeenCalled();
    });

    it("missing project_name → KosError KOS_FRM_GEN_002", async () => {
      await expect(
        generateFormwork({
          tenantId: "tenant_1",
          mapperOutput: buildMapperOutputFixture(),
          context: { ...validContext, project_name: "" },
        }),
      ).rejects.toMatchObject({ code: "KOS_FRM_GEN_002" });
    });

    it("missing quote_date → KosError KOS_FRM_GEN_003", async () => {
      await expect(
        generateFormwork({
          tenantId: "tenant_1",
          mapperOutput: buildMapperOutputFixture(),
          context: { ...validContext, quote_date: "" },
        }),
      ).rejects.toMatchObject({ code: "KOS_FRM_GEN_003" });
    });

    it("malformed quote_date → KosError KOS_FRM_GEN_004 with the bad value in the message", async () => {
      let caught: unknown;
      try {
        await generateFormwork({
          tenantId: "tenant_1",
          mapperOutput: buildMapperOutputFixture(),
          context: { ...validContext, quote_date: "May 27, 2026" },
        });
      } catch (e) {
        caught = e;
      }
      const err = caught as KosError;
      expect(err.code).toBe("KOS_FRM_GEN_004");
      expect(err.message).toContain("May 27, 2026");
    });
  });

  describe("schema-drift regression catcher", () => {
    it("simulated sidecar 422 with FORMWORK_INPUT_INVALID envelope → surfaced via KOS_FRM_GEN_SIDECAR_4XX", async () => {
      callJsonSidecarMock.mockRejectedValueOnce(
        new KosError(
          "KOS_FRM_GEN_SIDECAR_4XX",
          "FORMWORK_INPUT_INVALID: Failed to parse context: FormworkContext.__init__() missing 2 required positional arguments: 'project_id' and 'quote_date' (hint: Verify context schema matches FormworkContext.) [status=422]",
          400,
        ),
      );

      let caught: unknown;
      try {
        await generateFormwork({
          tenantId: "tenant_1",
          mapperOutput: buildMapperOutputFixture(),
          context: validContext,
        });
      } catch (e) {
        caught = e;
      }
      const err = caught as KosError;
      expect(err.code).toBe("KOS_FRM_GEN_SIDECAR_4XX");
      expect(err.message).toContain("FORMWORK_INPUT_INVALID");
      expect(err.message).toContain("FormworkContext");
      expect(err.message).toContain("missing 2 required positional arguments");
    });
  });
});
