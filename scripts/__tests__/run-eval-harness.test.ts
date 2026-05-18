/**
 * Tests for the eval harness's detectOverreach function.
 *
 * Validates that overreach detection correctly flags elements in the spec
 * that the brief didn't mention — the faithfulness quality gate.
 */

import { describe, expect, it } from "vitest";

import { detectOverreach } from "../run-eval-harness";

describe("detectOverreach", () => {
  it("flags reception desk when brief has none", () => {
    const brief = "10x4m office, 4 walls, 1 door.";
    const spec = {
      elements: [],
      furniture: [
        { type: "reception desk", description: "Reception desk near entry" },
      ],
      spaces: [],
      lighting: {},
    };
    const flags = detectOverreach(brief, spec);
    expect(flags).toContain("reception");
  });

  it("does not flag reception when brief mentions it", () => {
    const brief = "Small office with a reception desk near the entrance.";
    const spec = {
      elements: [],
      furniture: [
        { type: "reception desk", description: "Reception at entry" },
      ],
      spaces: [],
      lighting: {},
    };
    const flags = detectOverreach(brief, spec);
    expect(flags).not.toContain("reception");
  });

  it("flags ceiling fan when brief is silent about fans", () => {
    const brief = "Small classroom, 30 students, whiteboard.";
    const spec = {
      elements: [],
      furniture: [
        { type: "ceiling fan", description: "Ceiling fan" },
      ],
      spaces: [{ name: "classroom", occupancy_type: "classroom" }],
      lighting: {},
    };
    const flags = detectOverreach(brief, spec);
    expect(flags).toContain("ceiling fan");
  });

  it("returns empty array for clean spec matching brief", () => {
    const brief = "10x4m office with 8 workstations and a door.";
    const spec = {
      elements: [
        { type: "wall", description: "wall" },
        { type: "door", description: "door" },
      ],
      furniture: [
        { type: "workstation", description: "workstation" },
      ],
      spaces: [{ name: "office", occupancy_type: "office" }],
      lighting: {},
    };
    const flags = detectOverreach(brief, spec);
    expect(flags).toHaveLength(0);
  });

  it("flags multiple overreach items at once", () => {
    const brief = "Simple 4x4m room.";
    const spec = {
      elements: [],
      furniture: [
        { type: "reception desk", description: "" },
        { type: "planter", description: "decorative plant" },
      ],
      spaces: [{ name: "room", occupancy_type: "general" }],
      lighting: { zones: [{ fixture_type: "security light" }] },
    };
    const flags = detectOverreach(brief, spec);
    expect(flags).toContain("reception");
    expect(flags).toContain("plant");
    expect(flags).toContain("security");
  });
});
