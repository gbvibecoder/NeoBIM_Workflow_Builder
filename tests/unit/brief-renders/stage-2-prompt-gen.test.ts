/**
 * Stage 2 — deterministic prompt generation tests.
 *
 * Covers:
 *   • Determinism (byte-identical output for same input)
 *   • Strict-faithfulness (null fields → omitted clauses)
 *   • Aspect-ratio fallback (sole non-content default, "3:2")
 *   • Hero badge inclusion
 *   • Bilingual: only roomNameEn surfaces in prompts
 *   • Length cap (PromptTooLongError)
 *   • Empty BriefSpec (EmptyBriefSpecError)
 *   • Marx12-shaped 12-shot output
 *   • No `recordCost` call (Stage 2 is free)
 *   • Logger lifecycle (startStage / endStage)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

import { BriefRenderLogger } from "@/features/brief-renders/services/brief-pipeline/logger";
import {
  runStage2PromptGen,
  EmptyBriefSpecError,
} from "@/features/brief-renders/services/brief-pipeline/stage-2-prompt-gen";
import {
  buildImagePrompt,
  PromptTooLongError,
  IMAGE_PROMPT_TEMPLATE_VERSION,
  DEFAULT_ASPECT_RATIO,
  MAX_PROMPT_CHARS,
} from "@/features/brief-renders/services/brief-pipeline/prompts/image-prompt-template";
import type {
  ApartmentSpec,
  BaselineSpec,
  BriefSpec,
  ShotSpec,
} from "@/features/brief-renders/services/brief-pipeline/types";

// ─── Fixtures ──────────────────────────────────────────────────────

const ALL_NULL_BASELINE: BaselineSpec = {
  visualStyle: null,
  materialPalette: null,
  lightingBaseline: null,
  cameraBaseline: null,
  qualityTarget: null,
  additionalNotes: null,
};

const ALL_NULL_APARTMENT_BASE: Omit<ApartmentSpec, "shots"> = {
  label: null,
  labelDe: null,
  totalAreaSqm: null,
  bedrooms: null,
  bathrooms: null,
  description: null,
};

const ALL_NULL_SHOT: ShotSpec = {
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

function buildMarxSpec(): BriefSpec {
  const shotBase: ShotSpec = {
    shotIndex: null,
    roomNameEn: "Open Kitchen-Dining",
    roomNameDe: "Kochen-Essen",
    areaSqm: 32.54,
    aspectRatio: "3:2",
    lightingDescription: "golden hour",
    cameraDescription: null,
    materialNotes: null,
    isHero: false,
  };
  const buildShots = () =>
    Array.from({ length: 4 }, (_, i) => ({
      ...shotBase,
      shotIndex: i + 1,
      isHero: i === 0,
      roomNameEn: i === 0 ? "Open Kitchen-Dining" : `Room ${i + 1}`,
    }));
  const apartmentBase: Omit<ApartmentSpec, "shots" | "label"> = {
    labelDe: null,
    totalAreaSqm: 95.4,
    bedrooms: 2,
    bathrooms: 1,
    description: null,
  };
  return {
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
    apartments: [
      { ...apartmentBase, label: "WE 01bb", shots: buildShots() },
      { ...apartmentBase, label: "WE 02ab", shots: buildShots() },
      { ...apartmentBase, label: "WE 03cc", shots: buildShots() },
    ],
    referenceImageUrls: [],
  };
}

function makeLogger() {
  return new BriefRenderLogger();
}

// ─── buildImagePrompt — leaf-level template tests ───────────────────

describe("buildImagePrompt", () => {
  it("strict faithfulness: all-null shot → no lighting / camera / materials clauses", () => {
    const built = buildImagePrompt({
      baseline: ALL_NULL_BASELINE,
      apartment: { ...ALL_NULL_APARTMENT_BASE, shots: [] },
      shot: ALL_NULL_SHOT,
    });
    expect(built.prompt.toLowerCase()).not.toContain("lighting");
    expect(built.prompt.toLowerCase()).not.toContain("camera");
    expect(built.prompt.toLowerCase()).not.toContain("materials");
    expect(built.prompt.toLowerCase()).not.toContain("baseline");
    expect(built.prompt.toLowerCase()).not.toContain("hero");
    // Closer is always present.
    expect(built.prompt).toContain("Editorial photography style");
  });

  it("strict faithfulness: empty baseline → no baseline clause", () => {
    const built = buildImagePrompt({
      baseline: ALL_NULL_BASELINE,
      apartment: { ...ALL_NULL_APARTMENT_BASE, label: "WE 01", shots: [] },
      shot: { ...ALL_NULL_SHOT, roomNameEn: "Living" },
    });
    expect(built.prompt).not.toContain("Baseline:");
  });

  it("aspect-ratio fallback: null aspectRatio → 3:2 (sole structural default)", () => {
    const built = buildImagePrompt({
      baseline: ALL_NULL_BASELINE,
      apartment: { ...ALL_NULL_APARTMENT_BASE, shots: [] },
      shot: { ...ALL_NULL_SHOT, aspectRatio: null, roomNameEn: "Living" },
    });
    expect(built.aspectRatio).toBe(DEFAULT_ASPECT_RATIO);
    expect(built.aspectRatio).toBe("3:2");
  });

  it("aspect-ratio: source-provided value preserved verbatim", () => {
    const built = buildImagePrompt({
      baseline: ALL_NULL_BASELINE,
      apartment: { ...ALL_NULL_APARTMENT_BASE, shots: [] },
      shot: { ...ALL_NULL_SHOT, aspectRatio: "16:9", roomNameEn: "Living" },
    });
    expect(built.aspectRatio).toBe("16:9");
  });

  it("hero true → prompt contains 'Hero shot of the apartment.'", () => {
    const built = buildImagePrompt({
      baseline: ALL_NULL_BASELINE,
      apartment: { ...ALL_NULL_APARTMENT_BASE, shots: [] },
      shot: { ...ALL_NULL_SHOT, roomNameEn: "Living", isHero: true },
    });
    expect(built.prompt).toContain("Hero shot of the apartment.");
  });

  it("hero false → prompt does NOT contain 'Hero shot'", () => {
    const built = buildImagePrompt({
      baseline: ALL_NULL_BASELINE,
      apartment: { ...ALL_NULL_APARTMENT_BASE, shots: [] },
      shot: { ...ALL_NULL_SHOT, roomNameEn: "Living", isHero: false },
    });
    expect(built.prompt).not.toContain("Hero shot");
  });

  it("bilingual: only roomNameEn surfaces in prompt; roomNameDe is for the PDF", () => {
    const built = buildImagePrompt({
      baseline: ALL_NULL_BASELINE,
      apartment: { ...ALL_NULL_APARTMENT_BASE, shots: [] },
      shot: {
        ...ALL_NULL_SHOT,
        roomNameEn: "Open Kitchen-Dining",
        roomNameDe: "Kochen-Essen",
      },
    });
    expect(built.prompt).toContain("Open Kitchen-Dining");
    expect(built.prompt).not.toContain("Kochen-Essen");
  });

  it("populated lighting → prompt contains 'Lighting:' verbatim", () => {
    const built = buildImagePrompt({
      baseline: ALL_NULL_BASELINE,
      apartment: { ...ALL_NULL_APARTMENT_BASE, shots: [] },
      shot: {
        ...ALL_NULL_SHOT,
        roomNameEn: "Living",
        lightingDescription: "golden hour, warm sunlight from west",
      },
    });
    expect(built.prompt).toContain(
      "Lighting: golden hour, warm sunlight from west.",
    );
  });

  it("template version stamp matches exported constant", () => {
    const built = buildImagePrompt({
      baseline: ALL_NULL_BASELINE,
      apartment: { ...ALL_NULL_APARTMENT_BASE, shots: [] },
      shot: { ...ALL_NULL_SHOT, roomNameEn: "Living" },
    });
    expect(built.templateVersion).toBe(IMAGE_PROMPT_TEMPLATE_VERSION);
  });

  it("no length cap is enforced — very long descriptions pass through verbatim", () => {
    // Phase 6 removed the artificial `PromptTooLongError` cap. The
    // strict-faithfulness contract requires we never truncate source
    // content; the only authoritative limit is the downstream
    // gpt-image-1.5 API itself, which surfaces its own error if the
    // prompt is too long for the model. Test fixture: 50k chars of
    // material notes — well past the soft observability threshold —
    // must NOT throw.
    const huge = "x".repeat(50_000);
    let built: ReturnType<typeof buildImagePrompt> | undefined;
    expect(() => {
      built = buildImagePrompt({
        baseline: ALL_NULL_BASELINE,
        apartment: { ...ALL_NULL_APARTMENT_BASE, shots: [] },
        shot: {
          ...ALL_NULL_SHOT,
          roomNameEn: "Living",
          materialNotes: huge,
        },
      });
    }).not.toThrow();
    expect(built).toBeDefined();
    // Source content is preserved verbatim — strict-faithfulness.
    expect(built!.prompt).toContain(huge);
    expect(built!.prompt.length).toBeGreaterThan(50_000);
  });

  it("the deprecated `PromptTooLongError` class is never thrown by buildImagePrompt", () => {
    // Backward-compat sentinel: the class still exports for any
    // legacy importer, but `buildImagePrompt` no longer uses it. If a
    // future change reintroduces the throw, this assertion will fail.
    expect(() =>
      buildImagePrompt({
        baseline: ALL_NULL_BASELINE,
        apartment: { ...ALL_NULL_APARTMENT_BASE, shots: [] },
        shot: {
          ...ALL_NULL_SHOT,
          roomNameEn: "Living",
          materialNotes: "y".repeat(MAX_PROMPT_CHARS + 1),
        },
      }),
    ).not.toThrow(PromptTooLongError);
  });
});

// ─── runStage2PromptGen — orchestrator-level tests ──────────────────

describe("runStage2PromptGen", () => {
  let logger: BriefRenderLogger;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("determinism: same input → byte-identical prompts (createdAt ignored)", () => {
    const spec = buildMarxSpec();
    const r1 = runStage2PromptGen({ spec, jobId: "j1", logger: makeLogger() });
    const r2 = runStage2PromptGen({ spec, jobId: "j2", logger: makeLogger() });

    // Compare prompt strings explicitly — they must be byte-identical.
    expect(r1.shots.length).toBe(r2.shots.length);
    for (let i = 0; i < r1.shots.length; i++) {
      expect(r1.shots[i].prompt).toBe(r2.shots[i].prompt);
      expect(r1.shots[i].aspectRatio).toBe(r2.shots[i].aspectRatio);
      expect(r1.shots[i].templateVersion).toBe(r2.shots[i].templateVersion);
    }

    // Hash the entire prompt-set for an extra-strict verification.
    const h1 = createHash("sha256")
      .update(r1.shots.map((s) => s.prompt).join(" "))
      .digest("hex");
    const h2 = createHash("sha256")
      .update(r2.shots.map((s) => s.prompt).join(" "))
      .digest("hex");
    expect(h1).toBe(h2);
  });

  it("Marx12: 3 apartments × 4 shots → 12 ShotResults with correct indices", () => {
    const spec = buildMarxSpec();
    const result = runStage2PromptGen({ spec, jobId: "j", logger });

    expect(result.totalApartments).toBe(3);
    expect(result.totalShots).toBe(12);
    expect(result.shots.length).toBe(12);

    // Global shotIndex 0..11
    expect(result.shots.map((s) => s.shotIndex)).toEqual(
      Array.from({ length: 12 }, (_, i) => i),
    );

    // Within each apartment, shotIndexInApartment cycles 0..3
    for (let apt = 0; apt < 3; apt++) {
      for (let inApt = 0; inApt < 4; inApt++) {
        const s = result.shots[apt * 4 + inApt];
        expect(s.apartmentIndex).toBe(apt);
        expect(s.shotIndexInApartment).toBe(inApt);
      }
    }
  });

  it("Marx12 hero distribution: shot 0 of each apartment is hero", () => {
    const spec = buildMarxSpec();
    const result = runStage2PromptGen({ spec, jobId: "j", logger });

    // Apartment 0 shot 0 → hero; shot 1 → not.
    expect(result.shots[0].prompt).toContain("Hero shot of the apartment.");
    expect(result.shots[1].prompt).not.toContain("Hero shot");
    expect(result.shots[4].prompt).toContain("Hero shot of the apartment.");
    expect(result.shots[8].prompt).toContain("Hero shot of the apartment.");
  });

  it("ShotResult initial state: pending, no imageUrl, no error", () => {
    const spec = buildMarxSpec();
    const result = runStage2PromptGen({ spec, jobId: "j", logger });
    for (const shot of result.shots) {
      expect(shot.status).toBe("pending");
      expect(shot.imageUrl).toBeNull();
      expect(shot.errorMessage).toBeNull();
      expect(shot.costUsd).toBeNull();
      expect(shot.startedAt).toBeNull();
      expect(shot.completedAt).toBeNull();
      expect(shot.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(shot.prompt.length).toBeGreaterThan(0);
    }
  });

  it("single apartment, single shot → 1 ShotResult, shotIndex=0", () => {
    const spec: BriefSpec = {
      projectTitle: null,
      projectLocation: null,
      projectType: null,
      baseline: ALL_NULL_BASELINE,
      apartments: [
        {
          ...ALL_NULL_APARTMENT_BASE,
          label: "WE 01",
          shots: [{ ...ALL_NULL_SHOT, roomNameEn: "Living" }],
        },
      ],
      referenceImageUrls: [],
    };
    const result = runStage2PromptGen({ spec, jobId: "j", logger });
    expect(result.shots.length).toBe(1);
    expect(result.shots[0].shotIndex).toBe(0);
    expect(result.shots[0].apartmentIndex).toBe(0);
    expect(result.shots[0].shotIndexInApartment).toBe(0);
  });

  it("empty BriefSpec (zero apartments) → throws EmptyBriefSpecError", () => {
    const spec: BriefSpec = {
      projectTitle: null,
      projectLocation: null,
      projectType: null,
      baseline: ALL_NULL_BASELINE,
      apartments: [],
      referenceImageUrls: [],
    };
    expect(() => runStage2PromptGen({ spec, jobId: "j", logger })).toThrow(
      EmptyBriefSpecError,
    );
  });

  it("apartments with no shots → throws EmptyBriefSpecError", () => {
    const spec: BriefSpec = {
      projectTitle: null,
      projectLocation: null,
      projectType: null,
      baseline: ALL_NULL_BASELINE,
      apartments: [
        { ...ALL_NULL_APARTMENT_BASE, label: "WE 01", shots: [] },
        { ...ALL_NULL_APARTMENT_BASE, label: "WE 02", shots: [] },
      ],
      referenceImageUrls: [],
    };
    expect(() => runStage2PromptGen({ spec, jobId: "j", logger })).toThrow(
      EmptyBriefSpecError,
    );
  });

  it("does NOT call logger.recordCost (Stage 2 is free)", () => {
    const spec = buildMarxSpec();
    const recordCostSpy = vi.spyOn(logger, "recordCost");
    runStage2PromptGen({ spec, jobId: "j", logger });
    expect(recordCostSpy).not.toHaveBeenCalled();
  });

  it("logger lifecycle: startStage(2, 'Prompt Gen') → endStage(2, 'success', summary)", () => {
    const spec = buildMarxSpec();
    const startSpy = vi.spyOn(logger, "startStage");
    const endSpy = vi.spyOn(logger, "endStage");
    runStage2PromptGen({ spec, jobId: "j", logger });

    expect(startSpy).toHaveBeenCalledWith(2, "Prompt Gen");
    expect(endSpy).toHaveBeenCalledWith(
      2,
      "success",
      expect.objectContaining({ totalShots: 12, totalApartments: 3 }),
    );
  });

  it("logger lifecycle: startStage → endStage('failed') on EmptyBriefSpecError", () => {
    const spec: BriefSpec = {
      projectTitle: null,
      projectLocation: null,
      projectType: null,
      baseline: ALL_NULL_BASELINE,
      apartments: [],
      referenceImageUrls: [],
    };
    const endSpy = vi.spyOn(logger, "endStage");
    expect(() => runStage2PromptGen({ spec, jobId: "j", logger })).toThrow();
    expect(endSpy).toHaveBeenCalledWith(2, "failed", undefined, expect.any(String));
  });

  it("ShotResults share a single createdAt across the same Stage 2 run", () => {
    // Property: every ShotResult in a single runStage2PromptGen invocation
    // shares the same `createdAt` (we capture the timestamp once at stage
    // entry, not per-shot). Cleaner timeline for the UI.
    const spec = buildMarxSpec();
    const result = runStage2PromptGen({ spec, jobId: "j", logger });
    const seen = new Set(result.shots.map((s) => s.createdAt));
    expect(seen.size).toBe(1);
  });

  it("preserves apartment-shot ordering exactly (no sorting / reordering)", () => {
    const spec = buildMarxSpec();
    // Swap apartment 0 and 1 to make sure the output mirrors input order.
    spec.apartments = [spec.apartments[1], spec.apartments[0], spec.apartments[2]];
    const result = runStage2PromptGen({ spec, jobId: "j", logger });
    expect(result.shots[0].prompt).toContain("WE 02ab");
    expect(result.shots[4].prompt).toContain("WE 01bb");
  });
});
