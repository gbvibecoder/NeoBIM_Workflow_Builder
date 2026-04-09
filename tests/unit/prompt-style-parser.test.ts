import { describe, it, expect } from "vitest";
import { parsePromptToStyle } from "@/features/3d-render/services/prompt-style-parser";

describe("parsePromptToStyle", () => {
  // ─── Material Detection ────────────────────────────────────────────────────

  describe("exterior material detection", () => {
    it("detects glass/curtain wall", () => {
      expect(parsePromptToStyle("modern glass tower").exteriorMaterial).toBe("glass");
      expect(parsePromptToStyle("curtain wall office").exteriorMaterial).toBe("glass");
      expect(parsePromptToStyle("all-glass facade").exteriorMaterial).toBe("glass");
    });

    it("detects concrete/brutalist", () => {
      expect(parsePromptToStyle("exposed concrete building").exteriorMaterial).toBe("concrete");
      expect(parsePromptToStyle("brutalist museum").exteriorMaterial).toBe("concrete");
      expect(parsePromptToStyle("board-formed concrete walls").exteriorMaterial).toBe("concrete");
    });

    it("detects brick", () => {
      expect(parsePromptToStyle("red brick apartment").exteriorMaterial).toBe("brick");
      expect(parsePromptToStyle("masonry townhouse").exteriorMaterial).toBe("brick");
    });

    it("detects wood/timber", () => {
      expect(parsePromptToStyle("timber frame house").exteriorMaterial).toBe("wood");
      expect(parsePromptToStyle("CLT residential building").exteriorMaterial).toBe("wood");
      expect(parsePromptToStyle("cedar-clad cabin").exteriorMaterial).toBe("wood");
    });

    it("detects steel/corten", () => {
      expect(parsePromptToStyle("cor-ten steel facade").exteriorMaterial).toBe("steel");
      expect(parsePromptToStyle("weathering steel cladding").exteriorMaterial).toBe("steel");
      expect(parsePromptToStyle("zinc-clad warehouse").exteriorMaterial).toBe("steel");
    });

    it("detects stone", () => {
      expect(parsePromptToStyle("limestone office building").exteriorMaterial).toBe("stone");
      expect(parsePromptToStyle("sandstone facade").exteriorMaterial).toBe("stone");
      expect(parsePromptToStyle("natural stone cladding").exteriorMaterial).toBe("stone");
    });

    it("detects terracotta", () => {
      expect(parsePromptToStyle("terracotta panel facade").exteriorMaterial).toBe("terracotta");
      expect(parsePromptToStyle("ceramic facade school").exteriorMaterial).toBe("terracotta");
    });

    it("defaults to mixed for unspecified material", () => {
      expect(parsePromptToStyle("5 storey building").exteriorMaterial).toBe("mixed");
    });
  });

  // ─── Usage Detection ───────────────────────────────────────────────────────

  describe("usage detection", () => {
    it("detects office", () => {
      expect(parsePromptToStyle("corporate headquarters").usage).toBe("office");
      expect(parsePromptToStyle("co-working space").usage).toBe("office");
    });

    it("detects residential", () => {
      expect(parsePromptToStyle("apartment complex").usage).toBe("residential");
      expect(parsePromptToStyle("housing development").usage).toBe("residential");
    });

    it("detects hotel", () => {
      expect(parsePromptToStyle("boutique hotel").usage).toBe("hotel");
      expect(parsePromptToStyle("resort building").usage).toBe("hotel");
    });

    it("detects educational", () => {
      expect(parsePromptToStyle("university library").usage).toBe("educational");
      expect(parsePromptToStyle("primary school building").usage).toBe("educational");
    });

    it("detects healthcare", () => {
      expect(parsePromptToStyle("hospital wing").usage).toBe("healthcare");
      expect(parsePromptToStyle("medical center").usage).toBe("healthcare");
    });

    it("detects cultural", () => {
      expect(parsePromptToStyle("contemporary art museum").usage).toBe("cultural");
      expect(parsePromptToStyle("concert hall").usage).toBe("cultural");
    });

    it("detects industrial", () => {
      expect(parsePromptToStyle("warehouse building").usage).toBe("industrial");
      expect(parsePromptToStyle("manufacturing plant").usage).toBe("industrial");
    });

    it("detects mixed-use", () => {
      expect(parsePromptToStyle("mixed-use development").usage).toBe("mixed");
    });

    it("defaults to mixed for unspecified usage", () => {
      expect(parsePromptToStyle("10-storey building").usage).toBe("mixed");
    });
  });

  // ─── Environment Detection ─────────────────────────────────────────────────

  describe("environment detection", () => {
    it("detects urban", () => {
      expect(parsePromptToStyle("downtown office tower").environment).toBe("urban");
      expect(parsePromptToStyle("central business district").environment).toBe("urban");
    });

    it("detects waterfront from river/lake", () => {
      expect(parsePromptToStyle("riverside apartment").environment).toBe("waterfront");
      expect(parsePromptToStyle("lakefront villa").environment).toBe("waterfront");
      expect(parsePromptToStyle("harbour development").environment).toBe("waterfront");
    });

    it("detects desert", () => {
      expect(parsePromptToStyle("Dubai office tower").environment).toBe("desert");
      expect(parsePromptToStyle("desert research facility").environment).toBe("desert");
    });

    it("detects mountain", () => {
      expect(parsePromptToStyle("alpine resort").environment).toBe("mountain");
      expect(parsePromptToStyle("hillside residence").environment).toBe("mountain");
    });

    it("detects campus", () => {
      expect(parsePromptToStyle("university campus building").environment).toBe("campus");
    });

    it("detects coastal", () => {
      // "beachfront" matches waterfront rule first (higher priority)
      expect(parsePromptToStyle("beachfront hotel").environment).toBe("waterfront");
      expect(parsePromptToStyle("cliff-top retreat").environment).toBe("coastal");
    });

    it("defaults to suburban", () => {
      expect(parsePromptToStyle("5 storey residential").environment).toBe("suburban");
    });
  });

  // ─── Typology Detection ────────────────────────────────────────────────────

  describe("typology detection", () => {
    it("detects tower from keywords", () => {
      expect(parsePromptToStyle("skyscraper in downtown").typology).toBe("tower");
      expect(parsePromptToStyle("high-rise office").typology).toBe("tower");
    });

    it("detects podium-tower", () => {
      expect(parsePromptToStyle("podium and tower mixed-use").typology).toBe("podium-tower");
      expect(parsePromptToStyle("tower on podium").typology).toBe("podium-tower");
    });

    it("detects courtyard", () => {
      expect(parsePromptToStyle("courtyard housing").typology).toBe("courtyard");
      expect(parsePromptToStyle("u-shape residential").typology).toBe("courtyard");
    });

    it("detects villa for low-rise", () => {
      expect(parsePromptToStyle("luxury villa").typology).toBe("villa");
      expect(parsePromptToStyle("single family house").typology).toBe("villa");
    });

    it("detects slab", () => {
      expect(parsePromptToStyle("linear housing block").typology).toBe("slab");
    });

    it("infers tower from high floor count", () => {
      expect(parsePromptToStyle("25 storey building", 25).typology).toBe("tower");
    });

    it("infers villa from low floor count", () => {
      expect(parsePromptToStyle("small building", 2).typology).toBe("villa");
    });
  });

  // ─── Facade Pattern Detection ──────────────────────────────────────────────

  describe("facade pattern detection", () => {
    it("detects curtain-wall", () => {
      expect(parsePromptToStyle("curtain wall office").facadePattern).toBe("curtain-wall");
      expect(parsePromptToStyle("structural glazing facade").facadePattern).toBe("curtain-wall");
    });

    it("detects brise-soleil", () => {
      expect(parsePromptToStyle("brise soleil shading").facadePattern).toBe("brise-soleil");
      expect(parsePromptToStyle("solar screen facade").facadePattern).toBe("brise-soleil");
      expect(parsePromptToStyle("louver facade").facadePattern).toBe("brise-soleil");
    });

    it("detects ribbon-window", () => {
      expect(parsePromptToStyle("ribbon window modernist").facadePattern).toBe("ribbon-window");
      expect(parsePromptToStyle("band window facade").facadePattern).toBe("ribbon-window");
    });

    it("detects punched-window", () => {
      expect(parsePromptToStyle("deep set recessed windows").facadePattern).toBe("punched-window");
    });

    it("infers curtain-wall from glass material", () => {
      expect(parsePromptToStyle("all glass tower").facadePattern).toBe("curtain-wall");
    });

    it("infers punched-window from brick", () => {
      expect(parsePromptToStyle("brick building").facadePattern).toBe("punched-window");
    });

    it("infers ribbon-window from concrete", () => {
      expect(parsePromptToStyle("exposed concrete museum").facadePattern).toBe("ribbon-window");
    });

    it("infers brise-soleil from terracotta", () => {
      expect(parsePromptToStyle("terracotta school").facadePattern).toBe("brise-soleil");
    });
  });

  // ─── Boolean Flags ─────────────────────────────────────────────────────────

  describe("boolean flags", () => {
    it("sets glassHeavy for glass buildings", () => {
      expect(parsePromptToStyle("glass tower").glassHeavy).toBe(true);
      expect(parsePromptToStyle("curtain wall facade").glassHeavy).toBe(true);
      expect(parsePromptToStyle("brick apartment").glassHeavy).toBe(false);
    });

    it("sets hasRiver", () => {
      expect(parsePromptToStyle("riverside office").hasRiver).toBe(true);
      expect(parsePromptToStyle("canal-side apartment").hasRiver).toBe(true);
      expect(parsePromptToStyle("downtown tower").hasRiver).toBe(false);
    });

    it("sets hasLake (not when river present)", () => {
      expect(parsePromptToStyle("lakefront villa").hasLake).toBe(true);
      expect(parsePromptToStyle("waterfront hotel").hasLake).toBe(true);
      // River takes priority
      expect(parsePromptToStyle("riverside lakefront building").hasLake).toBe(false);
      expect(parsePromptToStyle("riverside lakefront building").hasRiver).toBe(true);
    });

    it("sets isModern", () => {
      expect(parsePromptToStyle("modern minimalist house").isModern).toBe(true);
      expect(parsePromptToStyle("contemporary office").isModern).toBe(true);
      expect(parsePromptToStyle("glass tower").isModern).toBe(true); // glass implies modern
      expect(parsePromptToStyle("traditional brick house").isModern).toBe(false);
    });

    it("sets isTower based on keywords or floor count", () => {
      expect(parsePromptToStyle("skyscraper").isTower).toBe(true);
      expect(parsePromptToStyle("tower block").isTower).toBe(true);
      expect(parsePromptToStyle("15-storey building", 15).isTower).toBe(true);
      expect(parsePromptToStyle("3-storey house", 3).isTower).toBe(false);
    });
  });

  // ─── Floor Height Detection ────────────────────────────────────────────────

  describe("floor height override", () => {
    it("extracts explicit floor height from text", () => {
      expect(parsePromptToStyle("building with 4.5 meter floor height").floorHeightOverride).toBe(4.5);
      expect(parsePromptToStyle("3.2m ceiling height offices").floorHeightOverride).toBe(3.2);
    });

    it("infers floor height from usage", () => {
      expect(parsePromptToStyle("warehouse building").floorHeightOverride).toBe(6.0);
      expect(parsePromptToStyle("art museum").floorHeightOverride).toBe(5.0);
      expect(parsePromptToStyle("office tower").floorHeightOverride).toBe(3.8);
      expect(parsePromptToStyle("apartment building").floorHeightOverride).toBe(3.0);
    });
  });

  // ─── Building Type Parameter ───────────────────────────────────────────────

  describe("building type parameter", () => {
    it("uses buildingType as additional context", () => {
      // When prompt is vague but buildingType is specific
      const style = parsePromptToStyle("5 storey building", 5, "Office Tower");
      expect(style.usage).toBe("office");
      expect(style.isTower).toBe(true);
    });

    it("prompt takes priority over buildingType", () => {
      // Combined text: "brick residential apartment Office" — office matches first in USAGE_RULES
      // but material should still be brick from the prompt
      const style = parsePromptToStyle("brick residential apartment", 5, "Warehouse");
      expect(style.usage).toBe("residential");
      expect(style.exteriorMaterial).toBe("brick");
    });
  });

  // ─── Integrated Scenarios ──────────────────────────────────────────────────

  describe("realistic prompt scenarios", () => {
    it("10-storey glass office tower in CBD", () => {
      const style = parsePromptToStyle(
        "10-storey glass office tower in the central business district",
        10
      );
      expect(style.exteriorMaterial).toBe("glass");
      expect(style.usage).toBe("office");
      expect(style.environment).toBe("urban");
      expect(style.isTower).toBe(true);
      expect(style.glassHeavy).toBe(true);
      expect(style.facadePattern).toBe("curtain-wall");
    });

    it("brick residential near river", () => {
      const style = parsePromptToStyle(
        "4-storey brick residential apartment building near the river",
        4
      );
      expect(style.exteriorMaterial).toBe("brick");
      expect(style.usage).toBe("residential");
      expect(style.hasRiver).toBe(true);
      expect(style.environment).toBe("waterfront");
      expect(style.facadePattern).toBe("punched-window");
    });

    it("concrete museum with brise-soleil", () => {
      const style = parsePromptToStyle(
        "modern exposed concrete museum with brise-soleil facade",
        3
      );
      expect(style.exteriorMaterial).toBe("concrete");
      expect(style.usage).toBe("cultural");
      expect(style.isModern).toBe(true);
      expect(style.facadePattern).toBe("brise-soleil");
      expect(style.floorHeightOverride).toBe(5.0);
    });

    it("timber alpine hotel", () => {
      const style = parsePromptToStyle(
        "timber-clad boutique hotel in the alpine mountains",
        4
      );
      expect(style.exteriorMaterial).toBe("wood");
      expect(style.usage).toBe("hotel");
      expect(style.environment).toBe("mountain");
    });

    it("podium tower mixed-use development", () => {
      const style = parsePromptToStyle(
        "30-storey podium and tower mixed-use development in downtown",
        30
      );
      expect(style.typology).toBe("podium-tower");
      expect(style.usage).toBe("mixed");
      expect(style.environment).toBe("urban");
      expect(style.isTower).toBe(true);
    });

    it("desert office in Dubai", () => {
      const style = parsePromptToStyle(
        "glass curtain wall office tower in Dubai",
        20
      );
      expect(style.exteriorMaterial).toBe("glass");
      expect(style.environment).toBe("desert");
      expect(style.facadePattern).toBe("curtain-wall");
      expect(style.glassHeavy).toBe(true);
    });

    it("terracotta school building", () => {
      const style = parsePromptToStyle(
        "terracotta-clad primary school with sun shading",
        2
      );
      expect(style.exteriorMaterial).toBe("terracotta");
      expect(style.usage).toBe("educational");
      expect(style.facadePattern).toBe("brise-soleil"); // sun shading triggers brise-soleil
    });

    it("stone courthouse", () => {
      const style = parsePromptToStyle(
        "limestone courthouse building",
        4
      );
      expect(style.exteriorMaterial).toBe("stone");
      expect(style.usage).toBe("civic");
      expect(style.facadePattern).toBe("punched-window");
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty prompt", () => {
      const style = parsePromptToStyle("");
      expect(style.exteriorMaterial).toBe("mixed");
      expect(style.usage).toBe("mixed");
      expect(style.environment).toBe("suburban");
      // 5 floors default → mid-range → "generic"
      expect(style.typology).toBe("generic");
    });

    it("handles very long prompt without crashing", () => {
      const longPrompt = "modern glass tower office ".repeat(100);
      const style = parsePromptToStyle(longPrompt);
      expect(style.exteriorMaterial).toBe("glass");
      expect(style.promptText.length).toBeLessThanOrEqual(500);
    });

    it("maxFloorCap is always 30", () => {
      expect(parsePromptToStyle("building").maxFloorCap).toBe(30);
    });
  });
});
