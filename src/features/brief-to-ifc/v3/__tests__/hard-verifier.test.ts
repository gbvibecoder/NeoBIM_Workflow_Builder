/**
 * Hard Verifier tests (Phase Beta 3).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifierReportSchema } from "../types";
import type { BriefSpec, VerifierReport } from "../types";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeSpec(overrides?: Partial<BriefSpec>): BriefSpec {
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
        { id: "p2", subtype: "leg1", origin_local_m: [0,0,0], dims_m: [0.05,0.05,0.7], material_id: "m1", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
      ]},
    ],
    ...overrides,
  };
}

function makeVerifiedReport(): VerifierReport {
  return {
    verified: true,
    parts_coverage: 1.0,
    trim_coverage: 1.0,
    mismatches: [],
    summary: "All parts present",
    verified_at: new Date().toISOString(),
    source: "railway",
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("Hard Verifier — verifyBuild", () => {
  it("returns verified report from Python endpoint", async () => {
    const report = makeVerifiedReport();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(report),
    });

    const { verifyBuild } = await import("../hard-verifier");
    const result = await verifyBuild("https://r2.example/test.ifc", makeSpec(), {
      sandboxUrl: "https://railway.example",
    });

    expect(result.verified).toBe(true);
    expect(result.parts_coverage).toBe(1.0);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("falls back to heuristic when Python endpoint returns 500", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { verifyBuild } = await import("../hard-verifier");
    const result = await verifyBuild("https://r2.example/test.ifc", makeSpec(), {
      sandboxUrl: "https://railway.example",
    });

    expect(result.verified).toBe(false);
    expect(result.summary).toContain("Heuristic");
  });

  it("falls back to heuristic when Python endpoint unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { verifyBuild } = await import("../hard-verifier");
    const result = await verifyBuild("https://r2.example/test.ifc", makeSpec(), {
      sandboxUrl: "https://railway.example",
    });

    expect(result.verified).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
  });

  it("falls back when no sandboxUrl provided", async () => {
    const { verifyBuild } = await import("../hard-verifier");
    const result = await verifyBuild("https://r2.example/test.ifc", makeSpec(), {
      sandboxUrl: "",
    });

    expect(result.verified).toBe(false);
    expect(result.summary).toContain("Heuristic");
  });

  it("heuristic report counts expected parts correctly", async () => {
    const { verifyBuild } = await import("../hard-verifier");
    const spec = makeSpec({
      furniture: [
        { id: "f1", type: "desk", count: 1, material_id: "m1", description: "Desk", parts: [
          { id: "p1", subtype: "top", origin_local_m: [0,0,0.7], dims_m: [1.2,0.6,0.03], material_id: "m1", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          { id: "p2", subtype: "leg", origin_local_m: [0,0,0], dims_m: [0.05,0.05,0.7], material_id: "m1", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
          { id: "p3", subtype: "leg2", origin_local_m: [1,0,0], dims_m: [0.05,0.05,0.7], material_id: "m1", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
        ]},
      ],
    });

    const result = await verifyBuild("https://r2.example/test.ifc", spec, { sandboxUrl: "" });
    // First mismatch is now "unverified" (global). Parts mismatch is after it.
    const partsMM = result.mismatches.find(m => m.type === "missing_parts");
    expect(partsMM?.expected).toBe(3);
  });

  it("verifierReportSchema validates correctly", () => {
    const report = makeVerifiedReport();
    const parsed = verifierReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
  });

  it("verifierReportSchema validates report with mismatches", () => {
    const report = {
      verified: false,
      parts_coverage: 0.4,
      trim_coverage: 0.0,
      mismatches: [
        { type: "missing_parts", item_id: "f1", expected: 5, actual: 2, severity: "high", description: "Only 2 of 5 parts built" },
        { type: "missing_trim", item_id: "t1", expected: 1, actual: 0, severity: "med", description: "Skirting not found" },
      ],
      summary: "Parts collapsed",
      verified_at: "2026-05-18T00:00:00Z",
    };
    const parsed = verifierReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.mismatches).toHaveLength(2);
  });

  it("empty spec (no furniture) produces only global unverified mismatch", async () => {
    const { verifyBuild } = await import("../hard-verifier");
    const spec = makeSpec({ furniture: [] });
    const result = await verifyBuild("https://r2.example/test.ifc", spec, { sandboxUrl: "" });

    // Only the global "unverified" entry — no furniture-specific mismatches
    const partsMM = result.mismatches.filter(m => m.type === "missing_parts");
    expect(partsMM).toHaveLength(0);
    expect(result.mismatches.some(m => m.type === "unverified")).toBe(true);
  });
});
