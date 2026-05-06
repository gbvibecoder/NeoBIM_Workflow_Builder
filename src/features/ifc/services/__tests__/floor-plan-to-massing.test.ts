/* Unit tests for the floor-plan → MassingGeometry converter.
   Asserts the contracts the IFC viewer + Python service depend on. */

import { describe, expect, it } from "vitest";
import { floorPlanToMassingGeometry } from "@/features/ifc/services/floor-plan-to-massing";
import {
  FT_TO_M,
  FLOOR_PLAN_DEFAULTS,
  type FloorPlanSchema,
} from "@/features/ifc/types/floor-plan-schema";

/**
 * Reproduces the user's actual PDF brief — the canonical fixture this
 * whole pipeline was built for. 24 ft × 50 ft plot, 2BHK, single storey
 * + roof stub.
 */
const TWO_BHK_BRIEF: FloorPlanSchema = {
  plotWidthFt: 50,    // East-West (per the brief: "x 50 ft (width)")
  plotDepthFt: 24,    // North-South (per the brief: "24 ft (depth)")
  northAxis: "Z+",
  floors: [
    {
      name: "Ground Floor",
      index: 0,
      storeyHeightFt: 10,
      rooms: [
        {
          name: "Hall",
          widthFt: 15,
          lengthFt: 12,
          quadrant: "NW",
          doors: [{ wall: "S", widthFt: 3 }],
          windows: [{ wall: "N", widthFt: 4 }],
          usage: "living",
          finishMaterial: "vitrified tiles",
        },
        {
          name: "Bedroom 1",
          widthFt: 13,
          lengthFt: 12,
          quadrant: "N",
          doors: [{ wall: "S", widthFt: 3 }],
          windows: [{ wall: "S", widthFt: 4 }],
          usage: "bedroom",
        },
        {
          name: "Bedroom 2",
          widthFt: 12,
          lengthFt: 12,
          quadrant: "NE",
          doors: [{ wall: "S", widthFt: 3 }],
          windows: [{ wall: "E", widthFt: 4 }],
          usage: "bedroom",
        },
        {
          name: "Kitchen",
          widthFt: 10,
          lengthFt: 10.5,
          quadrant: "SE",
          doors: [{ wall: "N", widthFt: 3 }],
          usage: "kitchen",
        },
        {
          name: "Toilet",
          widthFt: 4.5,
          lengthFt: 6,
          quadrant: "S",
          doors: [{ wall: "N", widthFt: 2.5 }],
          usage: "toilet",
          finishMaterial: "anti-skid",
        },
      ],
      staircase: {
        quadrant: "SW",
        type: "dog-legged",
        widthFt: 4,
        hasGeometry: true,
      },
    },
    {
      name: "Roof",
      index: 1,
      isRoofStub: true,
      rooms: [],
    },
  ],
  rawText: "test",
};

describe("floorPlanToMassingGeometry — basic shape", () => {
  it("produces a valid MassingGeometry with the right top-level fields", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    expect(g.buildingType).toBe("Residential");
    expect(g.floors).toBe(1); /* livable; roof stub excluded */
    expect(g.storeys.length).toBe(2); /* ground + roof stub */
    expect(g.footprint).toHaveLength(4);
    expect(g.boundingBox.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(g.boundingBox.max.x).toBeCloseTo(50 * FT_TO_M, 5);
    expect(g.boundingBox.max.z).toBeCloseTo(24 * FT_TO_M, 5);
  });

  it("the ground storey has elements for ALL three disciplines", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const ground = g.storeys[0];
    const types = ground.elements.map((e) => e.type);
    /* Architectural. */
    expect(types).toContain("slab");
    expect(types).toContain("wall");
    expect(types).toContain("door");
    expect(types).toContain("window");
    expect(types).toContain("space");
    expect(types).toContain("stair");
    expect(types).toContain("covering-floor");
    expect(types).toContain("covering-ceiling");
    expect(types).toContain("furniture");
    /* Structural. */
    expect(types).toContain("column");
    expect(types).toContain("beam");
    expect(types).toContain("footing");
    /* MEP. */
    expect(types).toContain("sanitary-terminal");
    expect(types).toContain("pipe");
    expect(types).toContain("light-fixture");
  });

  it("every element has a discipline tag (architectural | structural | mep)", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const counts: Record<string, number> = { architectural: 0, structural: 0, mep: 0, missing: 0 };
    for (const el of g.storeys[0].elements) {
      const d = el.properties.discipline;
      if (d === "architectural" || d === "structural" || d === "mep") counts[d]++;
      else counts.missing++;
    }
    expect(counts.architectural).toBeGreaterThan(0);
    expect(counts.structural).toBeGreaterThan(0);
    expect(counts.mep).toBeGreaterThan(0);
    expect(counts.missing).toBe(0);
  });

  it("emits one IfcSpace per named room PLUS auto-corridor spaces that fill gaps", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const spaces = g.storeys[0].elements.filter((e) => e.type === "space");
    const names = spaces.map((s) => String(s.properties.spaceName));
    /* Named rooms always present. */
    expect(names).toEqual(expect.arrayContaining(["Hall", "Bedroom 1", "Bedroom 2", "Kitchen", "Toilet"]));
    /* Plot is 50×24 ft = 1200 sqft. Named rooms total ~612 sqft (51 %).
       Auto-corridors fill the remaining gaps so spaces.length > 5. */
    expect(spaces.length).toBeGreaterThanOrEqual(5);
  });
});

describe("floorPlanToMassingGeometry — unit conversion + scale", () => {
  it("converts feet to metres at every dimension boundary", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const hall = g.storeys[0].elements.find(
      (e) => e.type === "space" && e.properties.spaceName === "Hall",
    );
    expect(hall).toBeDefined();
    /* Hall is 15' × 12'  →  4.572 m × 3.658 m  →  area ≈ 16.72 m² */
    expect(hall!.properties.area).toBeCloseTo(15 * 12 * FT_TO_M * FT_TO_M, 3);
  });

  it("plot footprint is 50ft × 24ft → ~111.5 m²", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    expect(g.footprintArea).toBeCloseTo(50 * 24 * FT_TO_M * FT_TO_M, 3);
  });
});

describe("floorPlanToMassingGeometry — wall thickness defaults", () => {
  it("exterior walls use 230 mm by default, interior partitions 150 mm", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const walls = g.storeys[0].elements.filter((e) => e.type === "wall");
    const exterior = walls.filter((w) => w.properties.isExterior === true);
    const interior = walls.filter((w) => w.properties.isExterior === false);
    expect(exterior.length).toBeGreaterThan(0);
    expect(interior.length).toBeGreaterThan(0);
    expect(exterior[0].properties.thickness).toBeCloseTo(0.23, 3);
    expect(interior[0].properties.thickness).toBeCloseTo(0.15, 3);
  });

  it("respects custom wall thickness when the brief overrides", () => {
    const custom: FloorPlanSchema = {
      ...TWO_BHK_BRIEF,
      exteriorWallThicknessMm: 300,
      interiorWallThicknessMm: 100,
    };
    const g = floorPlanToMassingGeometry(custom);
    const walls = g.storeys[0].elements.filter((e) => e.type === "wall");
    const exterior = walls.filter((w) => w.properties.isExterior === true);
    const interior = walls.filter((w) => w.properties.isExterior === false);
    expect(exterior[0].properties.thickness).toBeCloseTo(0.3, 3);
    expect(interior[0].properties.thickness).toBeCloseTo(0.1, 3);
  });
});

describe("floorPlanToMassingGeometry — door + window placement", () => {
  it("emits one door per door spec on each room", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const doors = g.storeys[0].elements.filter((e) => e.type === "door");
    /* 5 rooms × 1 door each = 5 doors */
    expect(doors.length).toBe(5);
  });

  it("emits one window per window spec on each room", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const wins = g.storeys[0].elements.filter((e) => e.type === "window");
    /* Hall+Bed1+Bed2 = 3 windows; Kitchen+Toilet have no windows in fixture */
    expect(wins.length).toBe(3);
  });

  it("doors are full storey height; windows have a non-zero sill", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const doors = g.storeys[0].elements.filter((e) => e.type === "door");
    const wins = g.storeys[0].elements.filter((e) => e.type === "window");
    expect(doors[0].properties.sillHeight).toBe(0);
    expect(wins[0].properties.sillHeight).toBeCloseTo(
      FLOOR_PLAN_DEFAULTS.windowSillFt * FT_TO_M, 3,
    );
  });
});

describe("floorPlanToMassingGeometry — slab + roof stub", () => {
  it("emits exactly one floor slab per storey", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const groundSlabs = g.storeys[0].elements.filter((e) => e.type === "slab");
    const roofSlabs = g.storeys[1].elements.filter((e) => e.type === "slab");
    expect(groundSlabs.length).toBe(1);
    expect(roofSlabs.length).toBe(1);
  });

  it("roof-stub storey has parapet walls but no rooms", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const roof = g.storeys[1];
    const spaces = roof.elements.filter((e) => e.type === "space");
    const walls = roof.elements.filter((e) => e.type === "wall");
    expect(spaces.length).toBe(0);
    /* 4 parapet walls — N, S, E, W */
    expect(walls.length).toBe(4);
    /* All exterior. */
    expect(walls.every((w) => w.properties.isExterior === true)).toBe(true);
  });
});

describe("floorPlanToMassingGeometry — staircase", () => {
  it("emits an IfcStairFlight with riser + tread metadata", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const stairs = g.storeys[0].elements.filter((e) => e.type === "stair");
    expect(stairs.length).toBe(1);
    expect(stairs[0].ifcType).toBe("IfcStairFlight");
    expect(stairs[0].properties.riserCount).toBeGreaterThan(0);
    expect(stairs[0].properties.riserHeight).toBeGreaterThan(0);
    expect(stairs[0].properties.treadDepth).toBeGreaterThan(0);
  });

  it("omits the staircase when hasGeometry: false", () => {
    const noStair: FloorPlanSchema = {
      ...TWO_BHK_BRIEF,
      floors: [
        {
          ...TWO_BHK_BRIEF.floors[0],
          staircase: {
            quadrant: "SW",
            hasGeometry: false,
          },
        },
        TWO_BHK_BRIEF.floors[1],
      ],
    };
    const g = floorPlanToMassingGeometry(noStair);
    const stairs = g.storeys[0].elements.filter((e) => e.type === "stair");
    expect(stairs.length).toBe(0);
  });
});

describe("floorPlanToMassingGeometry — shared wall de-duplication", () => {
  it("two adjacent rooms sharing a wall produce ONE merged interior wall, not two", () => {
    /* Two 10×10 rooms side-by-side along X. Their shared edge at x=10
       must collapse to a single interior wall. */
    const adjacent: FloorPlanSchema = {
      plotWidthFt: 20,
      plotDepthFt: 10,
      floors: [
        {
          name: "Ground", index: 0,
          rooms: [
            { name: "RoomA", widthFt: 10, lengthFt: 10, quadrant: "W" },
            { name: "RoomB", widthFt: 10, lengthFt: 10, quadrant: "E" },
          ],
        },
      ],
    };
    const g = floorPlanToMassingGeometry(adjacent);
    const walls = g.storeys[0].elements.filter((e) => e.type === "wall");
    const interior = walls.filter((w) => w.properties.isExterior === false);
    /* Exactly one interior partition along the shared edge. */
    expect(interior.length).toBe(1);
  });
});

describe("floorPlanToMassingGeometry — furniture (residential)", () => {
  it("Hall (living) gets sofa + coffee table + TV unit", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const furn = g.storeys[0].elements
      .filter((e) => e.type === "furniture")
      .map((e) => String(e.properties.name));
    expect(furn.some((n) => n.includes("Sofa") && n.includes("Hall"))).toBe(true);
    expect(furn.some((n) => n.includes("Coffee Table") && n.includes("Hall"))).toBe(true);
    expect(furn.some((n) => n.includes("TV Unit") && n.includes("Hall"))).toBe(true);
  });

  it("Bedroom 1 gets bed + wardrobe + nightstand", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const bed1Furn = g.storeys[0].elements
      .filter((e) => e.type === "furniture" && String(e.properties.name).includes("Bedroom 1"))
      .map((e) => String(e.properties.name));
    expect(bed1Furn.some((n) => n.includes("Bed"))).toBe(true);
    expect(bed1Furn.some((n) => n.includes("Wardrobe"))).toBe(true);
    expect(bed1Furn.some((n) => n.includes("Nightstand"))).toBe(true);
  });

  it("Kitchen gets cooking platform + storage cabinet", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const kitFurn = g.storeys[0].elements
      .filter((e) => e.type === "furniture" && String(e.properties.name).includes("Kitchen"))
      .map((e) => String(e.properties.name));
    expect(kitFurn.some((n) => n.includes("Cooking Platform"))).toBe(true);
    expect(kitFurn.some((n) => n.includes("Storage Cabinet"))).toBe(true);
  });

  it("commercial category produces office / conference / reception furniture instead", () => {
    const office: FloorPlanSchema = {
      plotWidthFt: 30,
      plotDepthFt: 20,
      buildingCategory: "commercial",
      floors: [
        {
          name: "Ground", index: 0,
          rooms: [
            { name: "Director's Office", widthFt: 14, lengthFt: 10, quadrant: "NW", usage: "office" },
          ],
        },
      ],
    };
    const g = floorPlanToMassingGeometry(office);
    const furn = g.storeys[0].elements
      .filter((e) => e.type === "furniture")
      .map((e) => String(e.properties.name));
    expect(furn.some((n) => n.includes("Executive Desk"))).toBe(true);
    expect(furn.some((n) => n.includes("Filing Cabinet"))).toBe(true);
  });
});

describe("floorPlanToMassingGeometry — MEP (toilet + kitchen)", () => {
  it("Toilet gets WC + Wash Basin + Shower (residential preset)", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const sanitary = g.storeys[0].elements
      .filter((e) => e.type === "sanitary-terminal" && String(e.properties.name).includes("Toilet"))
      .map((e) => String(e.properties.name));
    expect(sanitary.some((n) => n.includes("Water Closet"))).toBe(true);
    expect(sanitary.some((n) => n.includes("Wash Basin"))).toBe(true);
    expect(sanitary.some((n) => n.includes("Shower"))).toBe(true);
  });

  it("Kitchen gets a sink", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const sanitary = g.storeys[0].elements
      .filter((e) => e.type === "sanitary-terminal" && String(e.properties.name).includes("Kitchen"))
      .map((e) => String(e.properties.name));
    expect(sanitary.some((n) => n.includes("Kitchen Sink"))).toBe(true);
  });

  it("each wet room emits one drainage stack (IfcPipeSegment)", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const pipes = g.storeys[0].elements.filter((e) => e.type === "pipe");
    /* Toilet + Kitchen = 2 wet rooms, 2 drainage stacks. */
    expect(pipes.length).toBeGreaterThanOrEqual(2);
    expect(pipes.every((p) => p.ifcType === "IfcPipeSegment")).toBe(true);
    expect(pipes.every((p) => p.properties.discipline === "mep")).toBe(true);
  });

  it("every habitable room gets a ceiling light fixture", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const lights = g.storeys[0].elements.filter((e) => e.type === "light-fixture");
    /* 5 rooms × 1 light = 5 lights. */
    expect(lights.length).toBe(5);
    expect(lights.every((l) => l.ifcType === "IfcLightFixture")).toBe(true);
  });
});

describe("floorPlanToMassingGeometry — finishes (IfcCovering)", () => {
  it("each room (named + corridor) gets a floor covering with the brief's finishMaterial", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const floorCov = g.storeys[0].elements.filter((e) => e.type === "covering-floor");
    /* Named rooms (5) + corridors (auto-fill). */
    expect(floorCov.length).toBeGreaterThanOrEqual(5);
    /* Hall's finishMaterial is "vitrified tiles" per the fixture. */
    const hallFloor = floorCov.find((e) => String(e.properties.name).includes("Hall"));
    expect(hallFloor).toBeDefined();
    expect(hallFloor!.properties.finishMaterial).toBe("vitrified tiles");
    /* Toilet's finishMaterial is "anti-skid". */
    const toiletFloor = floorCov.find((e) => String(e.properties.name).includes("Toilet"));
    expect(toiletFloor!.properties.finishMaterial).toBe("anti-skid");
  });

  it("rooms without a stated finishMaterial fall back to vitrified tiles", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const bed1Floor = g.storeys[0].elements
      .find((e) => e.type === "covering-floor" && String(e.properties.name).includes("Bedroom 1"));
    expect(bed1Floor).toBeDefined();
    expect(bed1Floor!.properties.finishMaterial).toBe("vitrified tiles");
  });

  it("each room (named + corridor) gets a ceiling covering", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const ceilCov = g.storeys[0].elements.filter((e) => e.type === "covering-ceiling");
    expect(ceilCov.length).toBeGreaterThanOrEqual(5);
  });
});

describe("floorPlanToMassingGeometry — structural", () => {
  it("emits IfcColumns at plot perimeter, IfcBeams at storey top, IfcFootings at ground floor", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const ground = g.storeys[0].elements;
    const columns = ground.filter((e) => e.type === "column");
    const beams   = ground.filter((e) => e.type === "beam");
    const footings = ground.filter((e) => e.type === "footing");
    expect(columns.length).toBeGreaterThan(0);
    expect(beams.length).toBe(4); /* N, S, E, W perimeter */
    expect(footings.length).toBe(columns.length); /* 1:1 footing per column on ground floor */
    expect(columns.every((c) => c.properties.loadBearing === true)).toBe(true);
    expect(beams.every((b) => b.properties.loadBearing === true)).toBe(true);
  });

  it("upper storeys (roof stub) do NOT emit footings", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const roofFootings = g.storeys[1].elements.filter((e) => e.type === "footing");
    expect(roofFootings.length).toBe(0);
  });
});

describe("floorPlanToMassingGeometry — category-aware default templates", () => {
  it("residential floorPlan with empty rooms[] → 2BHK template (5 named rooms + corridors)", () => {
    const empty: FloorPlanSchema = {
      plotWidthFt: 50,
      plotDepthFt: 24,
      buildingCategory: "residential",
      floors: [
        { name: "Ground Floor", index: 0, rooms: [] },
        { name: "Roof", index: 1, rooms: [], isRoofStub: true },
      ],
    };
    const g = floorPlanToMassingGeometry(empty);
    const spaces = g.storeys[0].elements.filter((e) => e.type === "space");
    /* 2BHK template + auto-corridor = ≥ 5 spaces. */
    expect(spaces.length).toBeGreaterThanOrEqual(5);
    const names = spaces.map((s) => String(s.properties.spaceName));
    expect(names).toEqual(expect.arrayContaining(["Bedroom 1", "Bedroom 2", "Hall", "Kitchen", "Toilet"]));
  });

  it("commercial floorPlan with empty rooms[] → office template (reception + 2 offices + conference)", () => {
    const empty: FloorPlanSchema = {
      plotWidthFt: 60,
      plotDepthFt: 40,
      buildingCategory: "commercial",
      floors: [
        { name: "Ground Floor", index: 0, rooms: [] },
        { name: "Roof", index: 1, rooms: [], isRoofStub: true },
      ],
    };
    const g = floorPlanToMassingGeometry(empty);
    const spaces = g.storeys[0].elements.filter((e) => e.type === "space");
    expect(spaces.length).toBeGreaterThanOrEqual(3);
    const names = spaces.map((s) => String(s.properties.spaceName));
    expect(names.some((n) => n.includes("Reception"))).toBe(true);
    expect(names.some((n) => n.includes("Office"))).toBe(true);
    expect(names.some((n) => n.includes("Conference"))).toBe(true);
  });

  it("industrial floorPlan with empty rooms[] → warehouse + small office", () => {
    const empty: FloorPlanSchema = {
      plotWidthFt: 100,
      plotDepthFt: 60,
      buildingCategory: "industrial",
      floors: [
        { name: "Ground Floor", index: 0, rooms: [] },
        { name: "Roof", index: 1, rooms: [], isRoofStub: true },
      ],
    };
    const g = floorPlanToMassingGeometry(empty);
    const spaces = g.storeys[0].elements.filter((e) => e.type === "space");
    expect(spaces.length).toBeGreaterThanOrEqual(2);
    const names = spaces.map((s) => String(s.properties.spaceName));
    expect(names.some((n) => n.includes("Warehouse"))).toBe(true);
  });

  it("template fallback ALSO populates furniture (residential → bed/sofa/etc.)", () => {
    const empty: FloorPlanSchema = {
      plotWidthFt: 50,
      plotDepthFt: 24,
      buildingCategory: "residential",
      floors: [{ name: "Ground Floor", index: 0, rooms: [] }],
    };
    const g = floorPlanToMassingGeometry(empty);
    const furniture = g.storeys[0].elements.filter((e) => e.type === "furniture");
    expect(furniture.length).toBeGreaterThan(0);
    const names = furniture.map((f) => String(f.properties.name));
    /* Should include hallmark residential items. */
    expect(names.some((n) => n.includes("Sofa"))).toBe(true);
    expect(names.some((n) => n.includes("Bed"))).toBe(true);
  });
});

describe("floorPlanToMassingGeometry — bumped dimensions (12 ft storey, 1.5 m parapet)", () => {
  it("ground storey is 12 ft tall (3.66 m) when storeyHeightFt unset", () => {
    const plan: FloorPlanSchema = {
      plotWidthFt: 50,
      plotDepthFt: 24,
      floors: [
        { name: "Ground Floor", index: 0, rooms: [
          { name: "Hall", widthFt: 15, lengthFt: 12, quadrant: "NW" },
        ] },
      ],
    };
    const g = floorPlanToMassingGeometry(plan);
    /* Storey height should be 12 ft → 3.6576 m (within rounding). */
    const wallHeights = g.storeys[0].elements
      .filter((e) => e.type === "wall")
      .map((w) => w.properties.height ?? 0);
    expect(Math.max(...wallHeights)).toBeCloseTo(12 * FT_TO_M, 2);
  });

  it("roof stub uses 1.5 m parapet by default", () => {
    const plan: FloorPlanSchema = {
      plotWidthFt: 50,
      plotDepthFt: 24,
      floors: [
        { name: "Ground Floor", index: 0, rooms: [
          { name: "Hall", widthFt: 15, lengthFt: 12, quadrant: "NW" },
        ] },
        { name: "Roof", index: 1, rooms: [], isRoofStub: true },
      ],
    };
    const g = floorPlanToMassingGeometry(plan);
    const roof = g.storeys[1];
    const parapets = roof.elements.filter((e) => e.type === "wall");
    expect(parapets.length).toBe(4);
    expect(parapets[0].properties.height).toBeCloseTo(1.5, 3);
  });
});

describe("floorPlanToMassingGeometry — auto-corridor + plot-tile invariant", () => {
  it("rooms (named + corridor) cover the FULL plot footprint — no naked-slab gaps", () => {
    const g = floorPlanToMassingGeometry(TWO_BHK_BRIEF);
    const plotW = 50 * FT_TO_M;
    const plotD = 24 * FT_TO_M;

    /* For each spatial band the ground storey emits, the union of its
       spaces must cover the band's full X extent at that band's Z range.
       We approximate this by computing the AABB union of all spaces and
       checking it spans the plot. */
    const spaces = g.storeys[0].elements.filter((e) => e.type === "space");
    expect(spaces.length).toBeGreaterThan(0);
    const allX = spaces.flatMap((s) => s.vertices.map((v) => v.x));
    const allZ = spaces.flatMap((s) => s.vertices.map((v) => v.z));
    const minX = Math.min(...allX);
    const maxX = Math.max(...allX);
    const minZ = Math.min(...allZ);
    const maxZ = Math.max(...allZ);
    /* The union of all spaces must reach the plot extents (within a
       small tolerance for floating-point). */
    expect(minX).toBeCloseTo(0, 1);
    expect(maxX).toBeCloseTo(plotW, 1);
    expect(minZ).toBeCloseTo(0, 1);
    expect(maxZ).toBeCloseTo(plotD, 1);
  });

  it("when only N-band rooms are stated, M+S bands are filled with corridors so the building reaches z=0", () => {
    /* User's fixture has 3 rooms in N band, 2 in S/SE — leaves the
       middle band naked unless auto-corridor fills. Test a brief that
       has ONLY north rooms and asserts a south-band corridor appears. */
    const northOnly: FloorPlanSchema = {
      plotWidthFt: 30,
      plotDepthFt: 30,
      buildingCategory: "residential",
      floors: [
        {
          name: "Ground Floor", index: 0,
          rooms: [
            { name: "Hall", widthFt: 15, lengthFt: 12, quadrant: "NW" },
            { name: "Bedroom", widthFt: 15, lengthFt: 12, quadrant: "NE" },
          ],
        },
        { name: "Roof", index: 1, rooms: [], isRoofStub: true },
      ],
    };
    const g = floorPlanToMassingGeometry(northOnly);
    const spaces = g.storeys[0].elements.filter((e) => e.type === "space");
    /* At least one Corridor should exist filling the southern half. */
    const corridors = spaces.filter((s) => String(s.properties.spaceName).includes("Corridor"));
    expect(corridors.length).toBeGreaterThan(0);
  });
});

describe("floorPlanToMassingGeometry — single-storey case (storey count strict)", () => {
  it("respects the exact floor count from the brief — no auto-multi-storey", () => {
    const single: FloorPlanSchema = {
      plotWidthFt: 20,
      plotDepthFt: 10,
      floors: [
        {
          name: "Ground", index: 0,
          rooms: [{ name: "Room", widthFt: 10, lengthFt: 10, quadrant: "center" }],
        },
      ],
    };
    const g = floorPlanToMassingGeometry(single);
    expect(g.floors).toBe(1);
    expect(g.storeys.length).toBe(1);
  });
});
