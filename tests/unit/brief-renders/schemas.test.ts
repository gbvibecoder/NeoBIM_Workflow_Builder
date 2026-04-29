/**
 * Zod schema integrity tests for the Brief-to-Renders pipeline.
 *
 * These verify the load-bearing strict-faithfulness contract at the
 * schema level — Claude can be tested for prompt-following separately
 * (E2E in Phase 6), but the schema must reject invented keys and
 * wrong-typed values regardless of what Claude produces.
 */

import { describe, it, expect } from "vitest";

import {
  BaselineSpecSchema,
  ApartmentSpecSchema,
  ShotSpecSchema,
  BriefSpecSchema,
  briefSpecJsonSchema,
} from "@/features/brief-renders/services/brief-pipeline/schemas";

const ALL_NULL_BASELINE = {
  visualStyle: null,
  materialPalette: null,
  lightingBaseline: null,
  cameraBaseline: null,
  qualityTarget: null,
  additionalNotes: null,
} as const;

const MINIMAL_BRIEF = {
  projectTitle: null,
  projectLocation: null,
  projectType: null,
  baseline: ALL_NULL_BASELINE,
  // Phase 3: shots are nested under each apartment, not at the BriefSpec level.
  apartments: [],
  referenceImageUrls: [],
} as const;

describe("BriefSpecSchema — strict mode", () => {
  it("rejects unknown top-level keys", () => {
    const result = BriefSpecSchema.safeParse({
      ...MINIMAL_BRIEF,
      extraInventedField: "this should be rejected",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys inside nested objects (baseline)", () => {
    const result = BriefSpecSchema.safeParse({
      ...MINIMAL_BRIEF,
      baseline: { ...ALL_NULL_BASELINE, hallucinatedField: "boom" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys inside apartments[]", () => {
    const result = BriefSpecSchema.safeParse({
      ...MINIMAL_BRIEF,
      apartments: [
        {
          label: null,
          labelDe: null,
          totalAreaSqm: null,
          bedrooms: null,
          bathrooms: null,
          description: null,
          shots: [],
          surpriseField: 42,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys inside apartments[].shots[] (Phase 3 nested shape)", () => {
    const result = BriefSpecSchema.safeParse({
      ...MINIMAL_BRIEF,
      apartments: [
        {
          label: null,
          labelDe: null,
          totalAreaSqm: null,
          bedrooms: null,
          bathrooms: null,
          description: null,
          shots: [
            {
              shotIndex: 1,
              roomNameEn: "Living",
              roomNameDe: null,
              areaSqm: null,
              aspectRatio: null,
              lightingDescription: null,
              cameraDescription: null,
              materialNotes: null,
              isHero: false,
              wallColor: "white", // invented — not in schema
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("BriefSpecSchema — every leaf accepts null", () => {
  it("accepts an all-null baseline", () => {
    const result = BaselineSpecSchema.safeParse(ALL_NULL_BASELINE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visualStyle).toBeNull();
      expect(result.data.materialPalette).toBeNull();
    }
  });

  it("accepts an apartment with all leaves null and an empty shots array", () => {
    const result = ApartmentSpecSchema.safeParse({
      label: null,
      labelDe: null,
      totalAreaSqm: null,
      bedrooms: null,
      bathrooms: null,
      description: null,
      shots: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a shot with all leaves null (isHero defaults to false)", () => {
    const result = ShotSpecSchema.safeParse({
      shotIndex: null,
      roomNameEn: null,
      roomNameDe: null,
      areaSqm: null,
      aspectRatio: null,
      lightingDescription: null,
      cameraDescription: null,
      materialNotes: null,
      isHero: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // isHero null → false per the sanctioned non-null default.
      expect(result.data.isHero).toBe(false);
    }
  });

  it("accepts the minimal full brief", () => {
    const result = BriefSpecSchema.safeParse(MINIMAL_BRIEF);
    expect(result.success).toBe(true);
  });
});

describe("BriefSpecSchema — leaves that omit fields normalise to null", () => {
  it("normalises missing baseline keys to null", () => {
    const result = BaselineSpecSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visualStyle).toBeNull();
      expect(result.data.materialPalette).toBeNull();
      expect(result.data.lightingBaseline).toBeNull();
      expect(result.data.cameraBaseline).toBeNull();
      expect(result.data.qualityTarget).toBeNull();
      expect(result.data.additionalNotes).toBeNull();
    }
  });

  it("normalises missing apartment leaf keys to null (shots still required)", () => {
    // Phase 3: `shots` is a required non-nullable array. The other leaves
    // remain `nullable().optional()` and normalise to null when absent.
    const result = ApartmentSpecSchema.safeParse({ shots: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.label).toBeNull();
      expect(result.data.totalAreaSqm).toBeNull();
      expect(result.data.shots).toEqual([]);
    }
  });

  it("rejects an apartment whose `shots` field is missing", () => {
    const result = ApartmentSpecSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("normalises missing shot keys (and missing isHero → false)", () => {
    const result = ShotSpecSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shotIndex).toBeNull();
      expect(result.data.isHero).toBe(false);
    }
  });
});

describe("BriefSpecSchema — type validation", () => {
  it("rejects a string where a number is expected", () => {
    const result = ShotSpecSchema.safeParse({
      shotIndex: 1,
      roomNameEn: "Living",
      roomNameDe: null,
      areaSqm: "approximately 32m", // wrong type — schema expects number | null
      aspectRatio: null,
      lightingDescription: null,
      cameraDescription: null,
      materialNotes: null,
      isHero: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("areaSqm"))).toBe(true);
    }
  });

  it("rejects a number where a string is expected", () => {
    const result = ApartmentSpecSchema.safeParse({
      label: 12345, // wrong type
      labelDe: null,
      totalAreaSqm: null,
      bedrooms: null,
      bathrooms: null,
      description: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts integer-valued numbers and float-valued numbers identically", () => {
    const intResult = ShotSpecSchema.safeParse({
      shotIndex: 1,
      areaSqm: 32,
    });
    const floatResult = ShotSpecSchema.safeParse({
      shotIndex: 1,
      areaSqm: 32.54,
    });
    expect(intResult.success).toBe(true);
    expect(floatResult.success).toBe(true);
  });
});

describe("BriefSpecSchema — array shapes", () => {
  it("accepts an empty apartments array", () => {
    const result = BriefSpecSchema.safeParse({
      ...MINIMAL_BRIEF,
      apartments: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a Marx12-shaped 3-apartment, 12-shot brief (Phase 3 nested shape)", () => {
    const buildShots = () =>
      Array.from({ length: 4 }, (_, i) => ({
        shotIndex: i + 1,
        roomNameEn: i === 0 ? "Open Kitchen-Dining" : "Living",
        roomNameDe: i === 0 ? "Kochen-Essen" : "Wohnen",
        areaSqm: 32.54,
        aspectRatio: "3:2",
        lightingDescription: "golden hour",
        cameraDescription: null,
        materialNotes: null,
        isHero: i === 0, // shot 0 of each apartment is hero
      }));
    const apartmentBase = {
      labelDe: null,
      totalAreaSqm: 95.4,
      bedrooms: 2,
      bathrooms: 1,
      description: null,
    };
    const apartments = [
      { ...apartmentBase, label: "WE 01bb", shots: buildShots() },
      { ...apartmentBase, label: "WE 02ab", shots: buildShots() },
      { ...apartmentBase, label: "WE 03cc", shots: buildShots() },
    ];
    const result = BriefSpecSchema.safeParse({
      projectTitle: "Marx12",
      projectLocation: "Berlin",
      projectType: "residential",
      baseline: {
        visualStyle: "photorealistic interior",
        materialPalette: "oak floor, white walls",
        lightingBaseline: "golden hour",
        cameraBaseline: "eye-level wide-angle",
        qualityTarget: "real-estate listing quality",
        additionalNotes: null,
      },
      apartments,
      referenceImageUrls: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apartments.length).toBe(3);
      expect(result.data.apartments[0].shots.length).toBe(4);
      expect(result.data.apartments[0].shots[0].isHero).toBe(true);
      expect(result.data.apartments[0].shots[1].isHero).toBe(false);
      const allShots = result.data.apartments.flatMap((a) => a.shots);
      expect(allShots.length).toBe(12);
      expect(allShots.filter((s) => s.isHero).length).toBe(3);
    }
  });

  it("rejects shots at the BriefSpec top level (.strict catches the old flat shape)", () => {
    const result = BriefSpecSchema.safeParse({
      ...MINIMAL_BRIEF,
      shots: [{ shotIndex: 1 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("briefSpecJsonSchema — Anthropic tool input_schema", () => {
  it("emits a JSON Schema with type=object at the root", () => {
    const js = briefSpecJsonSchema();
    expect(js.type).toBe("object");
  });

  it("emits additionalProperties:false at the root (mirrors .strict)", () => {
    const js = briefSpecJsonSchema();
    expect(js.additionalProperties).toBe(false);
  });

  it("emits null-allowing types for nullable leaves", () => {
    const js = JSON.stringify(briefSpecJsonSchema());
    // At least one leaf must mention `"null"` in its allowed types.
    expect(js.includes('"null"')).toBe(true);
  });

  it("emits the full set of root-level required fields (Phase 3 nested shape — no top-level `shots`)", () => {
    const js = briefSpecJsonSchema() as { properties?: Record<string, unknown>; required?: string[] };
    expect(js.properties).toBeDefined();
    expect(js.properties && "baseline" in js.properties).toBe(true);
    expect(js.properties && "apartments" in js.properties).toBe(true);
    expect(js.properties && "referenceImageUrls" in js.properties).toBe(true);
    // Phase 3 invariant: no top-level shots field.
    expect(js.properties && "shots" in js.properties).toBe(false);
  });
});
