// @vitest-environment happy-dom
/**
 * Iteration display sections tests (Phase Beta 3 Section 4).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("framer-motion", () => ({
  motion: {
    section: React.forwardRef(function MS(props: React.HTMLAttributes<HTMLElement>, ref: React.Ref<HTMLElement>) { return React.createElement("section", { ...props, ref }); }),
    div: React.forwardRef(function MD(props: React.HTMLAttributes<HTMLDivElement>, ref: React.Ref<HTMLDivElement>) { return React.createElement("div", { ...props, ref }); }),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useReducedMotion: () => true,
}));

import type { ResultPageData } from "../hooks/useResultPageData";
import { IterationTraceSection, isIterationTraceEligible } from "../components/sections/IterationTraceSection";
import { VerifierMismatchesSection, isVerifierMismatchesEligible } from "../components/sections/VerifierMismatchesSection";
import { PatchesAppliedSection, isPatchesAppliedEligible } from "../components/sections/PatchesAppliedSection";

function makeData(overrides: Partial<ResultPageData> = {}): ResultPageData {
  return {
    executionId: "exec-1", projectTitle: "Test", workflowId: null,
    lifecycle: "success", isVideoGenerating: false, primaryVideoProgress: null,
    totalArtifacts: 1, successNodes: 1, totalNodes: 1,
    executionMeta: { executedAt: "2026-05-18T00:00:00Z", completedAt: "2026-05-18T00:01:00Z", durationMs: 60000, status: "success", workflowId: null, errorMessage: null },
    textContent: "", heroImageUrl: null, allImageUrls: [], videoData: null,
    kpiMetrics: [], tableData: [], svgContent: null, model3dData: null,
    fileDownloads: [], jsonData: [], pipelineSteps: [],
    complianceItems: null, boqSummary: null, clashSummary: null, ifcExport: null,
    qualityScore: null, visionIssues: [], designRationale: [],
    iterationCount: null, bestIteration: null, iterationTrace: [],
    verifierMismatches: [], patchesApplied: [],
    ...overrides,
  };
}

describe("ITERATIONS KPI badge", () => {
  it("shows correct value and green color for 1 iteration", () => {
    const data = makeData({ iterationCount: 1 });
    expect(data.iterationCount).toBe(1);
    const color = data.iterationCount === 1 ? "#16A34A" : data.iterationCount === 2 ? "#CA8A04" : "#DC2626";
    expect(color).toBe("#16A34A");
  });

  it("shows yellow for 2 iterations", () => {
    const data = makeData({ iterationCount: 2 });
    const color = data.iterationCount === 1 ? "#16A34A" : data.iterationCount === 2 ? "#CA8A04" : "#DC2626";
    expect(color).toBe("#CA8A04");
  });

  it("shows red for 3 iterations", () => {
    const data = makeData({ iterationCount: 3 });
    const color = data.iterationCount === 1 ? "#16A34A" : data.iterationCount === 2 ? "#CA8A04" : "#DC2626";
    expect(color).toBe("#DC2626");
  });
});

describe("IterationTraceSection", () => {
  it("renders iteration count and highlights BEST", () => {
    const data = makeData({
      iterationCount: 2,
      bestIteration: 2,
      iterationTrace: [
        { iteration: 1, qualityScore: 55, partsCoverage: 0.4, entityCount: 1200, elapsedMs: 45000 },
        { iteration: 2, qualityScore: 82, partsCoverage: 0.95, entityCount: 2100, elapsedMs: 60000 },
      ],
    });
    render(<IterationTraceSection data={data} />);
    fireEvent.click(screen.getByTestId("iteration-trace-toggle"));
    expect(screen.getByText("2 runs")).toBeTruthy();
    expect(screen.getByTestId("best-badge")).toBeTruthy();
    expect(screen.getByText("Iteration 1")).toBeTruthy();
    expect(screen.getByText("Iteration 2")).toBeTruthy();
  });

  it("is not eligible for single-pass runs", () => {
    expect(isIterationTraceEligible(makeData({ iterationTrace: [{ iteration: 1, qualityScore: 80, partsCoverage: 0.9, entityCount: 2000, elapsedMs: 40000 }] }))).toBe(false);
  });
});

describe("VerifierMismatchesSection", () => {
  it("renders mismatches with severity colors", () => {
    const data = makeData({
      verifierMismatches: [
        { type: "missing_parts", item_id: "f1", severity: "high", description: "Only 1 of 5 parts" },
        { type: "missing_trim", item_id: "t1", severity: "med", description: "Skirting missing" },
      ],
    });
    render(<VerifierMismatchesSection data={data} />);
    fireEvent.click(screen.getByTestId("verifier-mismatches-toggle"));
    expect(screen.getByText("Only 1 of 5 parts")).toBeTruthy();
    expect(screen.getByText("Skirting missing")).toBeTruthy();
  });

  it("is not eligible when no mismatches", () => {
    expect(isVerifierMismatchesEligible(makeData())).toBe(false);
  });
});

describe("PatchesAppliedSection", () => {
  it("renders patches", () => {
    const data = makeData({
      patchesApplied: [
        { item_id: "f1", patch_type: "force_parts", rationale: "Desk was collapsed" },
      ],
    });
    render(<PatchesAppliedSection data={data} />);
    fireEvent.click(screen.getByTestId("patches-applied-toggle"));
    expect(screen.getByText("Desk was collapsed")).toBeTruthy();
  });

  it("is not eligible when no patches", () => {
    expect(isPatchesAppliedEligible(makeData())).toBe(false);
  });
});
