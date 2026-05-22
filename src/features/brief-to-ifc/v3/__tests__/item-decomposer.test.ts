/**
 * Item Decomposer (TR-028) unit tests.
 *
 * Tests schema validation, skip logic, and cost guardrails.
 * Uses a mocked Anthropic client — no live API calls.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { furniturePartSchema } from "../types";
import type { BriefSpec } from "../types";
import { decomposeBriefSpecItems } from "../item-decomposer";

// ─── Helpers ──────────────────────────────────────────────────────────

const VALID_PARTS_JSON = JSON.stringify([
  {
    id: "leg_1",
    subtype: "tripod_leg",
    origin_local_m: [0.3, 0, 0],
    dims_m: [0.02, 0.02, 0.7],
    shape: "cylinder",
    rotation_z_rad: 0,
    material_id: "carbon_fiber",
    ifc_class: "IfcFurnishingElement",
  },
  {
    id: "leg_2",
    subtype: "tripod_leg",
    origin_local_m: [-0.15, 0.26, 0],
    dims_m: [0.02, 0.02, 0.7],
    shape: "cylinder",
    rotation_z_rad: 0,
    material_id: "carbon_fiber",
    ifc_class: "IfcFurnishingElement",
  },
  {
    id: "leg_3",
    subtype: "tripod_leg",
    origin_local_m: [-0.15, -0.26, 0],
    dims_m: [0.02, 0.02, 0.7],
    shape: "cylinder",
    rotation_z_rad: 0,
    material_id: "carbon_fiber",
    ifc_class: "IfcFurnishingElement",
  },
  {
    id: "column",
    subtype: "center_column",
    origin_local_m: [0, 0, 0.7],
    dims_m: [0.03, 0.03, 0.5],
    shape: "cylinder",
    rotation_z_rad: 0,
    material_id: "aluminium",
    ifc_class: "IfcFurnishingElement",
  },
  {
    id: "head",
    subtype: "ball_head",
    origin_local_m: [0, 0, 1.2],
    dims_m: [0.05, 0.05, 0.06],
    shape: "cylinder",
    rotation_z_rad: 0,
    material_id: "black_steel",
    ifc_class: "IfcFurnishingElement",
  },
  {
    id: "camera",
    subtype: "camera_body",
    origin_local_m: [0, 0, 1.26],
    dims_m: [0.15, 0.1, 0.1],
    shape: "box",
    rotation_z_rad: 0,
    material_id: "camera_black",
    ifc_class: "IfcDiscreteAccessory",
  },
]);

function makeMockAnthropicClient(
  responses: Array<{ text: string; inputTokens: number; outputTokens: number }>,
) {
  let callIndex = 0;
  return () => ({
    messages: {
      stream: () => {
        const resp = responses[Math.min(callIndex++, responses.length - 1)];
        return {
          finalMessage: () =>
            Promise.resolve({
              content: [{ type: "text" as const, text: resp.text }],
              usage: {
                input_tokens: resp.inputTokens,
                output_tokens: resp.outputTokens,
              },
            }),
        };
      },
    },
  });
}

function makeMinimalSpec(furniture?: BriefSpec["furniture"]): BriefSpec {
  return {
    project: {
      name: "Test",
      type: "office",
      location: "Test",
      description: "Test",
    },
    site: { bounds_m: [10, 10], height_limit_m: 20, coordinate_origin: "sw_corner" },
    spaces: [
      {
        id: "sp-1",
        name: "Office",
        long_name: "Main Office",
        polygon_world_m: [[0, 0], [10, 0], [10, 10], [0, 10]],
        height_m: 3,
        occupancy_type: "Office",
      },
    ],
    elements: [],
    materials: [
      {
        id: "mat-1",
        name: "White Paint",
        rgb: [0.95, 0.95, 0.95],
        roughness: 0.3,
        method: "MATT",
        category: "finish",
      },
    ],
    brand_language: {
      primary_text: "Test",
      approved_terms: [],
      forbidden_terms: [],
    },
    furniture: furniture ?? [
      {
        id: "tripod-1",
        type: "tripod",
        count: 1,
        bounding_box: [0.9, 0.9, 1.55],
        material_id: "mat-1",
        description: "Camera tripod",
      },
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("furniturePartSchema", () => {
  it("validates a well-formed parts array", () => {
    const parts = JSON.parse(VALID_PARTS_JSON);
    const result = z.array(furniturePartSchema).safeParse(parts);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(6);
      expect(result.data[0].id).toBe("leg_1");
      expect(result.data[0].shape).toBe("cylinder");
      expect(result.data[5].ifc_class).toBe("IfcDiscreteAccessory");
    }
  });

  it("rejects parts with missing required fields", () => {
    const result = furniturePartSchema.safeParse({
      id: "test",
      // missing subtype, origin_local_m, dims_m, material_id
    });
    expect(result.success).toBe(false);
  });

  it("applies defaults for shape, rotation_z_rad, ifc_class", () => {
    const result = furniturePartSchema.safeParse({
      id: "test_part",
      subtype: "leg",
      origin_local_m: [0, 0, 0],
      dims_m: [0.1, 0.1, 0.5],
      material_id: "chrome_steel",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shape).toBe("box");
      expect(result.data.rotation_z_rad).toBe(0);
      expect(result.data.ifc_class).toBe("IfcFurnishingElement");
    }
  });
});

describe("decomposeBriefSpecItems", () => {
  it("skips trivial items (volume < threshold)", async () => {
    const spec = makeMinimalSpec([
      {
        id: "tiny",
        type: "screw",
        count: 1,
        bounding_box: [0.005, 0.005, 0.01], // volume = 0.00000025 m³
        material_id: "mat-1",
        description: "Tiny screw",
      },
    ]);

    const mockFactory = makeMockAnthropicClient([
      { text: VALID_PARTS_JSON, inputTokens: 100, outputTokens: 200 },
    ]);

    const result = await decomposeBriefSpecItems(spec, "office", {
      clientFactory: mockFactory as unknown as () => import("@anthropic-ai/sdk").default,
    });

    expect(result.metrics.skipped).toBe(1);
    expect(result.metrics.decomposed_items).toBe(0);
    expect(result.metrics.opus_calls).toBe(0);
  });

  it("decomposes non-trivial items successfully", async () => {
    const spec = makeMinimalSpec();
    const mockFactory = makeMockAnthropicClient([
      { text: VALID_PARTS_JSON, inputTokens: 500, outputTokens: 1000 },
    ]);

    const result = await decomposeBriefSpecItems(spec, "office", {
      clientFactory: mockFactory as unknown as () => import("@anthropic-ai/sdk").default,
    });

    expect(result.metrics.decomposed_items).toBe(1);
    expect(result.metrics.total_parts).toBe(6);
    expect(result.metrics.opus_calls).toBe(1);
    expect(result.spec.furniture![0].parts).toHaveLength(6);
  });

  it("stops further calls when cost guardrail is hit", async () => {
    // Two furniture items; first call costs enough to trip the guardrail
    const spec = makeMinimalSpec([
      {
        id: "item-1",
        type: "desk",
        count: 1,
        bounding_box: [1.2, 0.6, 0.75],
        material_id: "mat-1",
        description: "Desk",
      },
      {
        id: "item-2",
        type: "chair",
        count: 1,
        bounding_box: [0.5, 0.5, 1.0],
        material_id: "mat-1",
        description: "Chair",
      },
    ]);

    // Each call uses enough tokens to exceed the $0.01 guardrail
    // Cost per call: (10000 * 5 + 5000 * 25) / 1_000_000 = 0.175
    const mockFactory = makeMockAnthropicClient([
      { text: VALID_PARTS_JSON, inputTokens: 10_000, outputTokens: 5_000 },
      { text: VALID_PARTS_JSON, inputTokens: 10_000, outputTokens: 5_000 },
    ]);

    const result = await decomposeBriefSpecItems(spec, "office", {
      clientFactory: mockFactory as unknown as () => import("@anthropic-ai/sdk").default,
      maxCostUsd: 0.01, // Very low guardrail
      concurrency: 1, // Sequential to make cost guardrail deterministic
    });

    // First item decomposes, second gets skipped by cost guardrail
    expect(result.metrics.decomposed_items).toBe(1);
    expect(result.metrics.skipped).toBe(1);
    expect(result.metrics.cost_usd).toBeGreaterThan(0.01);
  });

  it("retries on invalid JSON response", async () => {
    const spec = makeMinimalSpec();
    const mockFactory = makeMockAnthropicClient([
      // First call returns invalid JSON
      { text: "Here are the parts:\n\nNot JSON", inputTokens: 100, outputTokens: 100 },
      // Retry returns valid JSON
      { text: VALID_PARTS_JSON, inputTokens: 100, outputTokens: 200 },
    ]);

    const result = await decomposeBriefSpecItems(spec, "office", {
      clientFactory: mockFactory as unknown as () => import("@anthropic-ai/sdk").default,
    });

    expect(result.metrics.retries).toBe(1);
    expect(result.metrics.decomposed_items).toBe(1);
    expect(result.metrics.opus_calls).toBe(2);
  });

  it("handles empty furniture array gracefully", async () => {
    const spec = makeMinimalSpec([]);
    const result = await decomposeBriefSpecItems(spec, "office");
    expect(result.metrics.decomposed_items).toBe(0);
    expect(result.metrics.skipped).toBe(0);
    expect(result.metrics.opus_calls).toBe(0);
  });

  it("skips items that already have parts", async () => {
    const spec = makeMinimalSpec([
      {
        id: "already-decomposed",
        type: "desk",
        count: 1,
        bounding_box: [1.2, 0.6, 0.75],
        material_id: "mat-1",
        description: "Already decomposed desk",
        parts: [
          {
            id: "existing_part",
            subtype: "top",
            origin_local_m: [0, 0, 0.72],
            dims_m: [1.2, 0.6, 0.03],
            shape: "box" as const,
            rotation_z_rad: 0,
            material_id: "wood_oak",
            ifc_class: "IfcFurnishingElement" as const,
          },
        ],
      },
    ]);

    const mockFactory = makeMockAnthropicClient([
      { text: VALID_PARTS_JSON, inputTokens: 100, outputTokens: 200 },
    ]);

    const result = await decomposeBriefSpecItems(spec, "office", {
      clientFactory: mockFactory as unknown as () => import("@anthropic-ai/sdk").default,
    });

    expect(result.metrics.skipped).toBe(1);
    expect(result.metrics.decomposed_items).toBe(0);
    expect(result.metrics.opus_calls).toBe(0);
  });
});
