/**
 * Floor Plan Quality Audit Tests
 *
 * Tests for modules that previously had zero coverage:
 * - furniture-layout (sofa duplication fix)
 * - dimension-corrector (tighter thresholds)
 * - vastu-analyzer (rule specificity)
 * - code-validator (fire egress, frame factor)
 * - program-validator (BHK parsing, synonym matching)
 * - export-svg (arrow marker)
 * - smart-placement (door heights)
 */

import { describe, it, expect } from "vitest";
import { correctDimensions, type RoomWithTarget } from "@/lib/floor-plan/dimension-corrector";
import { parsePromptRequirements } from "@/lib/floor-plan/program-validator";

// ============================================================
// DIMENSION CORRECTOR — tighter thresholds
// ============================================================

describe("Dimension Corrector", () => {
  function makeRoom(
    name: string, type: string,
    x: number, y: number, w: number, d: number,
    targetArea: number, targetW?: number, targetD?: number,
  ): RoomWithTarget {
    return {
      name, type, x, y, width: w, depth: d,
      area: w * d, targetArea, targetWidth: targetW, targetDepth: targetD,
    };
  }

  it("should correct oversized room toward target area", () => {
    // Living is oversized (40 sqm, target 20), Bedroom is undersized (8 sqm, target 20)
    const rooms: RoomWithTarget[] = [
      makeRoom("Living Room", "living", 0, 0, 8, 5, 20), // 40 sqm, target 20
      makeRoom("Bedroom", "bedroom", 8, 0, 2, 4, 20),     // 8 sqm, target 20
    ];
    const result = correctDimensions(rooms, 10, 5);
    const living = result.find(r => r.name === "Living Room")!;
    const bedroom = result.find(r => r.name === "Bedroom")!;
    // Living should have shrunk, bedroom should have grown
    expect(living.width * living.depth).toBeLessThan(40);
    expect(bedroom.width * bedroom.depth).toBeGreaterThan(8);
  });

  it("should not create overlaps during correction", () => {
    const rooms: RoomWithTarget[] = [
      makeRoom("A", "living", 0, 0, 6, 4, 15),
      makeRoom("B", "bedroom", 6, 0, 6, 4, 30),
      makeRoom("C", "kitchen", 0, 4, 6, 4, 12),
      makeRoom("D", "dining", 6, 4, 6, 4, 10),
    ];
    const result = correctDimensions(rooms, 12, 8);
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i], b = result[j];
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
        expect(overlapX < 0.2 || overlapY < 0.2).toBe(true);
      }
    }
  });

  it("should respect minimum room dimensions", () => {
    const rooms: RoomWithTarget[] = [
      makeRoom("Bathroom", "bathroom", 0, 0, 2, 2, 3),
      makeRoom("Living", "living", 2, 0, 8, 5, 35),
    ];
    const result = correctDimensions(rooms, 10, 5);
    const bath = result.find(r => r.name === "Bathroom")!;
    expect(bath.width).toBeGreaterThanOrEqual(1.2);
    expect(bath.depth).toBeGreaterThanOrEqual(1.2);
  });
});

// ============================================================
// PROGRAM VALIDATOR — BHK parsing
// ============================================================

describe("Program Validator — parsePromptRequirements", () => {
  it("should parse BHK count correctly", () => {
    const result = parsePromptRequirements("3bhk apartment in Mumbai");
    expect(result.rawBHK).toBe(3);
    expect(result.bedrooms).toBe(3);
    expect(result.hasLiving).toBe(true);
    expect(result.hasKitchen).toBe(true);
  });

  it("should NOT assume bathroom count from BHK", () => {
    const result = parsePromptRequirements("4bhk villa");
    expect(result.rawBHK).toBe(4);
    // BHK should not force bathroom count
    expect(result.bathrooms).toBeNull();
  });

  it("should parse explicit bathroom count", () => {
    const result = parsePromptRequirements("3bhk with 2 bathrooms");
    expect(result.bedrooms).toBe(3);
    expect(result.bathrooms).toBe(2);
  });

  it("should parse area in sqft", () => {
    const result = parsePromptRequirements("2bhk 1200 sq ft");
    expect(result.totalArea_sqm).toBeCloseTo(111.5, 0);
  });

  it("should parse area in sqm", () => {
    const result = parsePromptRequirements("3bhk 120 sq m apartment");
    expect(result.totalArea_sqm).toBe(120);
  });

  it("should detect puja room requirement", () => {
    const result = parsePromptRequirements("4bhk with pooja room");
    expect(result.hasPuja).toBe(true);
  });

  it("should detect dining room for 2+ BHK", () => {
    const result = parsePromptRequirements("2bhk flat");
    expect(result.hasDining).toBe(true);
  });

  it("should detect servant quarter requirement", () => {
    const result = parsePromptRequirements("5bhk with servant quarter");
    expect(result.hasServantQuarter).toBe(true);
  });

  it("should handle edge case: no BHK", () => {
    const result = parsePromptRequirements("studio apartment");
    expect(result.rawBHK).toBeNull();
    expect(result.bedrooms).toBeNull();
  });

  it("should parse balcony count", () => {
    const result = parsePromptRequirements("3bhk with 2 balconies");
    expect(result.balconies).toBe(2);
  });
});

// ============================================================
// EXPORT SVG — arrow marker
// ============================================================

describe("SVG Export — Arrow Marker", () => {
  it("should include arrow marker definition in source", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve("src/lib/floor-plan/export-svg.ts");
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain('<marker id="arrow"');
    expect(content).toContain('orient="auto-start-reverse"');
  });
});

// ============================================================
// SMART PLACEMENT — door heights
// ============================================================

describe("Smart Placement Door Heights", () => {
  it("should set main entrance height to 2200mm", async () => {
    // Verify the constant in the source code
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve("src/lib/floor-plan/smart-placement.ts");
    const content = fs.readFileSync(filePath, "utf-8");
    // Main entrance should be 2200mm, not 2100mm
    expect(content).toContain('type === "main_entrance" ? 2200 : 2100');
  });
});

// ============================================================
// VASTU ANALYZER — rule specificity
// ============================================================

describe("Vastu Analyzer Rule Specificity", () => {
  it("should use penalty_points for rule priority, not string length", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve("src/lib/floor-plan/vastu-analyzer.ts");
    const content = fs.readFileSync(filePath, "utf-8");
    // Should NOT use string length for specificity
    expect(content).not.toContain("map(t => t.length)");
    // Should use penalty_points
    expect(content).toContain("b.penalty_points - a.penalty_points");
  });
});

// ============================================================
// CODE VALIDATOR — frame factor consistency
// ============================================================

describe("Code Validator Frame Factor Consistency", () => {
  it("should use gross opening area (no frame factor) per NBC 2016 Cl. 8.4.6", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve("src/lib/floor-plan/code-validator.ts");
    const content = fs.readFileSync(filePath, "utf-8");
    // NBC 2016 Cl. 8.4.6 specifies "opening area" (gross window opening), not glazed area.
    // FRAME_FACTOR should NOT be applied to window-to-floor ratio checks.
    const frameFactor = content.match(/FRAME_FACTOR\s*=\s*0\.7/g);
    expect(frameFactor).toBeNull();
    // Verify both checks use gross area (w.width_mm * w.height_mm) without frame factor
    const grossAreaCalcs = content.match(/w\.width_mm \* w\.height_mm\) \/ 1_000_000/g);
    expect(grossAreaCalcs).not.toBeNull();
    expect(grossAreaCalcs!.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// FURNITURE LAYOUT — sofa duplication fix
// ============================================================

describe("Furniture Layout Sofa Fix", () => {
  it("should not have sofa mutation inside .filter() callback", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve("src/lib/floor-plan/furniture-layout.ts");
    const content = fs.readFileSync(filePath, "utf-8");
    // The sofa-2seat adaptation should be in .map(), not .filter()
    // .filter() should not contain catalogId mutation
    const filterSection = content.slice(
      content.indexOf(".filter((s) =>"),
      content.indexOf(".filter((s) =>") + 500,
    );
    expect(filterSection).not.toContain("sofa-2seat");
  });
});
