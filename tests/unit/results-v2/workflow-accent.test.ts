/**
 * Phase E — workflow-accent tests.
 *
 * Asserts every terminal artifact kind maps to a defined accent and every
 * accent endpoint has HSL saturation ≥ 40% (the "lived-in palette" rule
 * from the Phase B doctrine). We compute saturation at runtime rather than
 * trusting the comment in `constants.ts`.
 */

import { describe, it, expect } from "vitest";
import { accentLinearGradient, accentRadial, pickAccent } from "@/features/results-v2/lib/workflow-accent";
import { ACCENT_MAP, FLOOR_PLAN_ACCENT } from "@/features/results-v2/constants";
import type { ExecutionResult } from "@/features/results-v2/types";

function base(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    executionId: "t",
    workflowId: "wf",
    workflowName: "T",
    status: { state: "success", startedAt: null, completedAt: null, durationMs: null },
    video: null,
    images: [],
    model3d: null,
    floorPlan: null,
    tables: [],
    metrics: [],
    boqTotalGfa: null,
    boqCurrencySymbol: null,
    downloads: [],
    pipeline: [],
    models: [],
    summaryText: null,
    ...overrides,
  };
}

function hexToHslSaturation(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

describe("pickAccent — accent dispatch per terminal artifact", () => {
  it("picks the video accent when a video is present", () => {
    const acc = pickAccent(
      base({
        video: {
          nodeId: "v",
          videoUrl: "u",
          downloadUrl: "u",
          name: "v.mp4",
          durationSeconds: 1,
          shotCount: 1,
          status: "complete",
        },
      }),
    );
    expect(acc).toEqual(ACCENT_MAP.video);
  });

  it("picks the ifc accent when a 3D model is present", () => {
    const acc = pickAccent(base({ model3d: { kind: "procedural", floors: 5 } }));
    expect(acc).toEqual(ACCENT_MAP.ifc);
  });

  it("picks the ifc accent when a floor plan is present (workflow-side override)", () => {
    // Note: the HeroFloorPlan component applies FLOOR_PLAN_ACCENT internally
    // for the warm-sunset override. At the `pickAccent` level (used by
    // the rest of the page), the workflow's own accent still flows.
    const acc = pickAccent(base({ floorPlan: { kind: "svg", svg: "", label: "" } }));
    expect(acc).toEqual(ACCENT_MAP.ifc);
  });

  it("picks the boq accent when boqTotalGfa is set", () => {
    expect(pickAccent(base({ boqTotalGfa: 5120 }))).toEqual(ACCENT_MAP.boq);
  });

  it("picks the image accent when only images are present", () => {
    expect(pickAccent(base({ images: ["https://example.test/a.png"] }))).toEqual(ACCENT_MAP.image);
  });

  it("falls back to default when nothing is present", () => {
    expect(pickAccent(base())).toEqual(ACCENT_MAP.default);
  });
});

describe("ACCENT_MAP saturation audit — every endpoint ≥ 40%", () => {
  const accents = [
    ["video.start", ACCENT_MAP.video.start],
    ["video.end", ACCENT_MAP.video.end],
    ["image.start", ACCENT_MAP.image.start],
    ["image.end", ACCENT_MAP.image.end],
    ["ifc.start", ACCENT_MAP.ifc.start],
    ["ifc.end", ACCENT_MAP.ifc.end],
    ["boq.start", ACCENT_MAP.boq.start],
    ["boq.end", ACCENT_MAP.boq.end],
    ["default.start", ACCENT_MAP.default.start],
    ["default.end", ACCENT_MAP.default.end],
    ["floorPlan.start", FLOOR_PLAN_ACCENT.start],
    ["floorPlan.end", FLOOR_PLAN_ACCENT.end],
  ] as const;

  it.each(accents)("%s (%s) has HSL saturation ≥ 40%%", (_, hex) => {
    const s = hexToHslSaturation(hex);
    expect(s).toBeGreaterThanOrEqual(0.4);
  });
});

describe("accent gradient helpers", () => {
  it("accentLinearGradient returns a CSS `linear-gradient(...)` string with both endpoints", () => {
    const css = accentLinearGradient(ACCENT_MAP.video, 0.3);
    expect(css).toContain("linear-gradient");
    // Both colors should be referenced in the output (post-rgba conversion)
    const startRgb = hexToRgbStr(ACCENT_MAP.video.start);
    const endRgb = hexToRgbStr(ACCENT_MAP.video.end);
    expect(css).toContain(startRgb);
    expect(css).toContain(endRgb);
  });

  it("accentRadial emits two radial gradients joined by comma", () => {
    const css = accentRadial(ACCENT_MAP.boq);
    const matches = css.match(/radial-gradient/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

function hexToRgbStr(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b}`;
}
