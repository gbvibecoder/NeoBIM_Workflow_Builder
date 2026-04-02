/**
 * Tests for GN-001 Massing Generator — 3D AI Studio integration
 * Tests prompt engineering + KPI calculation (no live API calls)
 */

import { describe, it, expect } from "vitest";
import { buildPrompt, calculateKPIs, type BuildingRequirements } from "@/services/threedai-studio";

// ─── Prompt Generation ──────────────────────────────────────────────────────

describe("buildPrompt", () => {
  it("uses master template for structured input with 3+ fields", () => {
    const req: BuildingRequirements = {
      buildingType: "mixed-use",
      floors: 25,
      height: 87.5,
      style: "parametric",
      massing: "podium_tower",
      materials: ["glass", "aluminum"],
      footprint: { shape: "rectangular", width: 40, depth: 25, area: 1000 },
      features: ["terrace", "canopy", "double_skin"],
      context: { site: "urban corner lot", climate: "temperate" },
    };

    const { prompt, negativePrompt, template } = buildPrompt(req);

    expect(template).toBe("master");
    expect(prompt).toContain("EXACTLY 25 floors");
    expect(prompt).toContain("mixed-use");
    expect(prompt).toContain("88"); // 87.5 rounds to 88
    expect(prompt).toContain("podium");
    expect(prompt).toContain("parametric");
    expect(prompt).toContain("glass curtain wall");
    expect(prompt).toContain("aluminum");
    expect(prompt).toContain("terrace");
    // VIEW_SUFFIX may be truncated at the 1024-char API limit — verify prompt is capped
    expect(prompt.length).toBeLessThanOrEqual(1024);
    expect(negativePrompt).toContain("low quality");
    expect(negativePrompt).toContain("cartoon");
    expect(negativePrompt).toContain("non-architectural");
  });

  it("uses passthrough template for rich descriptions (>100 chars)", () => {
    const richText = "The proposed building is a circular, futuristic structure that appears slightly elevated and spaced out, giving it a light, almost hovering presence. The building footprint is perfectly round, with a diameter of approximately 30 meters.";
    const req: BuildingRequirements = {
      content: richText,
      floors: 5,
      buildingType: "mixed-use",
      materials: ["glass"],
    };

    const { prompt, template } = buildPrompt(req);

    // Should use passthrough, NOT master — preserves user's architectural vision
    expect(template).toBe("passthrough");
    expect(prompt).toContain("circular");
    expect(prompt).toContain("futuristic");
    expect(prompt).toContain("hovering");
    expect(prompt).toContain("30 meters");
    expect(prompt).toContain("isometric view");
  });

  it("uses minimal template for sparse input", () => {
    const req: BuildingRequirements = {
      content: "A hotel building with 8 floors",
    };

    const { prompt, template } = buildPrompt(req);

    expect(template).toBe("minimal");
    expect(prompt).toContain("hotel");
    expect(prompt).toContain("isometric view");
  });

  it("uses campus template for campus/masterplan keywords", () => {
    const req: BuildingRequirements = {
      buildingType: "campus",
      floors: 4,
      style: "modern",
    };

    const { prompt, template } = buildPrompt(req);

    expect(template).toBe("campus");
    expect(prompt).toContain("campus");
    expect(prompt).toContain("masterplan");
  });

  it("detects campus from content text", () => {
    const req: BuildingRequirements = {
      content: "Design a tech campus with multiple buildings",
      floors: 5,
    };

    const { template } = buildPrompt(req);
    expect(template).toBe("campus");
  });

  it("includes footprint dimensions when provided", () => {
    const req: BuildingRequirements = {
      floors: 10,
      footprint: { shape: "rectangular", width: 40, depth: 25 },
    };

    const { prompt } = buildPrompt(req);
    expect(prompt).toContain("40m");
    expect(prompt).toContain("25m");
  });

  it("includes all massing vocabulary types", () => {
    const massingTypes = [
      "extruded", "stepped", "tapered", "twisted", "podium_tower",
      "stacked", "cantilever", "terraced", "sculpted", "split",
    ];

    for (const massing of massingTypes) {
      const { prompt } = buildPrompt({ floors: 10, massing });
      expect(prompt.length).toBeGreaterThan(50);
    }
  });

  it("handles all style descriptors", () => {
    const styles = [
      "parametric", "brutalist", "minimalist", "hightech",
      "deconstructivist", "organic", "sustainable", "modern",
    ];

    for (const style of styles) {
      const { prompt } = buildPrompt({ floors: 10, style });
      expect(prompt.length).toBeGreaterThan(50);
    }
  });

  it("handles all material descriptors", () => {
    const materials = [
      "glass", "concrete", "steel", "timber", "brick",
      "terracotta", "zinc", "stone", "copper",
    ];

    for (const mat of materials) {
      const { prompt } = buildPrompt({ floors: 10, materials: [mat] });
      expect(prompt).toContain(mat);
    }
  });

  it("falls back to minimal when only buildingType given", () => {
    const { prompt, template } = buildPrompt({ buildingType: "hotel" });
    // No structured data (floors/footprint/massing/materials), no content
    expect(template).toBe("minimal");
    expect(prompt).toContain("hotel");
  });

  it("always includes negative prompt", () => {
    const { negativePrompt } = buildPrompt({});
    expect(negativePrompt).toBeTruthy();
    expect(negativePrompt).toContain("low quality");
  });

  // ── Prompt Length (1024-char API limit) ──────────────────────────────────

  it("never exceeds 1024 characters for any template", () => {
    // Master template with maximum fields
    const maxMaster = buildPrompt({
      buildingType: "mixed-use",
      floors: 25,
      height: 87.5,
      style: "parametric",
      massing: "podium_tower",
      materials: ["glass", "aluminum", "concrete"],
      footprint: { shape: "rectangular", width: 40, depth: 25, area: 1000 },
      features: ["terrace", "canopy", "double_skin", "rooftop_garden"],
      context: { site: "urban corner lot", surroundings: "dense financial district", orientation: "south-facing" },
    });
    expect(maxMaster.prompt.length).toBeLessThanOrEqual(1024);

    // Campus template
    const campus = buildPrompt({
      buildingType: "campus",
      floors: 4,
      style: "sustainable",
    });
    expect(campus.prompt.length).toBeLessThanOrEqual(1024);

    // Minimal template with long content
    const minimal = buildPrompt({
      content: "A large mixed-use building in downtown area",
      floors: 30,
      materials: ["glass", "steel", "concrete"],
    });
    expect(minimal.prompt.length).toBeLessThanOrEqual(1024);
  });

  it("truncates passthrough prompts that exceed 1024 chars", () => {
    // Generate a very long description (>1024 chars)
    const longText = "A magnificent " + "very tall and beautiful contemporary ".repeat(30) + "building with glass facade";
    expect(longText.length).toBeGreaterThan(1024);

    const { prompt, template } = buildPrompt({ content: longText });

    expect(template).toBe("passthrough");
    expect(prompt.length).toBeLessThanOrEqual(1024);
    expect(prompt).toContain("isometric view"); // VIEW_SUFFIX preserved
    expect(prompt).toContain("..."); // truncation indicator
  });

  it("truncates master prompts that exceed 1024 chars", () => {
    // Build a maximally-long master prompt by combining all possible fields
    const { prompt } = buildPrompt({
      buildingType: "mixed-use development with extensive retail and commercial spaces",
      floors: 50,
      height: 200,
      style: "deconstructivist",
      massing: "podium_tower",
      materials: ["glass", "aluminum", "terracotta"],
      footprint: { shape: "L-shaped with courtyard", width: 80, depth: 60, area: 4800 },
      features: ["terrace", "canopy", "double_skin", "rooftop_garden", "skybridge", "swimming_pool"],
      context: { site: "prominent waterfront corner lot", surroundings: "dense mixed-use neighborhood" },
    });
    expect(prompt.length).toBeLessThanOrEqual(1024);
  });

  // ── Edge Cases ───────────────────────────────────────────────────────────

  it("handles empty requirements without crashing", () => {
    const { prompt, template } = buildPrompt({});
    expect(prompt.length).toBeGreaterThan(0);
    expect(template).toBe("minimal");
  });

  it("handles content at exactly 100 chars (not passthrough)", () => {
    const text = "A".repeat(100);
    const { template } = buildPrompt({ content: text });
    // 100 chars = NOT rich description, should use minimal
    expect(template).not.toBe("passthrough");
  });

  it("handles content at 101 chars (passthrough)", () => {
    const text = "A".repeat(101);
    const { template } = buildPrompt({ content: text });
    expect(template).toBe("passthrough");
  });

  it("detects campus from 'complex' keyword", () => {
    const { template } = buildPrompt({
      content: "Design a building complex with gardens",
      floors: 3,
    });
    expect(template).toBe("campus");
  });

  it("handles hyphenated style descriptors (art-deco, high-tech)", () => {
    const artDeco = buildPrompt({ floors: 10, style: "art-deco" });
    expect(artDeco.prompt.length).toBeGreaterThan(50);

    const highTech = buildPrompt({ floors: 10, style: "high-tech" });
    expect(highTech.prompt.length).toBeGreaterThan(50);
  });

  it("handles unknown massing type gracefully", () => {
    const { prompt } = buildPrompt({ floors: 10, massing: "unknown_type" });
    expect(prompt.length).toBeGreaterThan(50);
    // Should still produce a valid prompt, just without the massing descriptor
  });

  it("handles unknown materials gracefully", () => {
    const { prompt } = buildPrompt({ floors: 10, materials: ["unobtanium"] });
    expect(prompt).toContain("unobtanium"); // falls back to "${mat} facade"
  });

  it("limits materials to 3 in prompt", () => {
    const { prompt } = buildPrompt({
      floors: 10,
      materials: ["glass", "steel", "concrete", "timber", "brick"],
    });
    // Should only include first 3 materials
    const matCount = ["glass", "steel", "concrete", "timber", "brick"]
      .filter(m => prompt.includes(m)).length;
    expect(matCount).toBeLessThanOrEqual(3);
  });

  it("limits features to 4 in prompt", () => {
    const { prompt } = buildPrompt({
      floors: 10,
      features: ["terrace", "canopy", "double_skin", "rooftop_garden", "skybridge", "swimming_pool"],
    });
    const featCount = ["terrace", "canopy", "double_skin", "rooftop_garden", "skybridge", "swimming_pool"]
      .filter(f => prompt.toLowerCase().includes(f.replace(/_/g, " ")) || prompt.toLowerCase().includes(f)).length;
    expect(featCount).toBeLessThanOrEqual(4);
  });

  it("prefers content/prompt field over structured buildingType for passthrough", () => {
    const { template, prompt } = buildPrompt({
      content: "A beautiful circular glass tower with spiraling balconies rising 30 stories above the waterfront, featuring a dramatic cantilevered observation deck",
      buildingType: "office",
      floors: 30,
    });
    // Rich content > 100 chars → passthrough, preserving user's vision
    expect(template).toBe("passthrough");
    expect(prompt).toContain("circular glass tower");
    expect(prompt).toContain("spiraling balconies");
  });
});

// ─── KPI Calculation ────────────────────────────────────────────────────────

describe("calculateKPIs", () => {
  const fullReqs: BuildingRequirements = {
    buildingType: "mixed-use",
    floors: 25,
    floorToFloorHeight: 3.5,
    height: 87.5,
    footprint: { shape: "rectangular", width: 40, depth: 25, area: 1000 },
    siteArea: 2500,
    total_gfa_m2: 25000,
  };

  it("calculates GFA correctly", () => {
    const kpis = calculateKPIs(fullReqs);
    expect(kpis.grossFloorArea).toBe(25000);
  });

  it("calculates NFA from GFA × efficiency", () => {
    const kpis = calculateKPIs(fullReqs);
    expect(kpis.efficiency).toBe(75); // mixed-use = 0.75
    expect(kpis.netFloorArea).toBe(18750); // 25000 × 0.75
  });

  it("preserves floor count and height", () => {
    const kpis = calculateKPIs(fullReqs);
    expect(kpis.floors).toBe(25);
    expect(kpis.totalHeight).toBe(87.5);
    expect(kpis.floorToFloorHeight).toBe(3.5);
  });

  it("calculates footprint area from dimensions", () => {
    const kpis = calculateKPIs(fullReqs);
    expect(kpis.footprintArea).toBe(1000);
  });

  it("calculates FAR when siteArea provided", () => {
    const kpis = calculateKPIs(fullReqs);
    expect(kpis.floorAreaRatio).toBe(10); // 25000 / 2500
  });

  it("calculates site coverage when siteArea provided", () => {
    const kpis = calculateKPIs(fullReqs);
    expect(kpis.siteCoverage).toBe(40); // 1000 / 2500 × 100
  });

  it("returns null FAR/coverage when no siteArea", () => {
    const kpis = calculateKPIs({ floors: 10, footprint_m2: 500 });
    expect(kpis.floorAreaRatio).toBeNull();
    expect(kpis.siteCoverage).toBeNull();
  });

  it("calculates volume correctly", () => {
    const kpis = calculateKPIs(fullReqs);
    expect(kpis.estimatedVolume).toBe(87500); // 1000 × 87.5
  });

  it("calculates facade area from perimeter × height", () => {
    const kpis = calculateKPIs(fullReqs);
    // Perimeter = 2 × (40 + 25) = 130, × 87.5 = 11375
    expect(kpis.facadeArea).toBe(11375);
  });

  it("returns positive S/V ratio", () => {
    const kpis = calculateKPIs(fullReqs);
    expect(kpis.surfaceToVolumeRatio).toBeGreaterThan(0);
  });

  it("suggests structural grid by building type", () => {
    const kpis = calculateKPIs(fullReqs);
    expect(kpis.structuralGrid).toBe("8.0m × 8.0m"); // mixed-use
  });

  it("has correct efficiency per building type", () => {
    const types: [string, number][] = [
      ["residential", 82],
      ["office", 78],
      ["mixed-use", 75],
      ["hotel", 70],
      ["hospital", 65],
      ["school", 72],
      ["retail", 85],
      ["warehouse", 92],
    ];

    for (const [type, expectedEff] of types) {
      const kpis = calculateKPIs({ buildingType: type, floors: 10 });
      expect(kpis.efficiency).toBe(expectedEff);
    }
  });

  it("calculates sustainability metrics", () => {
    const kpis = calculateKPIs(fullReqs);
    expect(kpis.sustainability.estimatedEUI).toBeGreaterThan(0);
    expect(kpis.sustainability.euiUnit).toBe("kWh/m²/year");
    expect(["Excellent", "Good", "Moderate"]).toContain(kpis.sustainability.daylightPotential);
    expect(["High", "Moderate", "Low"]).toContain(kpis.sustainability.naturalVentilation);
    expect(typeof kpis.sustainability.greenRoofPotential).toBe("boolean");
  });

  it("defaults to 5 floors and 500 sqm footprint when minimal input", () => {
    const kpis = calculateKPIs({});
    expect(kpis.floors).toBe(5);
    expect(kpis.footprintArea).toBe(500);
    expect(kpis.grossFloorArea).toBe(2500); // 5 × 500
  });

  it("derives height from floors × floorToFloor when height not given", () => {
    const kpis = calculateKPIs({ floors: 10, floorToFloorHeight: 4 });
    expect(kpis.totalHeight).toBe(40);
  });

  it("derives footprint from GFA / floors", () => {
    const kpis = calculateKPIs({ floors: 10, total_gfa_m2: 5000 });
    expect(kpis.footprintArea).toBe(500); // 5000 / 10
  });

  // ── Edge Cases — Zero, Negative, NaN Inputs ──────────────────────────────

  it("clamps floors=0 to 1 (prevents division by zero)", () => {
    const kpis = calculateKPIs({ floors: 0, total_gfa_m2: 5000 });
    expect(kpis.floors).toBe(1);
    expect(kpis.footprintArea).toBe(5000); // 5000 / 1
    expect(Number.isFinite(kpis.grossFloorArea)).toBe(true);
    expect(Number.isFinite(kpis.surfaceToVolumeRatio)).toBe(true);
  });

  it("clamps negative floors to 1", () => {
    const kpis = calculateKPIs({ floors: -5 });
    expect(kpis.floors).toBe(1);
    expect(kpis.grossFloorArea).toBeGreaterThan(0);
  });

  it("clamps negative height to minimum floorToFloor", () => {
    const kpis = calculateKPIs({ floors: 10, height: -50 });
    expect(kpis.totalHeight).toBeGreaterThan(0);
    expect(Number.isFinite(kpis.facadeArea)).toBe(true);
    expect(kpis.facadeArea).toBeGreaterThanOrEqual(0);
  });

  it("clamps negative floorToFloorHeight to 2m minimum", () => {
    const kpis = calculateKPIs({ floors: 10, floorToFloorHeight: -1 });
    expect(kpis.floorToFloorHeight).toBe(2);
    expect(kpis.totalHeight).toBe(20); // 10 × 2
  });

  it("never produces NaN in any output field", () => {
    const edgeCases: BuildingRequirements[] = [
      {},
      { floors: 0 },
      { floors: -1, height: -10, footprint_m2: -100 },
      { footprint: { width: 0, depth: 0 } },
      { total_gfa_m2: 0, floors: 0 },
      { siteArea: 0, total_gfa_m2: 1000 },
    ];

    for (const req of edgeCases) {
      const kpis = calculateKPIs(req);
      expect(Number.isFinite(kpis.floors)).toBe(true);
      expect(Number.isFinite(kpis.totalHeight)).toBe(true);
      expect(Number.isFinite(kpis.footprintArea)).toBe(true);
      expect(Number.isFinite(kpis.grossFloorArea)).toBe(true);
      expect(Number.isFinite(kpis.netFloorArea)).toBe(true);
      expect(Number.isFinite(kpis.efficiency)).toBe(true);
      expect(Number.isFinite(kpis.estimatedVolume)).toBe(true);
      expect(Number.isFinite(kpis.facadeArea)).toBe(true);
      expect(Number.isFinite(kpis.surfaceToVolumeRatio)).toBe(true);
      expect(Number.isFinite(kpis.sustainability.estimatedEUI)).toBe(true);
      // FAR and siteCoverage can be null, but if not null must be finite
      if (kpis.floorAreaRatio !== null) expect(Number.isFinite(kpis.floorAreaRatio)).toBe(true);
      if (kpis.siteCoverage !== null) expect(Number.isFinite(kpis.siteCoverage)).toBe(true);
    }
  });

  it("never produces negative values for physical quantities", () => {
    const kpis = calculateKPIs({ floors: -5, height: -20, footprint_m2: -100 });
    expect(kpis.floors).toBeGreaterThan(0);
    expect(kpis.totalHeight).toBeGreaterThan(0);
    expect(kpis.footprintArea).toBeGreaterThan(0);
    expect(kpis.grossFloorArea).toBeGreaterThan(0);
    expect(kpis.estimatedVolume).toBeGreaterThan(0);
    expect(kpis.facadeArea).toBeGreaterThanOrEqual(0);
    expect(kpis.surfaceToVolumeRatio).toBeGreaterThan(0);
  });

  it("handles zero footprint dimensions gracefully", () => {
    const kpis = calculateKPIs({
      floors: 10,
      footprint: { shape: "rectangular", width: 0, depth: 0, area: 0 },
    });
    expect(kpis.footprintArea).toBeGreaterThan(0); // clamped to minimum
    expect(Number.isFinite(kpis.surfaceToVolumeRatio)).toBe(true);
  });

  it("handles unknown building type with default efficiency", () => {
    const kpis = calculateKPIs({ buildingType: "space-station", floors: 10 });
    expect(kpis.efficiency).toBe(75); // default = 0.75
    expect(kpis.structuralGrid).toBe("8.0m × 8.0m"); // default grid
  });

  it("handles very large buildings correctly", () => {
    const kpis = calculateKPIs({
      floors: 200,
      height: 800,
      footprint: { shape: "rectangular", width: 100, depth: 100, area: 10000 },
      total_gfa_m2: 2000000,
      siteArea: 50000,
    });
    expect(Number.isFinite(kpis.grossFloorArea)).toBe(true);
    expect(Number.isFinite(kpis.floorAreaRatio!)).toBe(true);
    expect(kpis.sustainability.greenRoofPotential).toBe(false); // 200 floors > 20
  });

  it("uses footprint_m2 when footprint object not provided", () => {
    const kpis = calculateKPIs({ floors: 10, footprint_m2: 750 });
    expect(kpis.footprintArea).toBe(750);
  });

  it("prefers footprint.area over footprint_m2", () => {
    const kpis = calculateKPIs({
      floors: 10,
      footprint: { area: 900 },
      footprint_m2: 750,
    });
    expect(kpis.footprintArea).toBe(900);
  });

  it("calculates footprint from width×depth when area not given", () => {
    const kpis = calculateKPIs({
      floors: 10,
      footprint: { width: 30, depth: 20 },
    });
    expect(kpis.footprintArea).toBe(600); // 30 × 20
  });
});
