/**
 * Architectural Reasoner regression tests (Phase Beta 3).
 *
 * Tests the 601ms bypass fix: the Reasoner must ALWAYS call Opus when
 * furniture items are present, even if designRationale is already populated.
 */

import { describe, it, expect } from "vitest";

import { applyArchitecturalReasoning } from "../architectural-reasoner";
import type { BriefSpec } from "../types";

// ─── Mock Anthropic client factory ─────────────────────────────────────

function makeMockAnthropicClient(
  responses: Array<{ text: string; inputTokens: number; outputTokens: number }>,
  delayMs = 0,
) {
  let callIndex = 0;
  return () => ({
    messages: {
      stream: () => {
        const resp = responses[Math.min(callIndex++, responses.length - 1)];
        return {
          finalMessage: () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    content: [{ type: "text" as const, text: resp.text }],
                    usage: {
                      input_tokens: resp.inputTokens,
                      output_tokens: resp.outputTokens,
                    },
                  }),
                delayMs,
              ),
            ),
        };
      },
    },
  });
}

// ─── Fixtures ──────────────────────────────────────────────────────────

function makeSpec(overrides?: Partial<BriefSpec>): BriefSpec {
  return {
    project: { name: "Test", type: "office", location: "Mumbai", description: "Test" },
    site: { bounds_m: [10, 8], height_limit_m: 4, coordinate_origin: "sw_corner" },
    spaces: [{ id: "s1", name: "Room", long_name: "Room 1", polygon_world_m: [[0,0],[10,0],[10,8],[0,8]], height_m: 3, occupancy_type: "office" }],
    elements: [],
    materials: [{ id: "m1", name: "Wood", rgb: [0.6, 0.4, 0.2], roughness: 0.5, method: "MATT", category: "Interior" }],
    brand_language: { primary_text: "Modern", approved_terms: [], forbidden_terms: [] },
    furniture: [
      { id: "f1", type: "desk", count: 1, material_id: "m1", description: "Office desk", anchor_space_id: "s1" },
      { id: "f2", type: "chair", count: 1, material_id: "m1", description: "Office chair", anchor_space_id: "s1" },
    ],
    ...overrides,
  };
}

const VALID_RATIONALE_JSON = JSON.stringify([
  { itemId: "f1", position: [2.0, 1.5, 0], rotation_z_rad: 0, rationale: "Desk against north wall for natural light" },
  { itemId: "f2", position: [2.0, 0.8, 0], rotation_z_rad: 3.14, rationale: "Chair behind desk facing door" },
]);

// ─── Tests ─────────────────────────────────────────────────────────────

describe("Architectural Reasoner — 601ms bypass fix", () => {
  it("calls Opus even when designRationale is already populated (bypass removed)", async () => {
    const factory = makeMockAnthropicClient([
      { text: VALID_RATIONALE_JSON, inputTokens: 500, outputTokens: 200 },
    ]);
    const specWithExistingRationale = makeSpec({
      designRationale: [
        { itemId: "f1", position: [0, 0, 0], rotation_z_rad: 0, rationale: "stale" },
      ],
    });

    const result = await applyArchitecturalReasoning(specWithExistingRationale, {
      clientFactory: factory as unknown as () => import("@anthropic-ai/sdk").default,
    });

    // Opus was called (not skipped)
    expect(result.metrics.opus_calls).toBeGreaterThanOrEqual(1);
    // New rationale overwrites old
    expect(result.spec.designRationale).toHaveLength(2);
    expect(result.spec.designRationale![0].rationale).not.toBe("stale");
  });

  it("wall_time reflects actual Opus call duration (proves API was invoked)", async () => {
    const delay = 200; // 200ms simulated API delay
    const factory = makeMockAnthropicClient(
      [{ text: VALID_RATIONALE_JSON, inputTokens: 500, outputTokens: 200 }],
      delay,
    );
    const spec = makeSpec();

    const result = await applyArchitecturalReasoning(spec, {
      clientFactory: factory as unknown as () => import("@anthropic-ai/sdk").default,
    });

    // Wall time should reflect the delay (at least 150ms to account for overhead)
    expect(result.metrics.wall_time_ms).toBeGreaterThanOrEqual(150);
    expect(result.metrics.opus_calls).toBe(1);
  });

  it("returns designRationale matching input furniture items count", async () => {
    const factory = makeMockAnthropicClient([
      { text: VALID_RATIONALE_JSON, inputTokens: 500, outputTokens: 200 },
    ]);
    const spec = makeSpec();

    const result = await applyArchitecturalReasoning(spec, {
      clientFactory: factory as unknown as () => import("@anthropic-ai/sdk").default,
    });

    expect(result.spec.designRationale).toHaveLength(2); // matches 2 furniture items
    expect(result.metrics.rationale_count).toBe(2);
  });

  it("throws on client creation failure (no silent swallow)", async () => {
    await expect(
      applyArchitecturalReasoning(makeSpec(), {
        clientFactory: () => { throw new Error("No API key"); },
      }),
    ).rejects.toThrow("Anthropic client creation failed");
  });

  it("skips Opus when furniture array is empty (valid early return)", async () => {
    let opusCalled = false;
    const factory = () => {
      opusCalled = true;
      return {} as import("@anthropic-ai/sdk").default;
    };

    const result = await applyArchitecturalReasoning(makeSpec({ furniture: [] }), {
      clientFactory: factory,
    });

    expect(opusCalled).toBe(false);
    expect(result.metrics.opus_calls).toBe(0);
    expect(result.metrics.wall_time_ms).toBeLessThan(100);
  });

  it("retries on first validation failure", async () => {
    const factory = makeMockAnthropicClient([
      { text: "not valid json", inputTokens: 500, outputTokens: 100 },
      { text: VALID_RATIONALE_JSON, inputTokens: 500, outputTokens: 200 },
    ]);

    const result = await applyArchitecturalReasoning(makeSpec(), {
      clientFactory: factory as unknown as () => import("@anthropic-ai/sdk").default,
    });

    expect(result.metrics.opus_calls).toBe(2);
    expect(result.spec.designRationale).toHaveLength(2);
  });
});
