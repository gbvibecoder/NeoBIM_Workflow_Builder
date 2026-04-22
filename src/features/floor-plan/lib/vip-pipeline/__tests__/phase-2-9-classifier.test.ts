/**
 * Phase 2.9 — scenario classifier tests.
 *
 * The classifier is the safety gate for dimension enhancement. Lock
 * in every positive/negative path so the pipeline never accidentally
 * mutates geometry outside the bands we've cleared.
 */

import { describe, it, expect } from "vitest";
import {
  classifyScenario,
  type ClassifyInput,
} from "../stage-5-classifier";
import type { ArchitectBrief, ExtractedRoom, ExtractedRooms, RectPx } from "../types";

// ─── Helpers ────────────────────────────────────────────────────

const IMAGE_SIZE = 1024;

function brief(plotW = 40, plotD = 40, rooms: Array<{ name: string; type: string; approxAreaSqft?: number }> = defaultRoomList()): ArchitectBrief {
  return {
    projectType: "residential",
    plotWidthFt: plotW,
    plotDepthFt: plotD,
    facing: "north",
    styleCues: ["residential"],
    constraints: [],
    adjacencies: [],
    roomList: rooms,
  };
}

function defaultRoomList() {
  return [
    { name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 },
    { name: "Bedroom 2", type: "bedroom", approxAreaSqft: 120 },
    { name: "Bedroom 3", type: "bedroom", approxAreaSqft: 120 },
    { name: "Living Room", type: "living", approxAreaSqft: 280 },
    { name: "Kitchen", type: "kitchen", approxAreaSqft: 80 },
    { name: "Pooja Room", type: "pooja", approxAreaSqft: 20 },
    { name: "Master Bathroom", type: "master_bathroom", approxAreaSqft: 35 },
    { name: "Common Bathroom", type: "bathroom", approxAreaSqft: 35 },
  ];
}

function mkRoomByArea(name: string, areaSqft: number, plotW = 40): ExtractedRoom {
  const sidePx = Math.round(Math.sqrt(areaSqft) * (IMAGE_SIZE / plotW));
  return {
    name,
    rectPx: { x: 0, y: 0, w: sidePx, h: sidePx },
    confidence: 0.9,
    labelAsShown: name,
  };
}

function extraction(
  rooms: ExtractedRoom[],
  plotBoundsPx: RectPx | null = { x: 0, y: 0, w: IMAGE_SIZE, h: IMAGE_SIZE },
): ExtractedRooms {
  return {
    imageSize: { width: IMAGE_SIZE, height: IMAGE_SIZE },
    plotBoundsPx,
    rooms,
    issues: [],
    expectedRoomsMissing: [],
    unexpectedRoomsFound: [],
  };
}

function input(
  overrides: Partial<ClassifyInput> & { extraction?: ExtractedRooms } = {},
): ClassifyInput {
  // Honour EXPLICIT undefined for `brief` / `userPrompt` — passing
  // `brief: undefined` in test overrides is the way to opt out of the
  // default, which matters for the "brief not supplied" fallback case.
  return {
    extraction:
      overrides.extraction ??
      extraction([
        mkRoomByArea("Master Bedroom", 168),
        mkRoomByArea("Bedroom 2", 120),
        mkRoomByArea("Bedroom 3", 120),
        mkRoomByArea("Living Room", 280),
        mkRoomByArea("Kitchen", 80),
      ]),
    brief: "brief" in overrides ? overrides.brief : brief(),
    userPrompt:
      "userPrompt" in overrides
        ? overrides.userPrompt
        : "3BHK 40x40 north facing vastu pooja room",
    plotWidthFt: overrides.plotWidthFt ?? 40,
    plotDepthFt: overrides.plotDepthFt ?? 40,
  };
}

// ─── Plot size categorisation ──────────────────────────────────

describe("Phase 2.9 classifier — plot size categorisation", () => {
  it("returns 'tiny' for plots < 500 sqft", () => {
    const r = classifyScenario(input({ plotWidthFt: 20, plotDepthFt: 20 }));
    expect(r.plotSizeCategory).toBe("tiny");
  });

  it("returns 'small' for 500-899 sqft", () => {
    const r = classifyScenario(input({ plotWidthFt: 25, plotDepthFt: 30 })); // 750
    expect(r.plotSizeCategory).toBe("small");
  });

  it("returns 'standard' for 900-3999 sqft (3BHK 40×40 = 1600)", () => {
    const r = classifyScenario(input({ plotWidthFt: 40, plotDepthFt: 40 }));
    expect(r.plotSizeCategory).toBe("standard");
  });

  it("returns 'large' for 4000-6999 sqft (60×80 = 4800)", () => {
    const r = classifyScenario(input({ plotWidthFt: 60, plotDepthFt: 80 }));
    expect(r.plotSizeCategory).toBe("large");
  });

  it("returns 'luxury' for >= 7000 sqft (100×80 = 8000)", () => {
    const r = classifyScenario(input({ plotWidthFt: 100, plotDepthFt: 80 }));
    expect(r.plotSizeCategory).toBe("luxury");
  });
});

// ─── Residential vs commercial ─────────────────────────────────

describe("Phase 2.9 classifier — residential vs commercial", () => {
  it("residential prompt → isResidential=true", () => {
    const r = classifyScenario(input({ userPrompt: "3BHK 40x40 north facing vastu pooja room" }));
    expect(r.isResidential).toBe(true);
  });

  it('commercial markers flip isResidential=false ("office")', () => {
    const r = classifyScenario(input({ userPrompt: "50x50 small office with 4 workstations" }));
    expect(r.isResidential).toBe(false);
    expect(r.reasonsForFallback).toContain(
      "prompt suggests commercial / non-residential program",
    );
  });

  it('commercial markers flip isResidential=false ("commercial")', () => {
    const r = classifyScenario(input({ userPrompt: "commercial building 40x80" }));
    expect(r.isResidential).toBe(false);
  });

  it('"cafe" / "clinic" / "showroom" / "retail" are all commercial', () => {
    for (const kw of ["small cafe", "dental clinic", "furniture showroom", "retail store 30x40"]) {
      expect(classifyScenario(input({ userPrompt: kw })).isResidential).toBe(false);
    }
  });

  it("missing prompt defaults to residential (safer)", () => {
    const r = classifyScenario(input({ userPrompt: undefined }));
    expect(r.isResidential).toBe(true);
  });
});

// ─── Grid-square bias detection ────────────────────────────────

describe("Phase 2.9 classifier — grid-square bias detection", () => {
  it("detects bias when 3+ MIXED-TYPE rooms share an area within ±5%", () => {
    // Matches the prod failure: 4 rooms at 104 sqft covering bedroom +
    // master_bedroom + kitchen (mixed types).
    const ex = extraction([
      mkRoomByArea("Master Bedroom", 104),
      mkRoomByArea("Bedroom 2", 104),
      mkRoomByArea("Bedroom 3", 104),
      mkRoomByArea("Kitchen", 104),
      mkRoomByArea("Living Room", 300),
      mkRoomByArea("Master Bathroom", 52),
    ]);
    const r = classifyScenario(input({ extraction: ex }));
    expect(r.hasGridSquareBias).toBe(true);
  });

  it("does NOT trigger when 3 rooms at same area are all the SAME type (expected)", () => {
    // 3 standard bedrooms legitimately at 120 sqft each — same type
    // cluster is fine. Check this by varying all OTHER rooms.
    const ex = extraction([
      mkRoomByArea("Bedroom 1", 120),
      mkRoomByArea("Bedroom 2", 120),
      mkRoomByArea("Bedroom 3", 120),
      mkRoomByArea("Kitchen", 80),
      mkRoomByArea("Living Room", 280),
      mkRoomByArea("Master Bathroom", 35),
    ]);
    const b = brief(40, 40, [
      { name: "Bedroom 1", type: "bedroom" },
      { name: "Bedroom 2", type: "bedroom" },
      { name: "Bedroom 3", type: "bedroom" },
      { name: "Kitchen", type: "kitchen" },
      { name: "Living Room", type: "living" },
      { name: "Master Bathroom", type: "master_bathroom" },
    ]);
    const r = classifyScenario(input({ extraction: ex, brief: b }));
    expect(r.hasGridSquareBias).toBe(false);
  });

  it("does NOT trigger when all rooms have healthily varied sizes", () => {
    const ex = extraction([
      mkRoomByArea("Master Bedroom", 168),
      mkRoomByArea("Bedroom 2", 120),
      mkRoomByArea("Bedroom 3", 110),
      mkRoomByArea("Living Room", 280),
      mkRoomByArea("Kitchen", 80),
      mkRoomByArea("Pooja Room", 20),
    ]);
    const r = classifyScenario(input({ extraction: ex }));
    expect(r.hasGridSquareBias).toBe(false);
  });
});

// ─── Final enhanceDimensions decision ──────────────────────────

describe("Phase 2.9 classifier — enhanceDimensions=true path", () => {
  it("rectangular + standard plot + residential + grid-bias + 4-15 rooms + brief present → true", () => {
    const ex = extraction([
      mkRoomByArea("Master Bedroom", 104),
      mkRoomByArea("Bedroom 2", 104),
      mkRoomByArea("Bedroom 3", 104),
      mkRoomByArea("Kitchen", 104),
      mkRoomByArea("Living Room", 300),
      mkRoomByArea("Master Bathroom", 52),
      mkRoomByArea("Common Bathroom", 52),
      mkRoomByArea("Pooja Room", 26),
    ]);
    const r = classifyScenario(input({ extraction: ex }));
    expect(r.enhanceDimensions).toBe(true);
    expect(r.reasonsForFallback).toEqual([]);
  });
});

describe("Phase 2.9 classifier — enhanceDimensions=false paths", () => {
  it("L-shape / non-rectangular plotBounds → fallback", () => {
    const ex = extraction(
      [
        mkRoomByArea("Master Bedroom", 104),
        mkRoomByArea("Bedroom 2", 104),
        mkRoomByArea("Bedroom 3", 104),
        mkRoomByArea("Kitchen", 104),
      ],
      { x: 0, y: 0, w: 100, h: 500 }, // 1:5 aspect — too skinny to trust as rectangle
    );
    const r = classifyScenario(input({ extraction: ex }));
    expect(r.enhanceDimensions).toBe(false);
    expect(r.reasonsForFallback.some((m) => /rectangular/.test(m))).toBe(true);
  });

  it("tiny plot (20×20 = 400) → fallback even with grid bias", () => {
    const ex = extraction([
      mkRoomByArea("Bedroom 1", 104, 20),
      mkRoomByArea("Kitchen", 104, 20),
      mkRoomByArea("Living Room", 104, 20),
      mkRoomByArea("Bathroom", 104, 20),
    ]);
    const r = classifyScenario(input({ extraction: ex, plotWidthFt: 20, plotDepthFt: 20 }));
    expect(r.enhanceDimensions).toBe(false);
    expect(r.reasonsForFallback.some((m) => /tiny/.test(m))).toBe(true);
  });

  it("luxury plot (100×100 = 10000) → fallback (enhancement heuristics not tuned for luxury)", () => {
    const ex = extraction([
      mkRoomByArea("Master Bedroom", 200, 100),
      mkRoomByArea("Bedroom 2", 200, 100),
      mkRoomByArea("Kitchen", 200, 100),
      mkRoomByArea("Living Room", 200, 100),
      mkRoomByArea("Master Bathroom", 200, 100),
    ]);
    const r = classifyScenario(input({ extraction: ex, plotWidthFt: 100, plotDepthFt: 100 }));
    expect(r.enhanceDimensions).toBe(false);
    expect(r.reasonsForFallback.some((m) => /luxury/.test(m))).toBe(true);
  });

  it("commercial prompt → fallback", () => {
    const ex = extraction([
      mkRoomByArea("Office 1", 104),
      mkRoomByArea("Office 2", 104),
      mkRoomByArea("Meeting Room", 104),
      mkRoomByArea("Reception", 104),
    ]);
    const r = classifyScenario(
      input({ extraction: ex, userPrompt: "small office 40x40 with 3 workstations" }),
    );
    expect(r.enhanceDimensions).toBe(false);
    expect(r.reasonsForFallback.some((m) => /commercial/.test(m))).toBe(true);
  });

  it("no grid bias → fallback (Stage 4 already varied, nothing to correct)", () => {
    const ex = extraction([
      mkRoomByArea("Master Bedroom", 168),
      mkRoomByArea("Bedroom 2", 120),
      mkRoomByArea("Bedroom 3", 110),
      mkRoomByArea("Living Room", 280),
      mkRoomByArea("Kitchen", 80),
    ]);
    const r = classifyScenario(input({ extraction: ex }));
    expect(r.enhanceDimensions).toBe(false);
    expect(r.reasonsForFallback.some((m) => /grid-square bias/.test(m))).toBe(true);
  });

  it("20-room mega-mansion → fallback (room count outlier)", () => {
    const rooms: ExtractedRoom[] = Array.from({ length: 20 }, (_, i) =>
      mkRoomByArea(`Room ${i + 1}`, 120),
    );
    const r = classifyScenario(input({ extraction: extraction(rooms), plotWidthFt: 60, plotDepthFt: 60 }));
    expect(r.enhanceDimensions).toBe(false);
    expect(r.reasonsForFallback.some((m) => /room count 20 > 15/.test(m))).toBe(true);
  });

  it("1-room tiny extraction → fallback (room count too low)", () => {
    const ex = extraction([mkRoomByArea("Room", 100)]);
    const r = classifyScenario(input({ extraction: ex }));
    expect(r.enhanceDimensions).toBe(false);
    expect(r.reasonsForFallback.some((m) => /room count 1 < 4/.test(m))).toBe(true);
  });

  it("brief not supplied → fallback (no target areas)", () => {
    const ex = extraction([
      mkRoomByArea("Master Bedroom", 104),
      mkRoomByArea("Bedroom 2", 104),
      mkRoomByArea("Bedroom 3", 104),
      mkRoomByArea("Kitchen", 104),
    ]);
    const r = classifyScenario(input({ extraction: ex, brief: undefined }));
    expect(r.enhanceDimensions).toBe(false);
    expect(r.reasonsForFallback.some((m) => /brief not supplied/.test(m))).toBe(true);
  });

  it("plotBoundsPx null → non-rectangular fallback", () => {
    const ex = extraction(
      [
        mkRoomByArea("Master Bedroom", 104),
        mkRoomByArea("Bedroom 2", 104),
        mkRoomByArea("Bedroom 3", 104),
        mkRoomByArea("Kitchen", 104),
      ],
      null,
    );
    const r = classifyScenario(input({ extraction: ex }));
    expect(r.enhanceDimensions).toBe(false);
    expect(r.isRectangular).toBe(false);
  });
});
