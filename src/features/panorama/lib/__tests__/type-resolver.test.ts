import { describe, it, expect } from "vitest";
import { resolveBuildingType } from "@/features/panorama/lib/type-resolver";
import type { ParseResultLike } from "@/features/panorama/types";

describe("resolveBuildingType — NBC India step", () => {
  it("Group A → residential apartment with high confidence", () => {
    const r = resolveBuildingType({ classifications: { nbc: ["Group A"] } });
    expect(r.bucket).toBe("residential-apartment");
    expect(r.source).toBe("nbc");
    expect(r.confidence).toBe("high");
  });

  it("Group A-2 → residential villa", () => {
    const r = resolveBuildingType({ classifications: { nbc: ["Group A-2"] } });
    expect(r.bucket).toBe("residential-villa");
    expect(r.source).toBe("nbc");
  });

  it("Group F → retail", () => {
    const r = resolveBuildingType({ classifications: { nbc: ["NBC Part 4 — Group F"] } });
    expect(r.bucket).toBe("retail");
    expect(r.source).toBe("nbc");
  });

  it("Group G → industrial", () => {
    const r = resolveBuildingType({ classifications: { nbc: ["Group G"] } });
    expect(r.bucket).toBe("industrial");
  });

  it("Group B → office (educational mapped to office bucket)", () => {
    const r = resolveBuildingType({ classifications: { nbc: ["Group B"] } });
    expect(r.bucket).toBe("office");
  });

  it("Group C → office (institutional, rerouted from hospitality bucket removed 2026-05-05)", () => {
    const r = resolveBuildingType({ classifications: { nbc: ["Group C"] } });
    expect(r.bucket).toBe("office");
  });

  it("Group J → office (hospital, rerouted from hospitality bucket removed 2026-05-05)", () => {
    const r = resolveBuildingType({ classifications: { nbc: ["Group J"] } });
    expect(r.bucket).toBe("office");
  });
});

describe("resolveBuildingType — keyword fallback", () => {
  it("space names bedroom/kitchen/living → residential apartment", () => {
    const parse: ParseResultLike = {
      spaceNames: ["Bedroom", "Kitchen", "LivingRoom"],
    };
    const r = resolveBuildingType(parse);
    expect(r.bucket).toBe("residential-apartment");
    expect(r.source).toBe("space-keywords");
  });

  it("office + conference → office", () => {
    const parse: ParseResultLike = {
      spaceNames: ["Office 101", "Conference Room A", "Cubicle Bay"],
    };
    const r = resolveBuildingType(parse);
    expect(r.bucket).toBe("office");
    expect(r.source).toBe("space-keywords");
  });

  it("villa nudge: residential keywords + ≤2 storeys + garage token → villa", () => {
    const parse: ParseResultLike = {
      spaceNames: ["Master Bedroom", "Living Room", "Garage", "Garden Patio"],
      storeyCount: 2,
    };
    const r = resolveBuildingType(parse);
    expect(r.bucket).toBe("residential-villa");
  });

  it("mixed-use 50/50 office + bedroom — tie favours residential", () => {
    const parse: ParseResultLike = {
      spaceNames: ["Bedroom 1", "Office 1"],
    };
    const r = resolveBuildingType(parse);
    expect(r.bucket).toBe("residential-apartment");
  });
});

describe("resolveBuildingType — default + boundary cases", () => {
  it("null parse result → default residential-apartment with 'No model' reasoning", () => {
    const r = resolveBuildingType(null);
    expect(r.bucket).toBe("residential-apartment");
    expect(r.source).toBe("default");
    expect(r.reasoning).toMatch(/No model/);
  });

  it("empty parse result → default with 'No model' reasoning", () => {
    const r = resolveBuildingType({});
    expect(r.bucket).toBe("residential-apartment");
    expect(r.source).toBe("default");
    expect(r.reasoning).toMatch(/No model/);
  });

  it("only divisions, no NBC — falls to OmniClass step", () => {
    const r = resolveBuildingType({ divisions: ["06", "09"] });
    expect(r.source).toBe("omniclass");
    expect(r.bucket).toBe("residential-apartment");
  });

  it("HVAC-heavy divisions → industrial", () => {
    const r = resolveBuildingType({ divisions: ["03", "23"] });
    expect(r.source).toBe("omniclass");
    expect(r.bucket).toBe("industrial");
  });
});
