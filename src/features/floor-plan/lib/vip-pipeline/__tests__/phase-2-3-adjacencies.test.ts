/**
 * Phase 2.3 Workstream A — Adjacency schema + Stage 5 compliance evaluation.
 */

import { describe, it, expect } from "vitest";
import { Stage1OutputSchema, Stage6RawOutputSchema } from "@/features/floor-plan/lib/vip-pipeline/schemas";
import { evaluateAdjacencies } from "@/features/floor-plan/lib/vip-pipeline/stage-5-synthesis";
import type { AdjacencyDeclaration } from "@/features/floor-plan/lib/vip-pipeline/types";

// ─── Stage 1 schema — adjacencies field ──────────────────────────

describe("Phase 2.3 — Stage 1 adjacencies schema", () => {
  const validBriefBase = {
    brief: {
      projectType: "villa",
      roomList: [{ name: "Master Bedroom", type: "master_bedroom", approxAreaSqft: 168 }],
      plotWidthFt: 40,
      plotDepthFt: 40,
      facing: "north",
      styleCues: ["vastu"],
      constraints: [],
    },
    imagePrompts: [{ model: "gpt-image-1.5", prompt: "x", styleGuide: "y" }],
  };

  it("accepts adjacencies with valid relationships", () => {
    const input = {
      ...validBriefBase,
      brief: {
        ...validBriefBase.brief,
        adjacencies: [
          { a: "Master Bedroom", b: "Master Bathroom", relationship: "attached" },
          { a: "Kitchen", b: "Dining", relationship: "adjacent", reason: "food flow" },
        ],
      },
    };
    const result = Stage1OutputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects wrong-enum relationship", () => {
    const input = {
      ...validBriefBase,
      brief: {
        ...validBriefBase.brief,
        adjacencies: [{ a: "A", b: "B", relationship: "random-bad-value" }],
      },
    };
    const result = Stage1OutputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing required field 'a'", () => {
    const input = {
      ...validBriefBase,
      brief: {
        ...validBriefBase.brief,
        adjacencies: [{ b: "B", relationship: "attached" }],
      },
    };
    const result = Stage1OutputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("defaults adjacencies to [] when omitted", () => {
    // Intentionally omit the adjacencies field — z.default([]) should supply it.
    const result = Stage1OutputSchema.safeParse(validBriefBase);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.brief.adjacencies).toEqual([]);
  });

  it("accepts all four relationship enum values", () => {
    const input = {
      ...validBriefBase,
      brief: {
        ...validBriefBase.brief,
        adjacencies: [
          { a: "A", b: "B", relationship: "attached" },
          { a: "A", b: "C", relationship: "adjacent" },
          { a: "A", b: "D", relationship: "direct-access" },
          { a: "A", b: "E", relationship: "connected" },
        ],
      },
    };
    const result = Stage1OutputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

// ─── Stage 6 schema — adjacencyCompliance dimension ──────────────

describe("Phase 2.3 — Stage 6 adjacencyCompliance dimension", () => {
  const baseDims = {
    roomCountMatch: 8,
    noDuplicateNames: 10,
    dimensionPlausibility: 7,
    vastuCompliance: 8,
    orientationCorrect: 9,
    connectivity: 7,
    exteriorWindows: 8,
  };

  it("accepts a verdict with adjacencyCompliance", () => {
    const input = {
      dimensions: { ...baseDims, adjacencyCompliance: 9 },
      reasoning: "all adjacencies satisfied",
    };
    expect(Stage6RawOutputSchema.safeParse(input).success).toBe(true);
  });

  it("defaults adjacencyCompliance to 8 when the LLM omits it (backward compat)", () => {
    // Older LLM responses with the 7-dim schema shouldn't crash after upgrade.
    const input = {
      dimensions: baseDims,
      reasoning: "pre-2.3 model output",
    };
    const result = Stage6RawOutputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dimensions.adjacencyCompliance).toBe(8);
  });
});

// ─── Stage 5 evaluateAdjacencies — compliance engine ─────────────

describe("Phase 2.3 — Stage 5 evaluateAdjacencies()", () => {
  const rooms = [
    { id: "r1", name: "Master Bedroom", type: "master_bedroom" },
    { id: "r2", name: "Master Bathroom", type: "master_bathroom" },
    { id: "r3", name: "Kitchen", type: "kitchen" },
    { id: "r4", name: "Dining", type: "dining" },
    { id: "r5", name: "Living Room", type: "living" },
    { id: "r6", name: "Pooja Room", type: "pooja" },
  ];

  // Walls: r1↔r2 share a wall; r3↔r4 share a wall. r5↔r6 do NOT share a wall.
  const walls = [
    { room_ids: ["r1", "r2"] },
    { room_ids: ["r3", "r4"] },
    { room_ids: ["r1"] }, // r1 exterior wall
    { room_ids: ["r5"] }, // r5 exterior wall
  ];

  // Doors: r1↔r2 has a door. r5↔r6 has a door.
  const doors = [
    { between: ["r1", "r2"] },
    { between: ["r5", "r6"] },
  ];

  it("marks an 'attached' relationship satisfied when wall + door both exist", () => {
    const decls: AdjacencyDeclaration[] = [
      { a: "Master Bedroom", b: "Master Bathroom", relationship: "attached" },
    ];
    const report = evaluateAdjacencies(decls, rooms, walls, doors);
    expect(report.declared).toBe(1);
    expect(report.satisfied).toBe(1);
    expect(report.violated).toBe(0);
    expect(report.compliancePct).toBe(100);
    expect(report.checks[0].status).toBe("satisfied");
  });

  it("marks an 'adjacent' relationship violated when rooms don't share a wall", () => {
    const decls: AdjacencyDeclaration[] = [
      { a: "Living Room", b: "Pooja Room", relationship: "adjacent" },
    ];
    const report = evaluateAdjacencies(decls, rooms, walls, doors);
    expect(report.violated).toBe(1);
    expect(report.satisfied).toBe(0);
    expect(report.checks[0].status).toBe("violated");
    expect(report.checks[0].note).toContain("no shared wall");
  });

  it("marks 'direct-access' satisfied when a direct door exists", () => {
    const decls: AdjacencyDeclaration[] = [
      { a: "Living Room", b: "Pooja Room", relationship: "direct-access" },
    ];
    const report = evaluateAdjacencies(decls, rooms, walls, doors);
    expect(report.satisfied).toBe(1);
    expect(report.checks[0].status).toBe("satisfied");
  });

  it("marks 'connected' as unknown when no direct door (corridor reachability not resolved)", () => {
    const decls: AdjacencyDeclaration[] = [
      { a: "Kitchen", b: "Pooja Room", relationship: "connected" },
    ];
    const report = evaluateAdjacencies(decls, rooms, walls, doors);
    expect(report.checks[0].status).toBe("unknown");
  });

  it("marks room-not-found as 'unknown' without crashing", () => {
    const decls: AdjacencyDeclaration[] = [
      { a: "Nonexistent Room", b: "Master Bathroom", relationship: "attached" },
    ];
    const report = evaluateAdjacencies(decls, rooms, walls, doors);
    expect(report.checks[0].status).toBe("unknown");
    expect(report.checks[0].note).toMatch(/not found|missing/i);
  });

  it("compliancePct = 100 when no adjacencies declared (vacuously compliant)", () => {
    const report = evaluateAdjacencies([], rooms, walls, doors);
    expect(report.declared).toBe(0);
    expect(report.compliancePct).toBe(100);
  });

  it("handles a mix of satisfied + violated across multiple declarations", () => {
    const decls: AdjacencyDeclaration[] = [
      { a: "Master Bedroom", b: "Master Bathroom", relationship: "attached" }, // satisfied
      { a: "Kitchen", b: "Dining", relationship: "adjacent" },                 // satisfied (wall)
      { a: "Living Room", b: "Pooja Room", relationship: "adjacent" },         // violated
    ];
    const report = evaluateAdjacencies(decls, rooms, walls, doors);
    expect(report.declared).toBe(3);
    expect(report.satisfied).toBe(2);
    expect(report.violated).toBe(1);
    expect(report.compliancePct).toBe(Math.round((2 / 3) * 100));
  });
});
