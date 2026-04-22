/**
 * Phase 2.8 — Stage 4 extraction accuracy tests.
 *
 * Covers four sub-systems:
 *   B1: discriminator-weighted name matcher (stage-4-matcher).
 *   A1/A2/A4: system-prompt content assertions (stage-4-extract buildSystemPrompt).
 *   B2: phantom-room filter after px→ft transform.
 *   B3: plausibility flag against brief.approxAreaSqft.
 *
 * The headline case is the 2026-04-22 prod failure: label "Master Bath"
 * being silently rewritten to "Master Bedroom" (producing a "Master
 * Bedroom 2" duplicate + a "Master Bathroom missing" issue). B1 fixes
 * that by hard-zeroing disjoint discriminators; this test suite locks
 * in the contract so a regression can't slip back in.
 */

import { describe, it, expect } from "vitest";
import {
  weightedMatchScore,
  pickBestMatch,
  tokenize,
  classify,
} from "../stage-4-matcher";
import { buildSystemPrompt } from "../stage-4-extract";
import {
  dropPhantomRooms,
  flagPlausibility,
  recomputeMissing,
  applyStage4PostValidation,
} from "../stage-4-validators";
import type { ArchitectBrief, ExtractedRoom, ExtractedRooms, RectPx } from "../types";

// ─── B1 — discriminator-weighted matcher ───────────────────────

describe("Phase 2.8 B1 — tokenize and classify", () => {
  it("strips stopwords ('room', digits) and lower-cases", () => {
    expect(tokenize("Master Bedroom 2")).toEqual(["master", "bedroom"]);
    expect(tokenize("Pooja Room")).toEqual(["pooja"]);
    expect(tokenize("LIVING / DINING")).toEqual(["living", "dining"]);
  });

  it("classify tags discriminators vs modifiers vs other", () => {
    expect(classify("bath")).toBe("discriminator");
    expect(classify("bedroom")).toBe("discriminator");
    expect(classify("pooja")).toBe("discriminator");
    expect(classify("master")).toBe("modifier");
    expect(classify("common")).toBe("modifier");
    expect(classify("random")).toBe("other");
  });
});

describe("Phase 2.8 B1 — hard-zero on disjoint discriminators (the prod bug)", () => {
  it('"Master Bath" → "Master Bedroom" scores ZERO (not 0.5 like legacy)', () => {
    expect(weightedMatchScore("Master Bath", "Master Bedroom")).toBe(0);
  });

  it('"Master Bed" → "Master Bathroom" scores ZERO', () => {
    expect(weightedMatchScore("Master Bed", "Master Bathroom")).toBe(0);
  });

  it('"Kitchen" → "Master Bedroom" scores ZERO', () => {
    expect(weightedMatchScore("Kitchen", "Master Bedroom")).toBe(0);
  });

  it('"Pooja Room" → "Bedroom 2" scores ZERO', () => {
    expect(weightedMatchScore("Pooja Room", "Bedroom 2")).toBe(0);
  });
});

describe("Phase 2.8 B1 — synonym family matching", () => {
  it('"Master Bath" → "Master Bathroom" is a strong match', () => {
    const s = weightedMatchScore("Master Bath", "Master Bathroom");
    expect(s).toBeGreaterThan(0.85);
  });

  it('"Puja" → "Pooja Room" matches via synonym', () => {
    const s = weightedMatchScore("Puja", "Pooja Room");
    expect(s).toBeGreaterThan(0.8);
  });

  it('"Prayer" → "Pooja Room" matches via synonym', () => {
    const s = weightedMatchScore("Prayer", "Pooja Room");
    expect(s).toBeGreaterThan(0.8);
  });

  it('"Toilet" → "Common Bathroom" matches via synonym (toilet ≈ bath)', () => {
    const s = weightedMatchScore("Toilet", "Common Bathroom");
    expect(s).toBeGreaterThan(0.5);
  });
});

describe("Phase 2.8 B1 — tie-break by discriminator, not list order", () => {
  it('"Master Bath" picks "Master Bathroom" over "Master Bedroom" regardless of order', () => {
    const orderA = ["Master Bedroom", "Master Bathroom", "Common Bathroom"];
    const orderB = ["Master Bathroom", "Master Bedroom", "Common Bathroom"];
    const pickA = pickBestMatch("Master Bath", "Master Bath", orderA);
    const pickB = pickBestMatch("Master Bath", "Master Bath", orderB);
    expect(pickA.name).toBe("Master Bathroom");
    expect(pickB.name).toBe("Master Bathroom");
  });

  it('"Master Bath" picks "Master Bathroom" over "Common Bathroom" (modifier match wins)', () => {
    const pick = pickBestMatch(
      "Master Bath",
      "Master Bath",
      ["Common Bathroom", "Master Bathroom"],
    );
    expect(pick.name).toBe("Master Bathroom");
  });
});

describe("Phase 2.8 B1 — trust GPT-4o matchedName when exact", () => {
  it("returns canonical expected name when GPT-4o's matchedName is an exact hit", () => {
    const pick = pickBestMatch(
      "MBR",
      "Master Bedroom",
      ["Master Bedroom", "Bedroom 2"],
    );
    expect(pick.name).toBe("Master Bedroom");
    expect(pick.source).toBe("gpt-exact");
    expect(pick.score).toBe(1);
  });

  it("preserves the expected list's canonical casing on exact match", () => {
    const pick = pickBestMatch(
      "anything",
      "master bedroom", // lowercase from GPT-4o
      ["Master Bedroom", "Kitchen"],
    );
    expect(pick.name).toBe("Master Bedroom");
    expect(pick.source).toBe("gpt-exact");
  });

  it("falls back to weighted match when GPT-4o's name is novel", () => {
    const pick = pickBestMatch(
      "Master Bath",
      "Master Bathhhhroom", // typo / novel
      ["Master Bedroom", "Master Bathroom"],
    );
    expect(pick.name).toBe("Master Bathroom");
    expect(pick.source).toBe("weighted");
  });

  it("falls back to labelAsShown when nothing matches", () => {
    const pick = pickBestMatch(
      "Mystery Room",
      "Mystery Space",
      ["Master Bedroom", "Kitchen"],
    );
    expect(pick.name).toBe("Mystery Room");
    expect(pick.source).toBe("fallback");
    expect(pick.score).toBe(0);
  });
});

describe("Phase 2.8 B1 — regression guard for the prod 2026-04-22 failure", () => {
  it('"Master Bath" NEVER collapses to "Master Bedroom", no matter which tie-break wins', () => {
    // Simulate a brief that lists rooms in various orders. In all orderings
    // the extractor must route "Master Bath" to the bathroom.
    const briefs = [
      ["Master Bedroom", "Bedroom 2", "Bedroom 3", "Living Room", "Kitchen", "Pooja Room", "Master Bathroom", "Common Bathroom"],
      ["Master Bathroom", "Common Bathroom", "Master Bedroom", "Bedroom 2", "Bedroom 3", "Living Room", "Kitchen", "Pooja Room"],
      ["Kitchen", "Pooja Room", "Master Bedroom", "Master Bathroom", "Common Bathroom"],
    ];
    for (const brief of briefs) {
      const pick = pickBestMatch("Master Bath", "Master Bath", brief);
      expect(pick.name, `ordering ${JSON.stringify(brief)}`).not.toBe("Master Bedroom");
      expect(pick.name, `ordering ${JSON.stringify(brief)}`).toBe("Master Bathroom");
    }
  });
});

// ─── A1 / A2 / A4 — prompt content ──────────────────────────────

function sampleBrief(plotW = 40, plotD = 40): ArchitectBrief {
  return {
    projectType: "residential",
    plotWidthFt: plotW,
    plotDepthFt: plotD,
    facing: "north",
    styleCues: ["residential"],
    constraints: [],
    adjacencies: [],
    roomList: [
      { name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 },
      { name: "Bedroom 2", type: "bedroom", approxAreaSqft: 120 },
      { name: "Bedroom 3", type: "bedroom", approxAreaSqft: 110 },
      { name: "Living Room", type: "living", approxAreaSqft: 280 },
      { name: "Kitchen", type: "kitchen", approxAreaSqft: 80 },
      { name: "Pooja Room", type: "pooja", approxAreaSqft: 20 },
      { name: "Master Bathroom", type: "master_bathroom", approxAreaSqft: 35 },
      { name: "Common Bathroom", type: "bathroom", approxAreaSqft: 35 },
    ],
  };
}

describe("Phase 2.8 A1 — prompt injects pixel↔feet scale", () => {
  it("states plot dimensions in feet", () => {
    const p = buildSystemPrompt(sampleBrief(40, 40));
    expect(p).toMatch(/represents a 40×40 ft plot/);
  });

  it("computes an integer pixels-per-foot anchor for a 40×40 plot (≈26)", () => {
    const p = buildSystemPrompt(sampleBrief(40, 40));
    // 1024 / 40 = 25.6 → rounded to 26
    expect(p).toMatch(/approximately 26 pixels per foot/);
  });

  it("uses the LARGER plot dimension for the scale (so non-square plots stay inside)", () => {
    const p = buildSystemPrompt(sampleBrief(30, 50));
    // 1024 / 50 = 20.48 → rounded to 20
    expect(p).toMatch(/approximately 20 pixels per foot/);
  });
});

describe("Phase 2.8 A2 — expected areas per room in prompt", () => {
  it("includes each room's approxAreaSqft inline", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/"Master Bedroom".*master_bedroom.*~168 sqft/);
    expect(p).toMatch(/"Pooja Room".*pooja.*~20 sqft/);
  });

  it("omits the area suffix when the brief doesn't supply one", () => {
    const brief = sampleBrief();
    brief.roomList.push({ name: "Balcony", type: "balcony" });
    const p = buildSystemPrompt(brief);
    // Balcony line should NOT contain a sqft suffix
    expect(p).toMatch(/"Balcony" \(balcony\)\n/);
  });

  it("instructs the model to re-examine when extracted area is ±50% off", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/±50%/);
    expect(p).toMatch(/re-examine the image/i);
  });

  it("explicitly warns against defaulting to square proportions", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/NOT 12×12/);
    expect(p).toMatch(/do not default to square/i);
  });
});

describe("Phase 2.8 A3 — visual-feature priority for ambiguous labels", () => {
  it("tells GPT-4o plumbing = bathroom, bed = bedroom, kitchen counter = kitchen", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/plumbing.*BATHROOM/i);
    expect(p).toMatch(/bed icon.*BEDROOM/i);
    expect(p).toMatch(/kitchen counter.*KITCHEN/i);
  });

  it('explicitly cautions against "Master Bath" → "Master Bedroom" overlap trap', () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/Master Bath[\s\S]*Master Bedroom[\s\S]*Master Bathroom/);
  });
});

describe("Phase 2.8 A4 — phantom-suppression clauses", () => {
  it("lists dimension lines, wall gaps, door arcs, and entry labels as NOT rooms", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/Dimension lines/i);
    expect(p).toMatch(/Wall thickness gaps/i);
    expect(p).toMatch(/Door arc/i);
    expect(p).toMatch(/ENTRY.*PORCH/);
  });

  it("sets a minimum 4×4 ft (≈16 sqft) threshold", () => {
    const p = buildSystemPrompt(sampleBrief());
    expect(p).toMatch(/4×4 ft[\s\S]*16 sqft/);
  });
});

// ─── B2 — phantom filter ────────────────────────────────────────

// Helpers for the validator tests. Assume 1024px image of a 40×40 ft
// plot (so plotBoundsPx.w/h = 1024, and 1 sqft ≈ 655 px² — i.e. a
// 25.6×25.6 px rect ≈ 1 sqft).
const PLOT_BOUNDS: RectPx = { x: 0, y: 0, w: 1024, h: 1024 };
const PLOT_W = 40;
const PLOT_D = 40;

function mkRoom(
  name: string,
  areaSqft: number,
  confidence = 0.9,
): ExtractedRoom {
  // Square rect with the given area in sqft.
  const sidePx = Math.round(Math.sqrt(areaSqft) * (1024 / 40));
  return {
    name,
    rectPx: { x: 0, y: 0, w: sidePx, h: sidePx },
    confidence,
    labelAsShown: name,
  };
}

describe("Phase 2.8 B2 — phantom room filter", () => {
  it("drops rooms below 12 sqft for standard room types", () => {
    const brief = sampleBrief();
    const rooms: ExtractedRoom[] = [
      mkRoom("Master Bedroom", 140),
      mkRoom("Hallway", 0.4), // the prod phantom
      mkRoom("Common Bathroom", 30),
    ];
    const issues: string[] = [];
    const res = dropPhantomRooms(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(res.kept.map((r) => r.name)).toEqual(["Master Bedroom", "Common Bathroom"]);
    expect(res.droppedNames).toContain("Hallway");
    expect(issues.some((m) => /phantom: dropped "Hallway"/.test(m))).toBe(true);
  });

  it("keeps small pooja rooms at 8 sqft (exemption for small room types)", () => {
    // Brief has Pooja Room with type="pooja". 10 sqft is below the
    // 12-sqft default but above the 8-sqft exempt threshold.
    const brief = sampleBrief();
    const rooms: ExtractedRoom[] = [
      mkRoom("Pooja Room", 10),
    ];
    const issues: string[] = [];
    const res = dropPhantomRooms(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(res.kept).toHaveLength(1);
    expect(res.kept[0].name).toBe("Pooja Room");
  });

  it("still drops pooja rooms below the 8-sqft exempt threshold", () => {
    const brief = sampleBrief();
    const rooms: ExtractedRoom[] = [
      mkRoom("Pooja Room", 4), // too small even for exemption
    ];
    const issues: string[] = [];
    const res = dropPhantomRooms(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(res.kept).toHaveLength(0);
    expect(res.droppedNames).toEqual(["Pooja Room"]);
  });

  it("is a no-op when plotBoundsPx is null (can't compute ft area)", () => {
    const brief = sampleBrief();
    const rooms: ExtractedRoom[] = [mkRoom("Tiny", 0.1)];
    const issues: string[] = [];
    const res = dropPhantomRooms(rooms, null, PLOT_W, PLOT_D, brief, issues);
    expect(res.kept).toEqual(rooms);
    expect(res.droppedNames).toEqual([]);
  });
});

describe("Phase 2.8 B2 — recomputeMissing after phantom drop", () => {
  it("rebuilds expectedRoomsMissing against the kept list", () => {
    const brief = sampleBrief();
    // Keep only Master Bedroom + Living Room. Other 6 expected rooms
    // should surface as missing.
    const kept: ExtractedRoom[] = [
      mkRoom("Master Bedroom", 140),
      mkRoom("Living Room", 280),
    ];
    const missing = recomputeMissing(
      kept,
      brief.roomList.map((r) => r.name),
    );
    expect(missing).toContain("Bedroom 2");
    expect(missing).toContain("Master Bathroom");
    expect(missing).not.toContain("Master Bedroom");
    expect(missing).not.toContain("Living Room");
  });
});

// ─── B3 — plausibility flag ─────────────────────────────────────

describe("Phase 2.8 B3 — plausibility flag against brief.approxAreaSqft", () => {
  it("flags a room extracted at <40% of expected area", () => {
    const brief = sampleBrief(); // Master Bedroom expected ~168 sqft
    const rooms: ExtractedRoom[] = [mkRoom("Master Bedroom", 60)]; // 36% of 168
    const issues: string[] = [];
    flagPlausibility(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(issues.length).toBe(1);
    expect(issues[0]).toMatch(/plausibility.*Master Bedroom.*ratio/i);
  });

  it("flags a room extracted at >250% of expected area", () => {
    const brief = sampleBrief(); // Common Bathroom expected ~35 sqft
    const rooms: ExtractedRoom[] = [mkRoom("Common Bathroom", 120)]; // ~343% of 35
    const issues: string[] = [];
    flagPlausibility(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(issues.length).toBe(1);
    expect(issues[0]).toMatch(/Common Bathroom/);
  });

  it("does NOT flag extractions within the plausibility band", () => {
    const brief = sampleBrief(); // Master Bedroom expected ~168 sqft
    const rooms: ExtractedRoom[] = [
      mkRoom("Master Bedroom", 140), // ~83% of expected
      mkRoom("Bedroom 2", 130), // ~108% of 120 expected
    ];
    const issues: string[] = [];
    flagPlausibility(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(issues).toEqual([]);
  });

  it("skips rooms not present in the brief (can't judge plausibility)", () => {
    const brief = sampleBrief();
    const rooms: ExtractedRoom[] = [mkRoom("Mystery Room", 5)];
    const issues: string[] = [];
    flagPlausibility(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(issues).toEqual([]);
  });

  it("does NOT mutate room coordinates — flag only", () => {
    const brief = sampleBrief();
    const rooms: ExtractedRoom[] = [mkRoom("Master Bedroom", 60)];
    const snapshotBefore = JSON.stringify(rooms);
    const issues: string[] = [];
    flagPlausibility(rooms, PLOT_BOUNDS, PLOT_W, PLOT_D, brief, issues);
    expect(JSON.stringify(rooms)).toBe(snapshotBefore);
  });
});

// ─── applyStage4PostValidation (combined wrapper) ──────────────

describe("Phase 2.8 — applyStage4PostValidation composes B2 + B3 + missing recompute", () => {
  it("drops phantom, flags plausibility mismatches, and recomputes missing in one pass", () => {
    const brief = sampleBrief();
    // Start with the prod-failure shape:
    //   - legitimate rooms (bedrooms, living, kitchen)
    //   - a phantom Hallway
    //   - a Master Bedroom sized to ~60 sqft (implausible)
    const extraction: ExtractedRooms = {
      imageSize: { width: 1024, height: 1024 },
      plotBoundsPx: PLOT_BOUNDS,
      rooms: [
        mkRoom("Master Bedroom", 60), // implausible
        mkRoom("Bedroom 2", 120), // OK
        mkRoom("Living Room", 280), // OK
        mkRoom("Kitchen", 80), // OK
        mkRoom("Hallway", 0.4), // phantom
      ],
      issues: [],
      expectedRoomsMissing: [],
      unexpectedRoomsFound: [],
    };
    applyStage4PostValidation(extraction, brief);
    // Hallway dropped.
    expect(extraction.rooms.map((r) => r.name)).toEqual([
      "Master Bedroom",
      "Bedroom 2",
      "Living Room",
      "Kitchen",
    ]);
    // Master Bedroom flagged as implausible.
    expect(
      extraction.issues.some((m) => /plausibility.*Master Bedroom/i.test(m)),
    ).toBe(true);
    expect(extraction.issues.some((m) => /phantom: dropped "Hallway"/.test(m))).toBe(true);
    // Missing list reflects the now-kept rooms.
    expect(extraction.expectedRoomsMissing).toContain("Master Bathroom");
    expect(extraction.expectedRoomsMissing).not.toContain("Master Bedroom");
  });
});
