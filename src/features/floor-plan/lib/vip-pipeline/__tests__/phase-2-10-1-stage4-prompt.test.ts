/**
 * Phase 2.10.1 — Stage 4 prompt tightening tests.
 *
 * Verifies the new rectangular-room contract clauses are present and
 * the tool schema still enforces rectangle-only output (x/y/w/h scalars
 * with strict:true — no polygon paths sneak through).
 */

import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../stage-4-extract";
import type { ArchitectBrief } from "../types";

function sampleBrief(plotWidthFt = 40, plotDepthFt = 40): ArchitectBrief {
  return {
    projectType: "residential",
    plotWidthFt,
    plotDepthFt,
    facing: "north",
    styleCues: ["residential"],
    constraints: [],
    adjacencies: [],
    roomList: [
      { name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 },
      { name: "Bedroom 2", type: "bedroom", approxAreaSqft: 120 },
      { name: "Living Room", type: "living", approxAreaSqft: 280 },
      { name: "Kitchen", type: "kitchen", approxAreaSqft: 80 },
      { name: "Pooja Room", type: "pooja", approxAreaSqft: 20 },
      { name: "Master Bathroom", type: "master_bathroom", approxAreaSqft: 35 },
    ],
  };
}

describe("Phase 2.10.1 — ROOM SHAPE CONTRACT", () => {
  it("states the contract as MANDATORY with axis-aligned-rectangle requirement", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/ROOM SHAPE CONTRACT/);
    expect(p).toMatch(/MANDATORY/);
    expect(p).toMatch(/AXIS-ALIGNED RECTANGLE/);
    expect(p).toMatch(/\{x, y, w, h\}/);
  });

  it("explicitly forbids L-shapes, T-shapes, U-shapes, curves, and rotation", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/NO L-shapes/);
    expect(p).toMatch(/NO T-shapes/);
    expect(p).toMatch(/NO U-shapes/);
    expect(p).toMatch(/NO curved boundaries/);
    expect(p).toMatch(/NO rotated boxes/);
    expect(p).toMatch(/NO polygon vertices/);
  });

  it("specifies maximal-inscribed-rectangle fallback for L-shaped regions", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/MAXIMAL INSCRIBED[\s\S]+axis-aligned rectangle/);
    expect(p).toMatch(/do not\s+emit two overlapping rectangles/i);
  });

  it("forbids rectangle-on-rectangle overlap", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/Rectangles MUST NOT overlap/);
    expect(p).toMatch(/edges TOUCH but do not cross/);
  });

  it("excludes interior fixtures from being room subdivisions", () => {
    const p = buildSystemPrompt(sampleBrief());
    // Listed both in the contract AND in the DO NOT EXTRACT section
    expect(p).toMatch(/toilets.*basins.*sinks.*stoves/i);
    expect(p).toMatch(/room CONTENTS/i);
    expect(p).toMatch(/Do not split a bathroom\s+around the toilet/);
  });
});

describe("Phase 2.10.1 — extended DO NOT EXTRACT", () => {
  it("adds window stencils as a phantom class", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/Window stencils/);
    expect(p).toMatch(/double parallel-line pattern/);
  });

  it("adds door-frame outlines as a phantom class", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/Door-frame outlines/);
  });

  it("adds interior fixtures as a phantom class", () => {
    const p = buildSystemPrompt(sampleBrief());
    // Check the DO NOT EXTRACT bullet specifically — "Interior fixtures" phrasing
    expect(p).toMatch(/Interior fixtures/);
    expect(p).toMatch(/bathtubs/);
    expect(p).toMatch(/wardrobes/);
  });

  it("preserves all Phase 2.8 phantom-class clauses (no regression)", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/Dimension lines/i);
    expect(p).toMatch(/Wall thickness gaps/i);
    expect(p).toMatch(/Door arc/i);
    expect(p).toMatch(/ENTRY.*PORCH/);
    expect(p).toMatch(/4×4 ft[\s\S]*16 sqft/);
  });
});

describe("Phase 2.10.1 — OUTPUT RULES reinforce rectangle-only", () => {
  it("restates 'axis-aligned' and 'no polygons / no rotated boxes' in the output contract", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/AXIS-ALIGNED bounding RECTANGLE/);
    expect(p).toMatch(/No polygons, no rotated\s+boxes/);
    expect(p).toMatch(/only shape the schema accepts is \{x, y, w, h\}/);
  });

  it("preserves the Phase 2.8 coordinate-bounds contract", () => {
    const p = buildSystemPrompt(sampleBrief(40, 40));
    expect(p).toMatch(/within \[0, 1024\]/);
    expect(p).toMatch(/x \+ w and y \+ h must not exceed 1024/);
  });
});

describe("Phase 2.10.1 — scale injection still correct (no regression on A1)", () => {
  it("scales pxPerFt for a 40×40 plot to 26", () => {
    const p = buildSystemPrompt(sampleBrief(40, 40));
    expect(p).toMatch(/approximately 26 pixels per foot/);
  });

  it("scales pxPerFt for a 30×50 plot to 20 (uses the larger dimension)", () => {
    const p = buildSystemPrompt(sampleBrief(30, 50));
    expect(p).toMatch(/approximately 20 pixels per foot/);
  });
});
