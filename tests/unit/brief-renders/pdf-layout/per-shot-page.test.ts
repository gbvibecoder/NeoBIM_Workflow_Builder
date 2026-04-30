/**
 * per-shot-page.ts composer tests.
 *
 * Mocks jspdf with a spy doc; observes text + addImage + setFont calls.
 * Asserts hero badge gating, image-aspect math, null-safe rendering,
 * and the strict-faithfulness invariants.
 */

import { describe, it, expect } from "vitest";

import { renderShotPage } from "@/features/brief-renders/services/brief-pipeline/pdf-layout/per-shot-page";
import {
  IMAGE_WIDTH_MM,
} from "@/features/brief-renders/services/brief-pipeline/pdf-layout/constants";
import type {
  ApartmentSpec,
  ShotSpec,
} from "@/features/brief-renders/services/brief-pipeline/types";

interface AddImageCall {
  data: string;
  format: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ShotSpyDoc {
  texts: string[];
  fontStyles: Array<{ family: string; style: string }>;
  fontSizes: number[];
  textColors: string[];
  fillColors: string[];
  rects: Array<{ x: number; y: number; w: number; h: number; style: string }>;
  diamonds: Array<{ x: number; y: number; style: string; closed: boolean }>;
  images: AddImageCall[];
  splitTextToSize: (text: string, w: number) => string[];
  text: (
    t: string | string[],
    x: number,
    y: number,
    opts?: { align?: "left" | "right" | "center" },
  ) => void;
  setFont: (family: string, style: string) => void;
  setFontSize: (size: number) => void;
  setTextColor: (color: string) => void;
  setDrawColor: (color: string) => void;
  setFillColor: (color: string) => void;
  setLineWidth: (w: number) => void;
  line: (...args: number[]) => void;
  rect: (x: number, y: number, w: number, h: number, style?: string) => void;
  lines: (
    segments: Array<[number, number]>,
    x: number,
    y: number,
    scale: [number, number],
    style?: string,
    closed?: boolean,
  ) => void;
  getTextWidth: (text: string) => number;
  addImage: (
    data: string,
    format: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
}

function makeShotSpyDoc(): ShotSpyDoc {
  const doc: ShotSpyDoc = {
    texts: [],
    fontStyles: [],
    fontSizes: [],
    textColors: [],
    fillColors: [],
    rects: [],
    diamonds: [],
    images: [],
    splitTextToSize: (text: string, _w: number) =>
      text.length === 0 ? [""] : [text],
    text(t) {
      const value = Array.isArray(t) ? t.join(" ") : t;
      doc.texts.push(value);
    },
    setFont(family, style) {
      doc.fontStyles.push({ family, style });
    },
    setFontSize(size) {
      doc.fontSizes.push(size);
    },
    setTextColor(c) {
      doc.textColors.push(c);
    },
    setDrawColor() {},
    setFillColor(c) {
      doc.fillColors.push(c);
    },
    setLineWidth() {},
    line() {},
    rect(x, y, w, h, style = "") {
      doc.rects.push({ x, y, w, h, style });
    },
    lines(_segments, x, y, _scale, style = "", closed = false) {
      doc.diamonds.push({ x, y, style, closed });
    },
    // Rough char-width estimate; jspdf's real implementation uses font
    // metrics, but for spy purposes any deterministic positive number
    // gives the hero badge its layout offset.
    getTextWidth(text: string) {
      return text.length * 1.5;
    },
    addImage(data, format, x, y, width, height) {
      doc.images.push({ data, format, x, y, width, height });
    },
  };
  return doc;
}

const NULL_APT: ApartmentSpec = {
  label: null,
  labelDe: null,
  totalAreaSqm: null,
  bedrooms: null,
  bathrooms: null,
  description: null,
  shots: [],
};

const NULL_SHOT: ShotSpec = {
  shotIndex: null,
  roomNameEn: null,
  roomNameDe: null,
  areaSqm: null,
  aspectRatio: null,
  lightingDescription: null,
  cameraDescription: null,
  materialNotes: null,
  isHero: false,
};

const COMMON_RENDER_ARGS = {
  totalShotsInApartment: 4,
  imageBase64: "ZmFrZWltYWdl",
  imageMimeType: "image/png" as const,
  version: "01",
  fontFamily: "Inter",
};

// ─── Hero badge gating ────────────────────────────────────────────

describe("renderShotPage — hero badge gating", () => {
  it("renders 'HERO SHOT' label + filled gold diamond when shotIndexInApartment === 0", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: NULL_SHOT,
      shotIndexInApartment: 0,
    });
    // Diamond glyph dropped — rendered as geometry now (closed
    // 4-vertex filled polygon via doc.lines with the gold colour).
    expect(doc.texts).toContain("HERO SHOT");
    expect(doc.fillColors).toContain("#B8893D");
    expect(
      doc.diamonds.some((d) => d.style === "F" && d.closed === true),
    ).toBe(true);
  });

  it("does NOT render hero badge for shotIndexInApartment > 0", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: NULL_SHOT,
      shotIndexInApartment: 1,
    });
    expect(doc.texts).not.toContain("HERO SHOT");
    // Non-hero pages have no diamond polygon either.
    expect(doc.diamonds.length).toBe(0);
  });
});

// ─── Shot N of M ──────────────────────────────────────────────────

describe("renderShotPage — Shot N of M", () => {
  it("formats correctly with 1-based n", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: NULL_SHOT,
      shotIndexInApartment: 2,
      totalShotsInApartment: 4,
    });
    expect(doc.texts).toContain("Shot 3 of 4");
  });
});

// ─── Image aspect math ───────────────────────────────────────────

describe("renderShotPage — image aspect math", () => {
  it("landscape 3:2 → height = width * (2/3)", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: { ...NULL_SHOT, aspectRatio: "3:2" },
      shotIndexInApartment: 0,
    });
    expect(doc.images.length).toBe(1);
    expect(doc.images[0].width).toBe(IMAGE_WIDTH_MM);
    expect(doc.images[0].height).toBeCloseTo(IMAGE_WIDTH_MM * (2 / 3), 1);
  });

  it("portrait 2:3 → height scales to fit available space (still smaller than naïve)", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: { ...NULL_SHOT, aspectRatio: "2:3" },
      shotIndexInApartment: 0,
    });
    // Natural height for 2:3 with 174mm width is 261mm — would overflow.
    // The composer scales down. We accept any height < natural.
    const naturalHeight = IMAGE_WIDTH_MM * (3 / 2);
    expect(doc.images[0].height).toBeLessThan(naturalHeight);
    // Aspect ratio preserved: width/height ≈ 2/3 (within rounding).
    const aspect = doc.images[0].width / doc.images[0].height;
    expect(aspect).toBeCloseTo(2 / 3, 1);
  });

  it("square 1:1 → height = width", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: { ...NULL_SHOT, aspectRatio: "1:1" },
      shotIndexInApartment: 0,
    });
    expect(doc.images[0].width).toBeCloseTo(doc.images[0].height, 1);
  });

  it("null aspect → falls back to landscape 3:2", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: { ...NULL_SHOT, aspectRatio: null },
      shotIndexInApartment: 0,
    });
    expect(doc.images[0].height).toBeCloseTo(IMAGE_WIDTH_MM * (2 / 3), 1);
  });
});

// ─── Null-safe rendering ─────────────────────────────────────────

describe("renderShotPage — null-safe rendering", () => {
  it("shot title rendered from roomNameEn when present", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: { ...NULL_SHOT, roomNameEn: "Open Kitchen-Dining" },
      shotIndexInApartment: 0,
    });
    expect(doc.texts).toContain("Open Kitchen-Dining");
  });

  it("no shot title rendered when roomNameEn is null", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: { ...NULL_SHOT, roomNameEn: null },
      shotIndexInApartment: 0,
    });
    // Texts should not contain placeholder strings.
    expect(doc.texts).not.toContain("Untitled");
    expect(doc.texts).not.toContain("null");
  });

  it("German subtitle rendered from roomNameDe when present", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: { ...NULL_SHOT, roomNameEn: "Living", roomNameDe: "Wohnen" },
      shotIndexInApartment: 0,
    });
    expect(doc.texts).toContain("Living");
    expect(doc.texts).toContain("Wohnen");
  });

  it("German subtitle absent when roomNameDe is null", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: { ...NULL_SHOT, roomNameEn: "Living", roomNameDe: null },
      shotIndexInApartment: 0,
    });
    expect(doc.texts).toContain("Living");
    // No second German title; the only "Living" appearance is the English title.
    expect(doc.texts.filter((t) => t === "Living").length).toBe(1);
  });

  it("3-column metadata uses values from shot, empty for null fields", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: {
        ...NULL_SHOT,
        areaSqm: 32.54,
        aspectRatio: "3:2",
        lightingDescription: "golden hour",
      },
      shotIndexInApartment: 0,
    });
    expect(doc.texts).toContain("32.54 m²");
    expect(doc.texts).toContain("Landscape 3:2");
    expect(doc.texts).toContain("golden hour");
  });

  it("metadata column values empty when source fields are null", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: NULL_SHOT,
      shotIndexInApartment: 0,
    });
    // The 3 column LABELS still render. The values do not contain
    // any placeholder. Each value cell receives an empty-string text() call.
    expect(doc.texts).toContain("ROOM AREA");
    expect(doc.texts).toContain("ASPECT");
    expect(doc.texts).toContain("LIGHTING");
    expect(doc.texts).not.toContain("null");
    expect(doc.texts).not.toContain("undefined");
  });
});

// ─── Filename block ────────────────────────────────────────────────

describe("renderShotPage — filename block", () => {
  it("synthesises filename from apartment.label + shot index + room name", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: { ...NULL_APT, label: "WE 01bb" },
      shot: { ...NULL_SHOT, roomNameEn: "Open Kitchen-Dining" },
      shotIndexInApartment: 0,
    });
    expect(doc.texts).toContain("WE01bb_S1_OpenKitchenDining");
  });

  it("filename empty when neither label nor roomNameEn is present", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: NULL_SHOT,
      shotIndexInApartment: 0,
    });
    // Filename label still renders; the value is "" (no placeholder).
    expect(doc.texts).toContain("FILENAME (PER BRIEF §3.2)");
  });
});

// ─── addImage call shape ───────────────────────────────────────────

describe("renderShotPage — addImage call", () => {
  it("includes the data:image MIME prefix + format hint", () => {
    const doc = makeShotSpyDoc();
    renderShotPage(doc as unknown as Parameters<typeof renderShotPage>[0], {
      ...COMMON_RENDER_ARGS,
      apartment: NULL_APT,
      shot: { ...NULL_SHOT, aspectRatio: "3:2" },
      shotIndexInApartment: 0,
    });
    expect(doc.images[0].data).toMatch(/^data:image\/png;base64,/);
    expect(doc.images[0].format).toBe("PNG");
  });
});
