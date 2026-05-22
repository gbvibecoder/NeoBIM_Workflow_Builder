/**
 * Phase gamma.1 — Retry Hint tests.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  generateRetryHint,
  RETRY_HINT_PROMPT_TEMPLATE,
} from "../retry-hint";
import { QUALITY_THRESHOLD, MAX_ITERATIONS } from "../constants";
import type { VerifierReport, VisionReport } from "../types";

function makeVerifierReport(overrides?: Partial<VerifierReport>): VerifierReport {
  return {
    verified: false,
    parts_coverage: 0.4,
    trim_coverage: 0.5,
    mismatches: [
      {
        type: "missing_parts",
        item_id: "cutting-table-01",
        item_type: "cutting_table",
        expected: 4,
        actual: 1,
        severity: "high",
        description: "Cutting table has 4 parts in spec but only 1 in IFC",
      },
      {
        type: "wrong_class",
        item_id: "mannequin-01",
        expected: "IfcFurnishingElement",
        actual: "IfcBuildingElementProxy",
        severity: "high",
        description: "Mannequin uses IfcBuildingElementProxy instead of IfcFurnishingElement",
      },
    ],
    summary: "Build failed verification",
    verified_at: new Date().toISOString(),
    source: "railway",
    ...overrides,
  } as VerifierReport;
}

function makeVisionReport(overrides?: Partial<VisionReport>): VisionReport {
  return {
    quality_score: 55,
    pass: false,
    issues: [
      {
        severity: "high",
        type: "collapsed",
        description: "Cutting table appears as a single box with no internal structure",
        affected_element: "cutting-table-01",
        fixable: true,
      },
    ],
    summary: "Multiple items collapsed",
    inspected_at: new Date().toISOString(),
    ...overrides,
  } as VisionReport;
}

describe("Retry Hint (Phase gamma.1)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test-fake-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("generateRetryHint returns hint text between 10-600 words (deterministic fallback)", async () => {
    // No real API key → deterministic fallback
    delete process.env.ANTHROPIC_API_KEY;
    const result = await generateRetryHint({
      brief: "Build a tailor workshop with a cutting table, mannequin, and sewing machine.",
      iteration: 1,
      previousIfcUrl: "https://example.com/test.ifc",
      verifierReport: makeVerifierReport(),
      visionReport: makeVisionReport(),
      qualityScore: 55,
    });
    const wordCount = result.hint.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(10);
    expect(wordCount).toBeLessThanOrEqual(600);
    expect(result.shouldIterate).toBe(true);
  });

  it("hint mentions specific items from verifier mismatches", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await generateRetryHint({
      brief: "Build a tailor workshop.",
      iteration: 1,
      previousIfcUrl: "https://example.com/test.ifc",
      verifierReport: makeVerifierReport(),
      visionReport: makeVisionReport(),
      qualityScore: 55,
    });
    expect(result.hint).toContain("cutting-table-01");
    expect(result.hint).toContain("mannequin-01");
  });

  it("hint mentions specific findings from vision report", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await generateRetryHint({
      brief: "Build a tailor workshop.",
      iteration: 1,
      previousIfcUrl: "https://example.com/test.ifc",
      verifierReport: makeVerifierReport(),
      visionReport: makeVisionReport(),
      qualityScore: 55,
    });
    expect(result.hint).toContain("single box");
  });

  it("hint does NOT contain JSON or schema references", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await generateRetryHint({
      brief: "Build a tailor workshop.",
      iteration: 1,
      previousIfcUrl: "https://example.com/test.ifc",
      verifierReport: makeVerifierReport(),
      visionReport: makeVisionReport(),
      qualityScore: 55,
    });
    // Should not contain JSON-like structures
    expect(result.hint).not.toMatch(/\{[^}]*"patch_type"/);
    expect(result.hint).not.toContain("briefSpecSchema");
  });

  it("quality >= 75 → shouldIterate=false", async () => {
    const result = await generateRetryHint({
      brief: "Build an office.",
      iteration: 1,
      previousIfcUrl: "https://example.com/test.ifc",
      verifierReport: makeVerifierReport({ verified: true, parts_coverage: 1.0 }),
      visionReport: makeVisionReport({ quality_score: 80 }),
      qualityScore: 80,
    });
    expect(result.shouldIterate).toBe(false);
    expect(result.hint).toBe("");
  });

  it("quality < 75 AND iteration === MAX_ITERATIONS → shouldIterate=false", async () => {
    const result = await generateRetryHint({
      brief: "Build a workshop.",
      iteration: MAX_ITERATIONS,
      previousIfcUrl: "https://example.com/test.ifc",
      verifierReport: makeVerifierReport(),
      visionReport: makeVisionReport(),
      qualityScore: 50,
    });
    expect(result.shouldIterate).toBe(false);
  });

  it("LLM client factory failure falls back to deterministic hint", async () => {
    const result = await generateRetryHint({
      brief: "Build a workshop.",
      iteration: 1,
      previousIfcUrl: "https://example.com/test.ifc",
      verifierReport: makeVerifierReport(),
      visionReport: makeVisionReport(),
      qualityScore: 55,
      clientFactory: () => { throw new Error("Mock failure"); },
    });
    expect(result.hint.length).toBeGreaterThan(0);
    expect(result.cost_usd).toBe(0);
    expect(result.shouldIterate).toBe(true);
  });

  it("RETRY_HINT_PROMPT_TEMPLATE instructs plain English, not JSON output", () => {
    // The prompt mentions "No JSON" to forbid it — that's correct.
    // It should instruct plain English feedback, not JSON patches.
    expect(RETRY_HINT_PROMPT_TEMPLATE).toContain("No JSON");
    expect(RETRY_HINT_PROMPT_TEMPLATE).toContain("plain");
    expect(RETRY_HINT_PROMPT_TEMPLATE).toContain("colleague's note");
    expect(RETRY_HINT_PROMPT_TEMPLATE).not.toContain("patch_type");
    expect(RETRY_HINT_PROMPT_TEMPLATE).not.toContain("force_parts");
  });
});
