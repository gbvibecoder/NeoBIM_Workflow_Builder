/**
 * pdf-layout/labels.ts tests.
 *
 * Asserts the parametric label helpers stay in sync with the
 * "no hardcoded 12" rule — N=12 → "TWELVE", N=4 → "FOUR", N>20 → numeric.
 */

import { describe, it, expect } from "vitest";

import {
  LABEL_ASPECT,
  LABEL_BASELINE_HEADER,
  LABEL_FILENAME_PREFIX,
  LABEL_FOOTER_LEFT,
  LABEL_FOOTER_RIGHT,
  LABEL_HERO_SHOT,
  LABEL_LIGHTING,
  LABEL_PHOTOREALISTIC_COUNT,
  LABEL_ROOM_AREA,
  LABEL_SHOT_N_OF_M,
  LABEL_TABLE_APARTMENT,
  LABEL_TABLE_AREA,
  LABEL_TABLE_LAYOUT,
  LABEL_TABLE_PERSONA,
  LABEL_TABLE_SHOTS,
  numberToWord,
} from "@/features/brief-renders/services/brief-pipeline/pdf-layout/labels";

describe("numberToWord", () => {
  it.each([
    [0, "ZERO"],
    [1, "ONE"],
    [4, "FOUR"],
    [12, "TWELVE"],
    [20, "TWENTY"],
  ])("converts %i → %s", (input, expected) => {
    expect(numberToWord(input)).toBe(expected);
  });

  it("falls back to numeric for N > 20", () => {
    expect(numberToWord(21)).toBe("21");
    expect(numberToWord(100)).toBe("100");
  });

  it("handles non-integer / negative defensively", () => {
    expect(numberToWord(-1)).toBe("-1");
    expect(numberToWord(3.5)).toBe("3.5");
    expect(numberToWord(NaN)).toBe("NaN");
  });
});

describe("LABEL_BASELINE_HEADER", () => {
  it("12 shots → uses spelled-out 'TWELVE'", () => {
    expect(LABEL_BASELINE_HEADER(12)).toBe(
      "BASELINE — APPLIED TO ALL TWELVE RENDERINGS",
    );
  });

  it("4 shots → 'FOUR'", () => {
    expect(LABEL_BASELINE_HEADER(4)).toBe(
      "BASELINE — APPLIED TO ALL FOUR RENDERINGS",
    );
  });

  it("25 shots → numeric fallback", () => {
    expect(LABEL_BASELINE_HEADER(25)).toBe(
      "BASELINE — APPLIED TO ALL 25 RENDERINGS",
    );
  });

  it("0 shots → 'ZERO'", () => {
    expect(LABEL_BASELINE_HEADER(0)).toBe(
      "BASELINE — APPLIED TO ALL ZERO RENDERINGS",
    );
  });
});

describe("LABEL_PHOTOREALISTIC_COUNT", () => {
  it("12 shots → 'TWELVE PHOTOREALISTIC INTERIOR RENDERINGS'", () => {
    expect(LABEL_PHOTOREALISTIC_COUNT(12)).toBe(
      "TWELVE PHOTOREALISTIC INTERIOR RENDERINGS",
    );
  });
  it("8 shots → 'EIGHT'", () => {
    expect(LABEL_PHOTOREALISTIC_COUNT(8)).toBe(
      "EIGHT PHOTOREALISTIC INTERIOR RENDERINGS",
    );
  });
});

describe("LABEL_FOOTER_RIGHT", () => {
  it('strips a leading "v" so callers can pass either "01" or "v01"', () => {
    expect(LABEL_FOOTER_RIGHT("01")).toBe("v01 — M3 Full Draft");
    expect(LABEL_FOOTER_RIGHT("v01")).toBe("v01 — M3 Full Draft");
    expect(LABEL_FOOTER_RIGHT("V2")).toBe("v2 — M3 Full Draft");
  });
});

describe("LABEL_SHOT_N_OF_M", () => {
  it("formats correctly", () => {
    expect(LABEL_SHOT_N_OF_M(1, 4)).toBe("Shot 1 of 4");
    expect(LABEL_SHOT_N_OF_M(12, 12)).toBe("Shot 12 of 12");
  });
});

describe("Static label snapshots", () => {
  // Snapshot-style assertions to lock the visible chrome strings.
  // Changing any of these is a load-bearing visual change; the test
  // forces explicit acknowledgement.
  it("static chrome labels match the reference layout exactly", () => {
    // The diamond glyph was dropped from the label string because
    // U+25C6 falls outside WinAnsi (Helvetica fallback) and rendered
    // as garbage when Inter TTFs were missing. The visual diamond is
    // now drawn as geometry by per-shot-page.ts; the label carries
    // only the text.
    expect(LABEL_HERO_SHOT).toBe("HERO SHOT");
    expect(LABEL_ROOM_AREA).toBe("ROOM AREA");
    expect(LABEL_ASPECT).toBe("ASPECT");
    expect(LABEL_LIGHTING).toBe("LIGHTING");
    expect(LABEL_FILENAME_PREFIX).toBe("FILENAME (PER BRIEF §3.2)");
    expect(LABEL_FOOTER_LEFT).toBe("Confidential — for client review");
    expect(LABEL_TABLE_APARTMENT).toBe("APARTMENT");
    expect(LABEL_TABLE_LAYOUT).toBe("LAYOUT");
    expect(LABEL_TABLE_AREA).toBe("AREA");
    expect(LABEL_TABLE_PERSONA).toBe("PERSONA");
    expect(LABEL_TABLE_SHOTS).toBe("SHOTS");
  });
});
