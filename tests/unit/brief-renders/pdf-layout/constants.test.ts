/**
 * pdf-layout/constants.ts integrity tests.
 *
 * The constants file is the single source of truth for editorial
 * layout. These tests guard against silent regressions when someone
 * tweaks a value without realising downstream impact.
 */

import { describe, it, expect } from "vitest";

import {
  ASPECT_DEFAULT,
  ASPECT_LANDSCAPE_3_2,
  ASPECT_PORTRAIT_2_3,
  ASPECT_SQUARE_1_1,
  COLOR_DIVIDER_GREY,
  COLOR_HERO_GOLD,
  COLOR_PAGE_BG,
  COLOR_TEXT_PRIMARY,
  COLOR_TEXT_SECONDARY,
  COLOR_TEXT_TERTIARY,
  CONTENT_HEIGHT_MM,
  CONTENT_WIDTH_MM,
  FONT_SIZE_BODY,
  FONT_SIZE_FILENAME_MONO,
  FONT_SIZE_FOOTER,
  FONT_SIZE_LABEL,
  FONT_SIZE_PROJECT_SUBTITLE,
  FONT_SIZE_PROJECT_TITLE,
  FONT_SIZE_SECTION_HEADER,
  FONT_SIZE_SHOT_SUBTITLE,
  FONT_SIZE_SHOT_TITLE,
  FONT_SIZE_TABLE_BODY,
  IMAGE_WIDTH_MM,
  MARGIN_BOTTOM_MM,
  MARGIN_LEFT_MM,
  MARGIN_RIGHT_MM,
  MARGIN_TOP_MM,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  TABLE_CELL_PADDING_MM,
  TABLE_HEADER_HEIGHT_MM,
  TABLE_ROW_HEIGHT_MM,
} from "@/features/brief-renders/services/brief-pipeline/pdf-layout/constants";

describe("pdf-layout/constants — geometry math", () => {
  it("CONTENT_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_LEFT - MARGIN_RIGHT", () => {
    expect(CONTENT_WIDTH_MM).toBe(
      PAGE_WIDTH_MM - MARGIN_LEFT_MM - MARGIN_RIGHT_MM,
    );
  });

  it("CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - MARGIN_TOP - MARGIN_BOTTOM", () => {
    expect(CONTENT_HEIGHT_MM).toBe(
      PAGE_HEIGHT_MM - MARGIN_TOP_MM - MARGIN_BOTTOM_MM,
    );
  });

  it("IMAGE_WIDTH_MM matches CONTENT_WIDTH_MM (full-bleed shot images)", () => {
    expect(IMAGE_WIDTH_MM).toBe(CONTENT_WIDTH_MM);
  });

  it("page is A4 portrait (210x297 mm)", () => {
    expect(PAGE_WIDTH_MM).toBe(210);
    expect(PAGE_HEIGHT_MM).toBe(297);
  });
});

describe("pdf-layout/constants — color hex validation", () => {
  it.each([
    ["COLOR_TEXT_PRIMARY", COLOR_TEXT_PRIMARY],
    ["COLOR_TEXT_SECONDARY", COLOR_TEXT_SECONDARY],
    ["COLOR_TEXT_TERTIARY", COLOR_TEXT_TERTIARY],
    ["COLOR_HERO_GOLD", COLOR_HERO_GOLD],
    ["COLOR_DIVIDER_GREY", COLOR_DIVIDER_GREY],
    ["COLOR_PAGE_BG", COLOR_PAGE_BG],
  ])("%s is a valid 7-char hex string", (_name, value) => {
    expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("pdf-layout/constants — font sizes positive", () => {
  it.each([
    ["FONT_SIZE_PROJECT_TITLE", FONT_SIZE_PROJECT_TITLE],
    ["FONT_SIZE_PROJECT_SUBTITLE", FONT_SIZE_PROJECT_SUBTITLE],
    ["FONT_SIZE_SECTION_HEADER", FONT_SIZE_SECTION_HEADER],
    ["FONT_SIZE_SHOT_TITLE", FONT_SIZE_SHOT_TITLE],
    ["FONT_SIZE_SHOT_SUBTITLE", FONT_SIZE_SHOT_SUBTITLE],
    ["FONT_SIZE_BODY", FONT_SIZE_BODY],
    ["FONT_SIZE_TABLE_BODY", FONT_SIZE_TABLE_BODY],
    ["FONT_SIZE_FOOTER", FONT_SIZE_FOOTER],
    ["FONT_SIZE_LABEL", FONT_SIZE_LABEL],
    ["FONT_SIZE_FILENAME_MONO", FONT_SIZE_FILENAME_MONO],
  ])("%s is a positive finite number", (_name, value) => {
    expect(typeof value).toBe("number");
    expect(value).toBeGreaterThan(0);
    expect(Number.isFinite(value)).toBe(true);
  });
});

describe("pdf-layout/constants — table sizing", () => {
  it("TABLE_CELL_PADDING_MM, TABLE_ROW_HEIGHT_MM, TABLE_HEADER_HEIGHT_MM are positive", () => {
    expect(TABLE_CELL_PADDING_MM).toBeGreaterThan(0);
    expect(TABLE_ROW_HEIGHT_MM).toBeGreaterThan(0);
    expect(TABLE_HEADER_HEIGHT_MM).toBeGreaterThan(0);
  });
});

describe("pdf-layout/constants — aspect ratios", () => {
  it("ASPECT_LANDSCAPE_3_2 = 3/2", () => {
    expect(ASPECT_LANDSCAPE_3_2).toBeCloseTo(1.5);
  });
  it("ASPECT_PORTRAIT_2_3 = 2/3", () => {
    expect(ASPECT_PORTRAIT_2_3).toBeCloseTo(0.6667, 3);
  });
  it("ASPECT_SQUARE_1_1 = 1", () => {
    expect(ASPECT_SQUARE_1_1).toBe(1);
  });
  it("ASPECT_DEFAULT is landscape", () => {
    expect(ASPECT_DEFAULT).toBe(ASPECT_LANDSCAPE_3_2);
  });
});
