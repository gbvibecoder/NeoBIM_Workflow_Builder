/**
 * Phase Beta 4 fixes — comprehensive tests.
 *
 * Covers: Spec Patcher blind patches, Reasoner hard crash,
 * Verifier source field + pessimistic fallback, Section 4g drift.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decidePatchesAndApply } from "../spec-patcher";
import { applyArchitecturalReasoning } from "../architectural-reasoner";
import { verifierReportSchema } from "../types";
import type { BriefSpec, VerifierReport, VisionReport } from "../types";
import { GENERATOR_SYSTEM_PROMPT } from "../generator/driver";

// ─── Fixtures ──────────────────────────────────────────────────────────

function makeSpec(furniture?: BriefSpec["furniture"]): BriefSpec {
  return {
    project: { name: "Test", type: "office", location: "Mumbai", description: "Test" },
    site: { bounds_m: [10, 8], height_limit_m: 4, coordinate_origin: "sw_corner" },
    spaces: [{ id: "s1", name: "Room", long_name: "Room", polygon_world_m: [[0,0],[10,0],[10,8],[0,8]], height_m: 3, occupancy_type: "office" }],
    elements: [],
    materials: [{ id: "m1", name: "Wood", rgb: [0.6, 0.4, 0.2], roughness: 0.5, method: "MATT", category: "Interior" }],
    brand_language: { primary_text: "Modern", approved_terms: [], forbidden_terms: [] },
    furniture: furniture ?? [
      { id: "f1", type: "desk", count: 1, material_id: "m1", description: "Office desk" },
      { id: "f2", type: "machine", count: 1, material_id: "m1", description: "Sewing machine" },
      { id: "f3", type: "chair", count: 1, material_id: "m1", description: "Simple chair" },
    ],
  };
}

function makeVR(overrides?: Partial<VerifierReport>): VerifierReport {
  return { verified: true, parts_coverage: 1.0, trim_coverage: 1.0, mismatches: [], summary: "OK", verified_at: "2026-05-18T00:00:00Z", source: "railway", ...overrides };
}

function makeVision(overrides?: Partial<VisionReport>): VisionReport {
  return { quality_score: 85, pass: true, issues: [], summary: "Good", inspected_at: "2026-05-18T00:00:00Z", ...overrides };
}

// ─── Section A: Spec Patcher blind patches ──────────────────────────────

describe("Spec Patcher — blind patches (β.4)", () => {
  it("quality=55 + verified=true (heuristic) + empty mismatches → STILL generates blind patches", async () => {
    const spec = makeSpec();
    const result = await decidePatchesAndApply(
      spec,
      makeVR({ verified: true, parts_coverage: 0.0, source: "heuristic_fallback", mismatches: [] }),
      makeVision({ quality_score: 55, pass: false }),
    );
    // Should generate blind patches for composite items (desk + machine)
    expect(result.needsPatch).toBe(true);
    expect(result.patches.length).toBeGreaterThanOrEqual(2);
    const forcePatches = result.patches.filter(p => p.patch_type === "force_parts");
    expect(forcePatches.some(p => p.item_id === "f1")).toBe(true); // desk
    expect(forcePatches.some(p => p.item_id === "f2")).toBe(true); // machine
  });

  it("quality=80 + verified=true + railway source → NO iteration", async () => {
    const result = await decidePatchesAndApply(
      makeSpec(),
      makeVR({ verified: true, parts_coverage: 0.95, source: "railway" }),
      makeVision({ quality_score: 80 }),
    );
    expect(result.needsPatch).toBe(false);
  });

  it("blind patches: 1-part desk + 0-part machine → force_parts for both", async () => {
    const spec = makeSpec([
      { id: "f1", type: "desk", count: 1, material_id: "m1", description: "Desk", parts: [
        { id: "p1", subtype: "top", origin_local_m: [0,0,0], dims_m: [1,0.5,0.03], material_id: "m1", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
      ]},
      { id: "f2", type: "machine", count: 1, material_id: "m1", description: "Machine" },
    ]);
    const result = await decidePatchesAndApply(
      spec,
      makeVR({ parts_coverage: 0.1, source: "heuristic_fallback", mismatches: [] }),
      makeVision({ quality_score: 40, pass: false }),
    );
    expect(result.patches.filter(p => p.patch_type === "force_parts")).toHaveLength(2);
  });

  it("non-composite chair is NOT blind-patched", async () => {
    const spec = makeSpec([
      { id: "f1", type: "chair", count: 1, material_id: "m1", description: "Simple chair" },
    ]);
    const result = await decidePatchesAndApply(
      spec,
      makeVR({ parts_coverage: 0.0, source: "heuristic_fallback", mismatches: [] }),
      makeVision({ quality_score: 50, pass: false }),
    );
    // chair is NOT composite → no blind patches
    expect(result.patches).toHaveLength(0);
  });

  it("wrong_class mismatch → generates fix_class patch", async () => {
    const result = await decidePatchesAndApply(
      makeSpec(),
      makeVR({
        parts_coverage: 0.5,
        mismatches: [
          { type: "wrong_class", item_id: "f1", expected: "IfcFurnishingElement", actual: "IfcBuildingElementProxy", severity: "high", description: "Wrong class" },
        ],
      }),
      makeVision({ quality_score: 55, pass: false }),
    );
    expect(result.patches.some(p => p.patch_type === "fix_class")).toBe(true);
  });
});

// ─── Section B: Architectural Reasoner hard crash ────────────────────────

describe("Architectural Reasoner — hard crash (β.4)", () => {
  it("throws when wall_time < 3000ms and furniture > 0 (bypass detected)", async () => {
    // Mock that returns invalid JSON instantly (simulates fast Opus error)
    const factory = () => ({
      messages: {
        stream: () => ({
          finalMessage: () => Promise.resolve({
            content: [{ type: "text" as const, text: "not valid json at all" }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        }),
      },
    });

    await expect(
      applyArchitecturalReasoning(makeSpec(), {
        clientFactory: factory as unknown as () => import("@anthropic-ai/sdk").default,
      }),
    ).rejects.toThrow(/Short-circuited/);
  });

  it("does NOT throw for slow failures (Opus was called, just returned bad JSON)", async () => {
    const factory = () => ({
      messages: {
        stream: () => ({
          finalMessage: () => new Promise(resolve =>
            setTimeout(() => resolve({
              content: [{ type: "text" as const, text: "garbage" }],
              usage: { input_tokens: 500, output_tokens: 200 },
            }), 3100),
          ),
        }),
      },
    });

    // Should return unchanged spec, not throw
    const result = await applyArchitecturalReasoning(makeSpec(), {
      clientFactory: factory as unknown as () => import("@anthropic-ai/sdk").default,
    });
    expect(result.metrics.rationale_count).toBe(0);
  }, 15000);
});

// ─── Section C: Hard Verifier source field ──────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Hard Verifier — source field (β.4)", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("source=railway when Railway 200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        verified: true, parts_coverage: 1.0, trim_coverage: 1.0,
        mismatches: [], summary: "OK", verified_at: "2026-05-18T00:00:00Z",
      }),
    });
    const { verifyBuild } = await import("../hard-verifier");
    const result = await verifyBuild("https://r2.example/test.ifc", makeSpec(), { sandboxUrl: "https://railway.example" });
    expect(result.source).toBe("railway");
  });

  it("source=heuristic_fallback when Railway 500", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { verifyBuild } = await import("../hard-verifier");
    const result = await verifyBuild("https://r2.example/test.ifc", makeSpec(), { sandboxUrl: "https://railway.example" });
    expect(result.source).toBe("heuristic_fallback");
  });

  it("heuristic defaults verified=false (pessimistic)", async () => {
    const { verifyBuild } = await import("../hard-verifier");
    const result = await verifyBuild("https://r2.example/test.ifc", makeSpec(), { sandboxUrl: "" });
    expect(result.verified).toBe(false);
    expect(result.parts_coverage).toBe(0);
    expect(result.source).toBe("heuristic_fallback");
  });

  it("heuristic mismatches includes 'unverified' entry", async () => {
    const { verifyBuild } = await import("../hard-verifier");
    const result = await verifyBuild("https://r2.example/test.ifc", makeSpec(), { sandboxUrl: "" });
    expect(result.mismatches.some(m => m.type === "unverified")).toBe(true);
  });

  it("heuristic flags composite items with no parts", async () => {
    const { verifyBuild } = await import("../hard-verifier");
    const spec = makeSpec([
      { id: "f1", type: "desk", count: 1, material_id: "m1", description: "Desk" },
      { id: "f2", type: "machine", count: 1, material_id: "m1", description: "Machine" },
    ]);
    const result = await verifyBuild("https://r2.example/test.ifc", spec, { sandboxUrl: "" });
    const partsMM = result.mismatches.filter(m => m.type === "missing_parts");
    expect(partsMM.length).toBeGreaterThanOrEqual(2);
  });

  it("verifierReportSchema accepts source field", () => {
    const report = { verified: true, parts_coverage: 1.0, trim_coverage: 1.0, mismatches: [], summary: "OK", verified_at: "2026-05-18T00:00:00Z", source: "railway" };
    expect(verifierReportSchema.safeParse(report).success).toBe(true);
  });
});

// ─── Section E: Prompt drift + Section 4g ────────────────────────────────

describe("IfcBuildingElementProxy ban — gamma.1 prompt (was Section 4g in β.4)", () => {
  it("system-prompt.md matches driver.ts byte-for-byte (drift check)", () => {
    const mdPath = path.join(__dirname, "..", "generator", "system-prompt.md");
    const md = fs.readFileSync(mdPath, "utf-8").trim();
    expect(GENERATOR_SYSTEM_PROMPT.trim()).toBe(md);
  });

  it("IfcBuildingElementProxy ban is present in prompt (gamma.1 WHAT MAKES A GREAT IFC section)", () => {
    // Phase gamma.1 moved the proxy ban from Section 4g into the
    // "WHAT MAKES A GREAT IFC" section with clearer framing.
    expect(GENERATOR_SYSTEM_PROMPT).toContain("NEVER use IfcBuildingElementProxy");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("IfcFurnishingElement");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("IfcLightFixture");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("IfcFlowTerminal");
  });
});
