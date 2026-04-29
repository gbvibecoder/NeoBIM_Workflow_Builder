/**
 * cover.ts composer tests.
 *
 * Mocks jspdf via a thin spy doc — observe `text`, `setFont`,
 * `setFontSize`, `addImage`, `splitTextToSize` calls. Asserts strict-
 * faithfulness behaviours: null source → no `text()` call with the
 * placeholder string.
 */

import { describe, it, expect } from "vitest";

import { renderCoverPage } from "@/features/brief-renders/services/brief-pipeline/pdf-layout/cover";
import type {
  ApartmentSpec,
  BaselineSpec,
  BriefSpec,
} from "@/features/brief-renders/services/brief-pipeline/types";

interface TextCall {
  text: string | string[];
  x: number;
  y: number;
  options?: { align?: "left" | "right" | "center" };
}

interface SpyDoc {
  texts: TextCall[];
  fontFamilyHistory: Array<{ family: string; style: string }>;
  fontSizeHistory: number[];
  textColorHistory: string[];
  drawColorHistory: string[];
  lineWidthHistory: number[];
  lines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  addPageCalls: number;
  splitTextToSize: (text: string, width: number) => string[];
  text: (
    text: string | string[],
    x: number,
    y: number,
    options?: { align?: "left" | "right" | "center" },
  ) => void;
  setFont: (family: string, style: string) => void;
  setFontSize: (size: number) => void;
  setTextColor: (color: string) => void;
  setDrawColor: (color: string) => void;
  setLineWidth: (w: number) => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  addPage: () => void;
}

function makeSpyDoc(): SpyDoc {
  const doc: SpyDoc = {
    texts: [],
    fontFamilyHistory: [],
    fontSizeHistory: [],
    textColorHistory: [],
    drawColorHistory: [],
    lineWidthHistory: [],
    lines: [],
    addPageCalls: 0,
    splitTextToSize(text: string, _width: number) {
      // Simple wrapper — single-line wrap. Production jspdf measures
      // glyph width; the spy is sufficient for layout-call assertions.
      return text.length === 0 ? [""] : [text];
    },
    text(text, x, y, options) {
      doc.texts.push({ text, x, y, options });
    },
    setFont(family, style) {
      doc.fontFamilyHistory.push({ family, style });
    },
    setFontSize(size) {
      doc.fontSizeHistory.push(size);
    },
    setTextColor(color) {
      doc.textColorHistory.push(color);
    },
    setDrawColor(color) {
      doc.drawColorHistory.push(color);
    },
    setLineWidth(w) {
      doc.lineWidthHistory.push(w);
    },
    line(x1, y1, x2, y2) {
      doc.lines.push({ x1, y1, x2, y2 });
    },
    addPage() {
      doc.addPageCalls++;
    },
  };
  return doc;
}

const NULL_BASELINE: BaselineSpec = {
  visualStyle: null,
  materialPalette: null,
  lightingBaseline: null,
  cameraBaseline: null,
  qualityTarget: null,
  additionalNotes: null,
};

function emptyApt(label: string | null = null): ApartmentSpec {
  return {
    label,
    labelDe: null,
    totalAreaSqm: null,
    bedrooms: null,
    bathrooms: null,
    description: null,
    shots: [],
  };
}

const MINIMAL_SPEC: BriefSpec = {
  projectTitle: null,
  projectLocation: null,
  projectType: null,
  baseline: NULL_BASELINE,
  apartments: [],
  referenceImageUrls: [],
};

function flattenTextCalls(doc: SpyDoc): string[] {
  return doc.texts.map((t) =>
    Array.isArray(t.text) ? t.text.join(" ") : t.text,
  );
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("renderCoverPage — strict faithfulness", () => {
  it("renders project title from spec.projectTitle when present", () => {
    const doc = makeSpyDoc();
    const spec: BriefSpec = { ...MINIMAL_SPEC, projectTitle: "Marx12" };
    renderCoverPage(doc as unknown as Parameters<typeof renderCoverPage>[0], {
      spec,
      totalShots: 12,
      version: "01",
      fontFamily: "Inter",
    });
    expect(flattenTextCalls(doc)).toContain("Marx12");
  });

  it("renders NOTHING for title when projectTitle is null (no placeholder)", () => {
    const doc = makeSpyDoc();
    const spec: BriefSpec = { ...MINIMAL_SPEC, projectTitle: null };
    renderCoverPage(doc as unknown as Parameters<typeof renderCoverPage>[0], {
      spec,
      totalShots: 12,
      version: "01",
      fontFamily: "Inter",
    });
    const allText = flattenTextCalls(doc);
    // No placeholder strings.
    expect(allText).not.toContain("Untitled");
    expect(allText).not.toContain("Untitled Project");
    expect(allText).not.toContain("null");
    expect(allText).not.toContain("N/A");
  });

  it("renders subtitle from projectLocation + projectType joined by ·", () => {
    const doc = makeSpyDoc();
    const spec: BriefSpec = {
      ...MINIMAL_SPEC,
      projectLocation: "Berlin",
      projectType: "residential",
    };
    renderCoverPage(doc as unknown as Parameters<typeof renderCoverPage>[0], {
      spec,
      totalShots: 12,
      version: "01",
      fontFamily: "Inter",
    });
    expect(flattenTextCalls(doc)).toContain("Berlin · residential");
  });

  it("renders subtitle with only projectLocation when projectType is null", () => {
    const doc = makeSpyDoc();
    const spec: BriefSpec = { ...MINIMAL_SPEC, projectLocation: "Berlin" };
    renderCoverPage(doc as unknown as Parameters<typeof renderCoverPage>[0], {
      spec,
      totalShots: 12,
      version: "01",
      fontFamily: "Inter",
    });
    expect(flattenTextCalls(doc)).toContain("Berlin");
  });

  it("renders 'N PHOTOREALISTIC INTERIOR RENDERINGS' parameterised by totalShots", () => {
    const doc = makeSpyDoc();
    renderCoverPage(doc as unknown as Parameters<typeof renderCoverPage>[0], {
      spec: MINIMAL_SPEC,
      totalShots: 8,
      version: "01",
      fontFamily: "Inter",
    });
    expect(flattenTextCalls(doc)).toContain(
      "EIGHT PHOTOREALISTIC INTERIOR RENDERINGS",
    );
  });

  it("renders apartment table headers + one row per apartment", () => {
    const doc = makeSpyDoc();
    const spec: BriefSpec = {
      ...MINIMAL_SPEC,
      apartments: [
        emptyApt("WE 01bb"),
        emptyApt("WE 02ab"),
        emptyApt("WE 03cc"),
      ],
    };
    renderCoverPage(doc as unknown as Parameters<typeof renderCoverPage>[0], {
      spec,
      totalShots: 12,
      version: "01",
      fontFamily: "Inter",
    });
    const allText = flattenTextCalls(doc);
    expect(allText).toContain("APARTMENT");
    expect(allText).toContain("LAYOUT");
    expect(allText).toContain("AREA");
    expect(allText).toContain("PERSONA");
    expect(allText).toContain("SHOTS");
    expect(allText).toContain("WE 01bb");
    expect(allText).toContain("WE 02ab");
    expect(allText).toContain("WE 03cc");
  });

  it("renders empty cells for null leaves (never 'null' / 'N/A')", () => {
    const doc = makeSpyDoc();
    const spec: BriefSpec = {
      ...MINIMAL_SPEC,
      apartments: [emptyApt(null)],
    };
    renderCoverPage(doc as unknown as Parameters<typeof renderCoverPage>[0], {
      spec,
      totalShots: 0,
      version: "01",
      fontFamily: "Inter",
    });
    const allText = flattenTextCalls(doc);
    // Apartment label cell renders "" (we still call text() for the
    // empty string; check no placeholder leaked).
    expect(allText).not.toContain("null");
    expect(allText).not.toContain("undefined");
    expect(allText).not.toContain("N/A");
  });

  it("baseline header uses numberToWord (12 → 'TWELVE')", () => {
    const doc = makeSpyDoc();
    renderCoverPage(doc as unknown as Parameters<typeof renderCoverPage>[0], {
      spec: MINIMAL_SPEC,
      totalShots: 12,
      version: "01",
      fontFamily: "Inter",
    });
    expect(flattenTextCalls(doc)).toContain(
      "BASELINE — APPLIED TO ALL TWELVE RENDERINGS",
    );
  });

  it("does NOT call addPage() (cover is page 1, caller already there)", () => {
    const doc = makeSpyDoc();
    renderCoverPage(doc as unknown as Parameters<typeof renderCoverPage>[0], {
      spec: MINIMAL_SPEC,
      totalShots: 12,
      version: "01",
      fontFamily: "Inter",
    });
    expect(doc.addPageCalls).toBe(0);
  });

  it("body paragraph wraps via splitTextToSize when baseline.additionalNotes present", () => {
    const doc = makeSpyDoc();
    const spec: BriefSpec = {
      ...MINIMAL_SPEC,
      baseline: {
        ...NULL_BASELINE,
        additionalNotes: "A long body paragraph that should wrap.",
      },
    };
    renderCoverPage(doc as unknown as Parameters<typeof renderCoverPage>[0], {
      spec,
      totalShots: 12,
      version: "01",
      fontFamily: "Inter",
    });
    // splitTextToSize-wrapped text comes through as a string array.
    const arrayTexts = doc.texts.filter((t) => Array.isArray(t.text));
    expect(arrayTexts.length).toBeGreaterThan(0);
  });

  it("renders footer with version on every cover invocation", () => {
    const doc = makeSpyDoc();
    renderCoverPage(doc as unknown as Parameters<typeof renderCoverPage>[0], {
      spec: MINIMAL_SPEC,
      totalShots: 12,
      version: "07",
      fontFamily: "Inter",
    });
    const allText = flattenTextCalls(doc);
    expect(allText).toContain("Confidential — for client review");
    expect(allText).toContain("v07 — M3 Full Draft");
  });
});
