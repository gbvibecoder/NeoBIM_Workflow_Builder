/**
 * Phase 2.3 Workstream B — Review modal intelligence upgrades.
 *
 * Covers:
 *  - Deterministic facing correction when prompt is explicit
 *  - Ensuite-aware bathroom auto-add (master_bathroom + common)
 *  - Vastu-aware pooja pre-selection
 *  - BHK-to-bathroom count inference
 */

import { describe, it, expect, vi } from "vitest";

// Route.ts pulls in NextAuth at module load. Stub it + its transitive deps
// so we can test the pure helper functions without a browser env.
vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/user-errors", () => ({
  formatErrorResponse: vi.fn((e) => ({ error: e })),
  UserErrors: { UNAUTHORIZED: { code: "AUTH_001", message: "Unauthorized" } },
}));
vi.mock("@/features/floor-plan/lib/structured-parser", async () => {
  const actual = await vi.importActual("@/features/floor-plan/lib/structured-parser");
  return { ...actual, parseConstraints: vi.fn() };
});

import {
  correctFacingIfPromptExplicit,
  buildValidation,
} from "@/app/api/validate-floor-plan/route";
import type { ParsedConstraints } from "@/features/floor-plan/lib/structured-parser";

// ─── correctFacingIfPromptExplicit ───────────────────────────────

describe("Phase 2.3 — correctFacingIfPromptExplicit", () => {
  it("overrides LLM 'E' when prompt says 'north facing'", () => {
    const result = correctFacingIfPromptExplicit("E", "3BHK 40x40 north facing vastu pooja");
    expect(result.overridden).toBe(true);
    expect(result.facing).toBe("N");
  });

  it("does not override when LLM already matches prompt", () => {
    const result = correctFacingIfPromptExplicit("N", "north facing plot");
    expect(result.overridden).toBe(false);
    expect(result.facing).toBe("N");
  });

  it("handles hyphenated 'north-facing'", () => {
    const result = correctFacingIfPromptExplicit(null, "north-facing 2BHK");
    expect(result.overridden).toBe(true);
    expect(result.facing).toBe("N");
  });

  it("handles intercardinal NE", () => {
    const result = correctFacingIfPromptExplicit("E", "northeast facing duplex");
    expect(result.overridden).toBe(true);
    expect(result.facing).toBe("NE");
  });

  it("returns parsed value unchanged when prompt has no facing phrase", () => {
    const result = correctFacingIfPromptExplicit("W", "3BHK 40x40 vastu");
    expect(result.overridden).toBe(false);
    expect(result.facing).toBe("W");
  });

  it("south-facing is detected", () => {
    const result = correctFacingIfPromptExplicit("N", "south-facing villa");
    expect(result.overridden).toBe(true);
    expect(result.facing).toBe("S");
  });
});

// ─── buildValidation — ensuite + pooja + facing logic ─────────────

function stubParsed(overrides: Partial<ParsedConstraints> = {}): ParsedConstraints {
  return {
    plot: {
      width_ft: 40,
      depth_ft: 40,
      total_built_up_sqft: 1600,
      facing: "N",
    },
    rooms: [],
    adjacency_pairs: [],
    vastu_required: false,
    special_features: [],
    ...overrides,
  } as unknown as ParsedConstraints;
}

describe("Phase 2.3 — buildValidation ensuite + pooja logic", () => {
  it("adds Master Bathroom (ensuite) + common Bathroom when 3BHK with master has no baths", () => {
    const parsed = stubParsed({
      rooms: [
        { name: "Master Bedroom", function: "master_bedroom", dim_width_ft: 14, dim_depth_ft: 12, is_circulation: false },
        { name: "Bedroom 2",      function: "bedroom",        dim_width_ft: 12, dim_depth_ft: 10, is_circulation: false },
        { name: "Bedroom 3",      function: "bedroom",        dim_width_ft: 12, dim_depth_ft: 10, is_circulation: false },
        { name: "Kitchen",        function: "kitchen",        dim_width_ft: 10, dim_depth_ft: 8,  is_circulation: false },
      ],
    } as unknown as Partial<ParsedConstraints>);

    const result = buildValidation(parsed, "3BHK 40x40 north facing");
    const hasMasterBath = result.understood.rooms.some((r) => r.type === "master_bathroom" && r.name === "Master Bathroom");
    const hasCommonBath = result.understood.rooms.some((r) => r.type === "bathroom");
    expect(hasMasterBath).toBe(true);
    expect(hasCommonBath).toBe(true);

    const masterBathAdj = result.adjustments.find((a) => a.room_name === "Master Bathroom");
    expect(masterBathAdj).toBeTruthy();
    expect(masterBathAdj?.reason).toMatch(/ensuite/i);
  });

  it("adds only a common bathroom when no master bedroom (1BHK)", () => {
    const parsed = stubParsed({
      rooms: [
        { name: "Bedroom", function: "bedroom", dim_width_ft: 12, dim_depth_ft: 10, is_circulation: false },
        { name: "Kitchen", function: "kitchen", dim_width_ft: 10, dim_depth_ft: 8, is_circulation: false },
      ],
    } as unknown as Partial<ParsedConstraints>);

    const result = buildValidation(parsed, "1BHK 25x22");
    const hasMasterBath = result.understood.rooms.some((r) => r.type === "master_bathroom");
    const hasCommonBath = result.understood.rooms.some((r) => r.type === "bathroom");
    expect(hasMasterBath).toBe(false);
    expect(hasCommonBath).toBe(true);
  });

  it("pre-checks Pooja Room when vastu is required", () => {
    const parsed = stubParsed({
      rooms: [
        { name: "Master Bedroom", function: "master_bedroom", dim_width_ft: 14, dim_depth_ft: 12, is_circulation: false },
        { name: "Bedroom 2", function: "bedroom", dim_width_ft: 12, dim_depth_ft: 10, is_circulation: false },
        { name: "Bedroom 3", function: "bedroom", dim_width_ft: 12, dim_depth_ft: 10, is_circulation: false },
        { name: "Kitchen", function: "kitchen", dim_width_ft: 10, dim_depth_ft: 8, is_circulation: false },
        { name: "Living Room", function: "living", dim_width_ft: 16, dim_depth_ft: 14, is_circulation: false },
      ],
      vastu_required: true,
    } as unknown as Partial<ParsedConstraints>);

    const result = buildValidation(parsed, "3BHK 40x40 north facing vastu");
    const pooja = result.optional_rooms.find((o) => o.type === "pooja");
    expect(pooja).toBeTruthy();
    expect(pooja?.checked_by_default).toBe(true);
    expect(pooja?.description).toMatch(/vastu/i);
  });

  it("pre-checks Pooja Room when prompt mentions 'pooja' even without vastu flag", () => {
    const parsed = stubParsed({
      rooms: [
        { name: "Master Bedroom", function: "master_bedroom", dim_width_ft: 14, dim_depth_ft: 12, is_circulation: false },
        { name: "Bedroom 2", function: "bedroom", dim_width_ft: 12, dim_depth_ft: 10, is_circulation: false },
        { name: "Bedroom 3", function: "bedroom", dim_width_ft: 12, dim_depth_ft: 10, is_circulation: false },
        { name: "Kitchen", function: "kitchen", dim_width_ft: 10, dim_depth_ft: 8, is_circulation: false },
        { name: "Living Room", function: "living", dim_width_ft: 16, dim_depth_ft: 14, is_circulation: false },
      ],
      vastu_required: false,
    } as unknown as Partial<ParsedConstraints>);

    const result = buildValidation(parsed, "3BHK 40x40 east facing with pooja room");
    const pooja = result.optional_rooms.find((o) => o.type === "pooja");
    expect(pooja).toBeTruthy();
    expect(pooja?.checked_by_default).toBe(true);
  });

  it("flags FACING_CORRECTED when parser's facing disagrees with explicit prompt text", () => {
    const parsed = stubParsed({
      plot: { width_ft: 40, depth_ft: 40, total_built_up_sqft: 1600, facing: "E" },
      rooms: [
        { name: "Master Bedroom", function: "master_bedroom", dim_width_ft: 14, dim_depth_ft: 12, is_circulation: false },
        { name: "Kitchen", function: "kitchen", dim_width_ft: 10, dim_depth_ft: 8, is_circulation: false },
      ],
    } as unknown as Partial<ParsedConstraints>);

    const result = buildValidation(parsed, "3BHK 40x40 north facing vastu pooja room");
    const facingIssue = result.issues.find((i) => i.type === "FACING_CORRECTED");
    expect(facingIssue).toBeTruthy();
    expect(parsed.plot.facing).toBe("N");
  });
});
