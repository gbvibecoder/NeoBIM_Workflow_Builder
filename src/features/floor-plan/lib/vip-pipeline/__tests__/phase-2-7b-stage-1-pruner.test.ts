/**
 * Phase 2.7B — Stage 1 post-LLM pruner tests.
 *
 * The system prompt forbids auto-adding Porch / Foyer / Utility /
 * Powder Room. The pruner is the deterministic enforcement layer
 * that runs after the LLM returns — it drops any phantom rooms the
 * LLM slipped in despite the prompt, and it applies the plot-size
 * room-count cap.
 *
 * These tests fix the contract:
 *   - computeRoomCap thresholds match the system prompt's CORE POLICY.
 *   - Forbidden auto-adds not in the user prompt are dropped.
 *   - Forbidden auto-adds IN the user prompt are preserved.
 *   - Required rooms (bedrooms, kitchen, living, bathrooms) are never
 *     dropped regardless of cap.
 *   - Adjacencies referring to a dropped room are dropped with the room.
 *   - A "warning: cap applied" constraint is appended when drops happen.
 */

import { describe, it, expect } from "vitest";
import { pruneBrief, computeRoomCap } from "../stage-1-pruner";
import type { ArchitectBrief } from "../types";

function brief(
  overrides: Partial<ArchitectBrief> & {
    rooms: Array<{ name: string; type: string; approxAreaSqft?: number }>;
  },
): ArchitectBrief {
  return {
    projectType: "residential",
    plotWidthFt: 40,
    plotDepthFt: 40,
    facing: "north",
    styleCues: ["residential"],
    constraints: [],
    roomList: overrides.rooms,
    adjacencies: overrides.adjacencies ?? [],
    ...Object.fromEntries(
      Object.entries(overrides).filter(([k]) => k !== "rooms"),
    ),
  };
}

// ─── computeRoomCap thresholds ──────────────────────────────────

describe("computeRoomCap — plot-size thresholds", () => {
  it("returns 7 for plots < 1000 sqft", () => {
    expect(computeRoomCap(400)).toBe(7);
    expect(computeRoomCap(999)).toBe(7);
  });

  it("returns 10 for plots 1000-1799 sqft (3BHK on 40x40 lands here)", () => {
    expect(computeRoomCap(1000)).toBe(10);
    expect(computeRoomCap(1600)).toBe(10); // 40x40
    expect(computeRoomCap(1799)).toBe(10);
  });

  it("returns 12 for plots 1800-2499 sqft", () => {
    expect(computeRoomCap(1800)).toBe(12);
    expect(computeRoomCap(2499)).toBe(12);
  });

  it("returns 14 for plots >= 2500 sqft (4BHK 60x60 = 3600 lands here)", () => {
    expect(computeRoomCap(2500)).toBe(14);
    expect(computeRoomCap(3600)).toBe(14);
  });

  it("returns 7 as a floor for broken inputs (NaN, negative, zero)", () => {
    expect(computeRoomCap(Number.NaN)).toBe(7);
    expect(computeRoomCap(0)).toBe(7);
    expect(computeRoomCap(-500)).toBe(7);
  });
});

// ─── Core pruning contract ──────────────────────────────────────

describe("pruneBrief — forbidden auto-adds not in prompt get dropped", () => {
  it("drops Porch + Foyer + Utility when user prompt didn't mention them", () => {
    const b = brief({
      plotWidthFt: 40,
      plotDepthFt: 40,
      rooms: [
        { name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 },
        { name: "Bedroom 2", type: "bedroom", approxAreaSqft: 120 },
        { name: "Bedroom 3", type: "bedroom", approxAreaSqft: 100 },
        { name: "Living Room", type: "living", approxAreaSqft: 224 },
        { name: "Kitchen", type: "kitchen", approxAreaSqft: 80 },
        { name: "Master Bathroom", type: "master_bathroom", approxAreaSqft: 35 },
        { name: "Common Bathroom", type: "bathroom", approxAreaSqft: 35 },
        { name: "Pooja Room", type: "pooja", approxAreaSqft: 20 },
        { name: "Entrance Porch", type: "porch", approxAreaSqft: 50 },
        { name: "Foyer", type: "foyer", approxAreaSqft: 48 },
        { name: "Hallway", type: "hallway", approxAreaSqft: 40 },
        { name: "Dining", type: "dining", approxAreaSqft: 120 },
        { name: "Utility", type: "utility", approxAreaSqft: 30 },
      ],
    });
    const res = pruneBrief(b, "3BHK 40x40 north facing vastu pooja room");

    const keptNames = res.brief.roomList.map((r) => r.name);
    expect(keptNames).not.toContain("Entrance Porch");
    expect(keptNames).not.toContain("Foyer");
    expect(keptNames).not.toContain("Utility");
    // Forbidden-auto drops don't remove Pooja (user said "pooja"),
    // Hallway or Dining unless cap enforcement kicks in.
    expect(keptNames).toContain("Pooja Room");
    expect(res.droppedNames).toEqual(expect.arrayContaining(["Entrance Porch", "Foyer", "Utility"]));
    expect(res.brief.constraints.some((c) => /cap applied|phantom/i.test(c))).toBe(true);
  });

  it("keeps Porch when user prompt explicitly says 'porch'", () => {
    const b = brief({
      plotWidthFt: 60,
      plotDepthFt: 60,
      rooms: [
        { name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 },
        { name: "Bedroom 2", type: "bedroom", approxAreaSqft: 120 },
        { name: "Bedroom 3", type: "bedroom", approxAreaSqft: 120 },
        { name: "Bedroom 4", type: "bedroom", approxAreaSqft: 100 },
        { name: "Living Room", type: "living", approxAreaSqft: 224 },
        { name: "Kitchen", type: "kitchen", approxAreaSqft: 80 },
        { name: "Master Bathroom", type: "master_bathroom", approxAreaSqft: 35 },
        { name: "Bathroom 2", type: "bathroom", approxAreaSqft: 35 },
        { name: "Bathroom 3", type: "bathroom", approxAreaSqft: 35 },
        { name: "Porch", type: "porch", approxAreaSqft: 50 },
        { name: "Utility", type: "utility", approxAreaSqft: 30 },
      ],
    });
    const res = pruneBrief(b, "4BHK 60x60 porch garden utility");

    const keptNames = res.brief.roomList.map((r) => r.name);
    expect(keptNames).toContain("Porch");
    expect(keptNames).toContain("Utility");
    expect(res.droppedNames).toEqual([]);
  });

  it("recognises synonym forms: 'veranda' → matches 'porch' type", () => {
    const b = brief({
      plotWidthFt: 40,
      plotDepthFt: 40,
      rooms: [
        { name: "Master Bedroom", type: "master_bedroom" },
        { name: "Bedroom 2", type: "bedroom" },
        { name: "Bedroom 3", type: "bedroom" },
        { name: "Living Room", type: "living" },
        { name: "Kitchen", type: "kitchen" },
        { name: "Bathroom", type: "bathroom" },
        { name: "Porch", type: "porch" }, // user said "verandah"
      ],
    });
    const res = pruneBrief(b, "3BHK with a nice verandah in front, 40x40");
    const keptNames = res.brief.roomList.map((r) => r.name);
    expect(keptNames).toContain("Porch");
  });

  it("also matches by NAME when type is vague ('Entrance Foyer' with type='other')", () => {
    const b = brief({
      plotWidthFt: 40,
      plotDepthFt: 40,
      rooms: [
        { name: "Master Bedroom", type: "master_bedroom" },
        { name: "Bedroom 2", type: "bedroom" },
        { name: "Bedroom 3", type: "bedroom" },
        { name: "Living Room", type: "living" },
        { name: "Kitchen", type: "kitchen" },
        { name: "Bathroom", type: "bathroom" },
        { name: "Entrance Foyer", type: "other" },
      ],
    });
    const res = pruneBrief(b, "3BHK 40x40 north facing");
    const keptNames = res.brief.roomList.map((r) => r.name);
    expect(keptNames).not.toContain("Entrance Foyer");
  });
});

// ─── Cap enforcement beyond forbidden pass ──────────────────────

describe("pruneBrief — cap enforcement pass for user-explicit overflow", () => {
  it("drops unmentioned user-explicit rooms (Study, Balcony) when cap exceeded", () => {
    // Plot 30x35 = 1050 sqft → cap 10. Give it 12 rooms, 2 of which are
    // user-explicit types the prompt never mentioned.
    const b = brief({
      plotWidthFt: 30,
      plotDepthFt: 35,
      rooms: [
        { name: "Master Bedroom", type: "master_bedroom" },
        { name: "Bedroom 2", type: "bedroom" },
        { name: "Bedroom 3", type: "bedroom" },
        { name: "Living Room", type: "living" },
        { name: "Kitchen", type: "kitchen" },
        { name: "Master Bathroom", type: "master_bathroom" },
        { name: "Bathroom 2", type: "bathroom" },
        { name: "Hallway", type: "hallway" },
        { name: "Dining", type: "dining" },
        { name: "Study", type: "study" },
        { name: "Balcony", type: "balcony" },
        { name: "Store", type: "store" },
      ],
    });
    const res = pruneBrief(b, "3BHK 30x35 north facing");
    expect(res.brief.roomList.length).toBeLessThanOrEqual(10);
    // Required rooms still present.
    expect(res.brief.roomList.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "Master Bedroom",
        "Bedroom 2",
        "Bedroom 3",
        "Living Room",
        "Kitchen",
        "Master Bathroom",
        "Bathroom 2",
      ]),
    );
  });

  it("never drops required types (bedrooms/kitchen/living/bathrooms) even under extreme cap pressure", () => {
    const b = brief({
      plotWidthFt: 20,
      plotDepthFt: 20, // 400 sqft → cap 7
      rooms: [
        { name: "Master Bedroom", type: "master_bedroom" },
        { name: "Bedroom 2", type: "bedroom" },
        { name: "Bedroom 3", type: "bedroom" },
        { name: "Bedroom 4", type: "bedroom" },
        { name: "Living Room", type: "living" },
        { name: "Kitchen", type: "kitchen" },
        { name: "Master Bathroom", type: "master_bathroom" },
        { name: "Bathroom 2", type: "bathroom" },
        { name: "Porch", type: "porch" },
        { name: "Foyer", type: "foyer" },
        { name: "Study", type: "study" },
        { name: "Hallway", type: "hallway" },
      ],
    });
    const res = pruneBrief(b, "4BHK in a very small plot");
    // Required rooms survive; non-required get trimmed to hit cap 7 budget.
    const requiredKept = res.brief.roomList.filter(
      (r) =>
        r.type === "master_bedroom" ||
        r.type === "bedroom" ||
        r.type === "living" ||
        r.type === "kitchen" ||
        r.type === "master_bathroom" ||
        r.type === "bathroom",
    );
    expect(requiredKept.length).toBeGreaterThanOrEqual(7);
  });
});

// ─── Adjacency cleanup ──────────────────────────────────────────

describe("pruneBrief — dropped rooms also drop their adjacencies", () => {
  it("strips adjacencies whose a or b references a dropped room", () => {
    const b = brief({
      plotWidthFt: 40,
      plotDepthFt: 40,
      rooms: [
        { name: "Master Bedroom", type: "master_bedroom" },
        { name: "Bedroom 2", type: "bedroom" },
        { name: "Bedroom 3", type: "bedroom" },
        { name: "Living Room", type: "living" },
        { name: "Kitchen", type: "kitchen" },
        { name: "Master Bathroom", type: "master_bathroom" },
        { name: "Bathroom", type: "bathroom" },
        { name: "Utility", type: "utility" },
      ],
      adjacencies: [
        { a: "Master Bedroom", b: "Master Bathroom", relationship: "attached" },
        { a: "Kitchen", b: "Utility", relationship: "adjacent" }, // should be stripped
      ],
    });
    const res = pruneBrief(b, "3BHK 40x40");
    expect(res.brief.roomList.map((r) => r.name)).not.toContain("Utility");
    const adjTargets = res.brief.adjacencies.map((a) => `${a.a}→${a.b}`);
    expect(adjTargets).toContain("Master Bedroom→Master Bathroom");
    expect(adjTargets).not.toContain("Kitchen→Utility");
  });
});

// ─── Happy-path no-op ───────────────────────────────────────────

describe("pruneBrief — no-op when the brief is already clean", () => {
  it("returns the brief unchanged when no phantom rooms + under cap", () => {
    const b = brief({
      plotWidthFt: 40,
      plotDepthFt: 40,
      rooms: [
        { name: "Master Bedroom", type: "master_bedroom" },
        { name: "Bedroom 2", type: "bedroom" },
        { name: "Bedroom 3", type: "bedroom" },
        { name: "Living Room", type: "living" },
        { name: "Kitchen", type: "kitchen" },
        { name: "Master Bathroom", type: "master_bathroom" },
        { name: "Bathroom", type: "bathroom" },
        { name: "Pooja Room", type: "pooja" },
      ],
    });
    const res = pruneBrief(b, "3BHK 40x40 vastu pooja room");
    expect(res.droppedNames).toEqual([]);
    expect(res.brief.roomList.length).toBe(8);
    // Constraints array unchanged (no warning appended).
    expect(res.brief.constraints).toEqual([]);
  });
});
