/**
 * Spec Patcher tests (Phase Beta 3).
 */

import { describe, it, expect } from "vitest";
import { decidePatchesAndApply } from "../spec-patcher";
import type { BriefSpec, VerifierReport, VisionReport } from "../types";

function makeSpec(): BriefSpec {
  return {
    project: { name: "Test", type: "office", location: "Test", description: "Test" },
    site: { bounds_m: [10, 8], height_limit_m: 4, coordinate_origin: "sw_corner" },
    spaces: [{ id: "s1", name: "Room", long_name: "Room", polygon_world_m: [[0,0],[10,0],[10,8],[0,8]], height_m: 3, occupancy_type: "office" }],
    elements: [],
    materials: [{ id: "m1", name: "Wood", rgb: [0.6, 0.4, 0.2], roughness: 0.5, method: "MATT", category: "Interior" }],
    brand_language: { primary_text: "Modern", approved_terms: [], forbidden_terms: [] },
    furniture: [
      { id: "f1", type: "desk", count: 1, material_id: "m1", description: "Desk", parts: [
        { id: "p1", subtype: "top", origin_local_m: [0,0,0.7], dims_m: [1.2,0.6,0.03], material_id: "m1", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
      ]},
    ],
  };
}

function makeVerifierReport(overrides?: Partial<VerifierReport>): VerifierReport {
  return {
    verified: true,
    parts_coverage: 1.0,
    trim_coverage: 1.0,
    mismatches: [],
    summary: "All OK",
    source: "railway",
    verified_at: "2026-05-18T00:00:00Z",
    ...overrides,
  };
}

function makeVisionReport(overrides?: Partial<VisionReport>): VisionReport {
  return {
    quality_score: 85,
    pass: true,
    issues: [],
    summary: "Good quality",
    inspected_at: "2026-05-18T00:00:00Z",
    ...overrides,
  };
}

describe("decidePatchesAndApply", () => {
  it("returns needsPatch=false when quality is high and verified", async () => {
    const result = await decidePatchesAndApply(
      makeSpec(),
      makeVerifierReport(),
      makeVisionReport({ quality_score: 90 }),
    );

    expect(result.needsPatch).toBe(false);
    expect(result.patches).toHaveLength(0);
  });

  it("generates force_parts patch for missing_parts mismatch", async () => {
    const verifier = makeVerifierReport({
      verified: false,
      parts_coverage: 0.3,
      mismatches: [
        { type: "missing_parts", item_id: "f1", expected: 5, actual: 1, severity: "high", description: "Only 1 of 5 parts" },
      ],
    });
    const vision = makeVisionReport({ quality_score: 50, pass: false });

    const result = await decidePatchesAndApply(makeSpec(), verifier, vision);

    expect(result.needsPatch).toBe(true);
    expect(result.patches.length).toBeGreaterThan(0);
    expect(result.patches.some(p => p.patch_type === "force_parts")).toBe(true);
  });

  it("generates add_trim patch for missing_trim mismatch", async () => {
    const verifier = makeVerifierReport({
      verified: false,
      parts_coverage: 0.9,
      trim_coverage: 0.0,
      mismatches: [
        { type: "missing_trim", item_id: "t1", expected: 1, actual: 0, severity: "med", description: "Skirting missing" },
      ],
    });
    const vision = makeVisionReport({ quality_score: 60, pass: false });

    const result = await decidePatchesAndApply(makeSpec(), verifier, vision);

    expect(result.needsPatch).toBe(true);
    expect(result.patches.some(p => p.patch_type === "add_trim")).toBe(true);
  });

  it("applies patches to spec when generated", async () => {
    const verifier = makeVerifierReport({
      verified: false,
      parts_coverage: 0.2,
      mismatches: [
        { type: "missing_parts", item_id: "f1", expected: 5, actual: 1, severity: "high", description: "Collapsed" },
      ],
    });
    const vision = makeVisionReport({ quality_score: 40, pass: false });

    const result = await decidePatchesAndApply(makeSpec(), verifier, vision);

    // The patched spec should have must_build set
    const item = result.patchedSpec.furniture?.find(f => f.id === "f1");
    expect(item?.must_build).toBe(true);
    expect(item?.force_parts).toBe(true);
  });

  it("does not generate patches when quality high even with minor mismatches", async () => {
    const verifier = makeVerifierReport({
      verified: true,
      parts_coverage: 0.95,
      mismatches: [
        { type: "size_mismatch_minor", item_id: "f1", expected: 1.2, actual: 1.15, severity: "low", description: "Minor size diff" },
      ],
    });
    const vision = makeVisionReport({ quality_score: 82 });

    const result = await decidePatchesAndApply(makeSpec(), verifier, vision);

    expect(result.needsPatch).toBe(false);
  });

  it("generates patches from vision collapsed issues via deterministic fallback", async () => {
    const verifier = makeVerifierReport({ verified: false, parts_coverage: 0.5 });
    const vision = makeVisionReport({
      quality_score: 45,
      pass: false,
      issues: [
        { severity: "med", type: "collapsed", description: "Desk appears as single box", affected_element: "f1", fixable: true, recommended_patch_type: "force_parts" },
      ],
    });

    const result = await decidePatchesAndApply(makeSpec(), verifier, vision);

    expect(result.needsPatch).toBe(true);
    const forcePatches = result.patches.filter(p => p.patch_type === "force_parts");
    expect(forcePatches.length).toBeGreaterThan(0);
  });

  it("respects max 12 patches cap", async () => {
    const mismatches = Array.from({ length: 20 }, (_, i) => ({
      type: "missing_parts" as const,
      item_id: `item-${i}`,
      expected: 5,
      actual: 0,
      severity: "high" as const,
      description: `Missing parts for item-${i}`,
    }));
    const verifier = makeVerifierReport({ verified: false, parts_coverage: 0.1, mismatches });
    const vision = makeVisionReport({ quality_score: 20, pass: false });

    const spec = makeSpec();
    spec.furniture = mismatches.map((_, i) => ({
      id: `item-${i}`, type: "chair", count: 1, material_id: "m1", description: `Chair ${i}`,
    }));

    const result = await decidePatchesAndApply(spec, verifier, vision);

    expect(result.patches.length).toBeLessThanOrEqual(12);
  });
});
