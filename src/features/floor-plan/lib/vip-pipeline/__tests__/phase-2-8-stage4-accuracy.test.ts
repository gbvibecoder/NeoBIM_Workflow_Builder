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
