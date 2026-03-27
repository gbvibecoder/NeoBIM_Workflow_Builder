import { describe, it, expect } from "vitest";
import {
  aabbOverlap,
  classifySeverity,
  shouldFilter,
  buildSpatialGrid,
  detectClashes,
  type AABB,
  type ElementBBox,
} from "@/services/clash-detector";

// ─── Helper to create ElementBBox ──────────────────────────────────

function makeElement(
  overrides: Partial<ElementBBox> & { aabb: AABB }
): ElementBBox {
  return {
    expressID: 1,
    typeID: 987401354, // IFCFLOWSEGMENT (pipe) by default
    type: "Pipe/Duct",
    name: "Test Element",
    storey: "Level 1",
    sourceModel: "Primary",
    ...overrides,
  };
}

// IFC type constants (matching clash-detector.ts)
const IFCWALL = 2391406946;
const IFCWALLSTANDARDCASE = 3512223829;
const IFCSLAB = 1529196076;
const IFCCOLUMN = 843113511;
const IFCBEAM = 753842376;
const IFCDOOR = 395920057;
const IFCWINDOW = 3304561284;
const IFCCOVERING = 1973544240;
const IFCFOOTING = 900683007;
const IFCSTAIR = 331165859;
const IFCFLOWSEGMENT = 987401354;
const IFCFLOWTERMINAL = 2058353004;
const IFCSPACE = 3856911033;
const IFCOPENINGELEMENT = 3588315303;

// ─── aabbOverlap ───────────────────────────────────────────────────

describe("aabbOverlap", () => {
  it("detects overlapping boxes and returns volume + center", () => {
    const a: AABB = { min: [0, 0, 0], max: [2, 2, 2] };
    const b: AABB = { min: [1, 1, 1], max: [3, 3, 3] };
    const result = aabbOverlap(a, b, 0);
    expect(result).not.toBeNull();
    expect(result!.volume).toBe(1); // 1×1×1
    expect(result!.center).toEqual([1.5, 1.5, 1.5]);
  });

  it("returns null for separated boxes", () => {
    const a: AABB = { min: [0, 0, 0], max: [1, 1, 1] };
    const b: AABB = { min: [5, 5, 5], max: [6, 6, 6] };
    expect(aabbOverlap(a, b, 0)).toBeNull();
  });

  it("returns null when overlap is less than tolerance", () => {
    // Boxes touch with 0.01m overlap on X axis
    const a: AABB = { min: [0, 0, 0], max: [1, 1, 1] };
    const b: AABB = { min: [0.99, 0, 0], max: [2, 1, 1] };
    // tolerance = 0.025 → 0.01 overlap < tolerance → null
    expect(aabbOverlap(a, b, 0.025)).toBeNull();
  });

  it("returns null when boxes only touch on one face (zero overlap)", () => {
    const a: AABB = { min: [0, 0, 0], max: [1, 1, 1] };
    const b: AABB = { min: [1, 0, 0], max: [2, 1, 1] };
    // X overlap = 0 (touching face), should be null even with zero tolerance
    expect(aabbOverlap(a, b, 0)).toBeNull();
  });

  it("handles asymmetric overlap correctly", () => {
    const a: AABB = { min: [0, 0, 0], max: [3, 1, 1] };
    const b: AABB = { min: [2, 0.5, 0.5], max: [4, 2, 2] };
    const result = aabbOverlap(a, b, 0);
    expect(result).not.toBeNull();
    // X overlap = 1, Y overlap = 0.5, Z overlap = 0.5
    expect(result!.volume).toBeCloseTo(0.25);
  });

  it("detects overlap when it exceeds tolerance", () => {
    const a: AABB = { min: [0, 0, 0], max: [1, 1, 1] };
    const b: AABB = { min: [0.9, 0, 0], max: [2, 1, 1] };
    // 0.1m overlap on X > 0.025 tolerance, 1.0m on Y and Z
    const result = aabbOverlap(a, b, 0.025);
    expect(result).not.toBeNull();
    expect(result!.volume).toBeCloseTo(0.1);
  });
});

// ─── classifySeverity ──────────────────────────────────────────────

describe("classifySeverity", () => {
  it("classifies MEP vs structural as hard clash", () => {
    const pipe = makeElement({
      typeID: IFCFLOWSEGMENT,
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const beam = makeElement({
      typeID: IFCBEAM,
      type: "Beam",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(classifySeverity(pipe, beam, 0.05)).toBe("hard");
  });

  it("classifies MEP vs MEP as hard clash", () => {
    const pipe1 = makeElement({
      expressID: 1,
      typeID: IFCFLOWSEGMENT,
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const pipe2 = makeElement({
      expressID: 2,
      typeID: IFCFLOWTERMINAL,
      type: "Terminal",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(classifySeverity(pipe1, pipe2, 0.05)).toBe("hard");
  });

  it("classifies large overlap (>0.1 m³) as hard", () => {
    const wall1 = makeElement({
      typeID: IFCWALL,
      type: "Wall",
      storey: "Level 1",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const wall2 = makeElement({
      typeID: IFCWALL,
      type: "Wall",
      storey: "Level 2", // different storey so not filtered
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(classifySeverity(wall1, wall2, 0.2)).toBe("hard");
  });

  it("classifies medium overlap (>0.001 m³) as soft", () => {
    const a = makeElement({
      typeID: IFCWALL,
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const b = makeElement({
      typeID: IFCWALL,
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(classifySeverity(a, b, 0.01)).toBe("soft");
  });

  it("classifies small overlap as clearance", () => {
    const a = makeElement({
      typeID: IFCWALL,
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const b = makeElement({
      typeID: IFCWALL,
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(classifySeverity(a, b, 0.0005)).toBe("clearance");
  });
});

// ─── shouldFilter ──────────────────────────────────────────────────

describe("shouldFilter", () => {
  it("filters Wall↔Wall same storey", () => {
    const a = makeElement({ typeID: IFCWALL, storey: "Level 1", aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const b = makeElement({ typeID: IFCWALLSTANDARDCASE, storey: "Level 1", aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(a, b)).toBe(true);
  });

  it("does NOT filter Wall↔Wall different storey", () => {
    const a = makeElement({ typeID: IFCWALL, storey: "Level 1", aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const b = makeElement({ typeID: IFCWALL, storey: "Level 2", aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(a, b)).toBe(false);
  });

  it("filters Wall↔Slab", () => {
    const wall = makeElement({ typeID: IFCWALL, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const slab = makeElement({ typeID: IFCSLAB, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(wall, slab)).toBe(true);
  });

  it("filters Column↔Slab", () => {
    const col = makeElement({ typeID: IFCCOLUMN, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const slab = makeElement({ typeID: IFCSLAB, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(col, slab)).toBe(true);
  });

  it("filters Column↔Beam", () => {
    const col = makeElement({ typeID: IFCCOLUMN, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const beam = makeElement({ typeID: IFCBEAM, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(col, beam)).toBe(true);
  });

  it("filters Door↔Wall", () => {
    const door = makeElement({ typeID: IFCDOOR, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const wall = makeElement({ typeID: IFCWALL, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(door, wall)).toBe(true);
  });

  it("filters Window↔Wall", () => {
    const win = makeElement({ typeID: IFCWINDOW, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const wall = makeElement({ typeID: IFCWALLSTANDARDCASE, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(win, wall)).toBe(true);
  });

  it("filters Covering↔Wall", () => {
    const cov = makeElement({ typeID: IFCCOVERING, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const wall = makeElement({ typeID: IFCWALL, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(cov, wall)).toBe(true);
  });

  it("filters Footing↔Column", () => {
    const foot = makeElement({ typeID: IFCFOOTING, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const col = makeElement({ typeID: IFCCOLUMN, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(foot, col)).toBe(true);
  });

  it("filters Stair↔Slab", () => {
    const stair = makeElement({ typeID: IFCSTAIR, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const slab = makeElement({ typeID: IFCSLAB, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(stair, slab)).toBe(true);
  });

  it("always filters IfcOpeningElement", () => {
    const opening = makeElement({ typeID: IFCOPENINGELEMENT, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const beam = makeElement({ typeID: IFCBEAM, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(opening, beam)).toBe(true);
  });

  it("always filters IfcSpace", () => {
    const space = makeElement({ typeID: IFCSPACE, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const pipe = makeElement({ typeID: IFCFLOWSEGMENT, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(space, pipe)).toBe(true);
  });

  it("filters Beam↔Slab (beams support slabs)", () => {
    const beam = makeElement({ typeID: IFCBEAM, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const slab = makeElement({ typeID: IFCSLAB, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(beam, slab)).toBe(true);
  });

  it("filters Column↔Wall (columns embedded in walls)", () => {
    const col = makeElement({ typeID: IFCCOLUMN, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const wall = makeElement({ typeID: IFCWALL, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(col, wall)).toBe(true);
  });

  it("filters Column↔WallStandardCase (columns embedded in walls)", () => {
    const col = makeElement({ typeID: IFCCOLUMN, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const wall = makeElement({ typeID: IFCWALLSTANDARDCASE, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(col, wall)).toBe(true);
  });

  it("filters Beam↔Wall (beams span across walls)", () => {
    const beam = makeElement({ typeID: IFCBEAM, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const wall = makeElement({ typeID: IFCWALL, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(beam, wall)).toBe(true);
  });

  it("filters in reverse order (Slab↔Wall = same as Wall↔Slab)", () => {
    const slab = makeElement({ typeID: IFCSLAB, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const wall = makeElement({ typeID: IFCWALL, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(slab, wall)).toBe(true);
  });

  it("filters Covering↔Slab", () => {
    const cov = makeElement({ typeID: IFCCOVERING, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const slab = makeElement({ typeID: IFCSLAB, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(cov, slab)).toBe(true);
  });

  it("does NOT filter Pipe↔Column (MEP vs structural = real clash)", () => {
    const pipe = makeElement({ typeID: IFCFLOWSEGMENT, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const col = makeElement({ typeID: IFCCOLUMN, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(pipe, col)).toBe(false);
  });

  it("does NOT filter Fitting↔Slab (MEP vs structural = real clash)", () => {
    const fitting = makeElement({ typeID: 4278956645, aabb: { min: [0, 0, 0], max: [1, 1, 1] } }); // IFCFLOWFITTING
    const slab = makeElement({ typeID: IFCSLAB, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(fitting, slab)).toBe(false);
  });

  it("does NOT filter Pipe↔Wall (MEP vs architectural = real clash)", () => {
    const pipe = makeElement({ typeID: IFCFLOWSEGMENT, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const wall = makeElement({ typeID: IFCWALL, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(pipe, wall)).toBe(false);
  });

  it("does NOT filter Pipe↔Beam (MEP vs structural = real clash)", () => {
    const pipe = makeElement({ typeID: IFCFLOWSEGMENT, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    const beam = makeElement({ typeID: IFCBEAM, aabb: { min: [0, 0, 0], max: [1, 1, 1] } });
    expect(shouldFilter(pipe, beam)).toBe(false);
  });
});

// ─── buildSpatialGrid ──────────────────────────────────────────────

describe("buildSpatialGrid", () => {
  it("places elements in correct grid cells", () => {
    const elements: ElementBBox[] = [
      makeElement({ expressID: 1, aabb: { min: [0, 0, 0], max: [1, 1, 1] } }),
      makeElement({ expressID: 2, aabb: { min: [10, 10, 10], max: [11, 11, 11] } }),
    ];
    const grid = buildSpatialGrid(elements, 2.0);

    // Element 0 at (0-1) → cell (0,0,0)
    const cell0 = grid.get("0,0,0");
    expect(cell0).toContain(0);
    expect(cell0).not.toContain(1);

    // Element 1 at (10-11) → cell (5,5,5)
    const cell1 = grid.get("5,5,5");
    expect(cell1).toContain(1);
    expect(cell1).not.toContain(0);
  });

  it("handles negative coordinates in grid", () => {
    const elements: ElementBBox[] = [
      makeElement({ expressID: 1, aabb: { min: [-3, -3, -3], max: [-1, -1, -1] } }),
    ];
    const grid = buildSpatialGrid(elements, 2.0);
    // Element spans from (-3,-3,-3) to (-1,-1,-1)
    // Cell keys: floor(-3/2)=-2, floor(-1/2)=-1 → spans (-2,-2,-2) to (-1,-1,-1) = 2x2x2 = 8 cells
    let cellCount = 0;
    for (const indices of grid.values()) {
      if (indices.includes(0)) cellCount++;
    }
    expect(cellCount).toBe(8);
  });

  it("co-locates overlapping elements in same cells", () => {
    const elements: ElementBBox[] = [
      makeElement({ expressID: 1, aabb: { min: [0, 0, 0], max: [1, 1, 1] } }),
      makeElement({ expressID: 2, aabb: { min: [0.5, 0.5, 0.5], max: [1.5, 1.5, 1.5] } }),
    ];
    const grid = buildSpatialGrid(elements, 2.0);
    // Both should be in cell (0,0,0)
    const cell = grid.get("0,0,0");
    expect(cell).toContain(0);
    expect(cell).toContain(1);
  });

  it("places large elements in multiple cells", () => {
    const elements: ElementBBox[] = [
      makeElement({ expressID: 1, aabb: { min: [0, 0, 0], max: [5, 5, 5] } }),
    ];
    const grid = buildSpatialGrid(elements, 2.0);
    // Should span cells (0,0,0) through (2,2,2) → 3×3×3 = 27 cells
    let cellCount = 0;
    for (const indices of grid.values()) {
      if (indices.includes(0)) cellCount++;
    }
    expect(cellCount).toBe(27);
  });
});

// ─── detectClashes ─────────────────────────────────────────────────

describe("detectClashes", () => {
  it("returns empty list for empty model", () => {
    const clashes = detectClashes([], { tolerance: 0.025 });
    expect(clashes).toEqual([]);
  });

  it("detects overlapping elements", () => {
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 100,
        typeID: IFCFLOWSEGMENT,
        type: "Pipe/Duct",
        name: "Pipe 1",
        aabb: { min: [0, 0, 0], max: [2, 0.3, 0.3] },
      }),
      makeElement({
        expressID: 200,
        typeID: IFCBEAM,
        type: "Beam",
        name: "Beam 1",
        aabb: { min: [0.5, 0, 0], max: [1.5, 0.5, 0.5] },
      }),
    ];

    const clashes = detectClashes(elements, { tolerance: 0.025 });
    expect(clashes.length).toBe(1);
    expect(clashes[0].elementA.expressID).toBe(100);
    expect(clashes[0].elementB.expressID).toBe(200);
    expect(clashes[0].severity).toBe("hard"); // MEP vs structural
  });

  it("does not report separated elements", () => {
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 1,
        typeID: IFCFLOWSEGMENT,
        aabb: { min: [0, 0, 0], max: [1, 1, 1] },
      }),
      makeElement({
        expressID: 2,
        typeID: IFCBEAM,
        aabb: { min: [10, 10, 10], max: [11, 11, 11] },
      }),
    ];
    const clashes = detectClashes(elements, { tolerance: 0.025 });
    expect(clashes.length).toBe(0);
  });

  it("respects maxClashes cap", () => {
    // Create many overlapping pipe elements
    const elements: ElementBBox[] = [];
    for (let i = 0; i < 20; i++) {
      elements.push(
        makeElement({
          expressID: i + 1,
          typeID: IFCFLOWSEGMENT,
          type: "Pipe/Duct",
          name: `Pipe ${i}`,
          aabb: { min: [0, 0, 0], max: [1, 1, 1] }, // All overlap
        })
      );
    }

    const clashes = detectClashes(elements, { tolerance: 0, maxClashes: 5 });
    expect(clashes.length).toBe(5);
  });

  it("deduplicates clashes across grid cells", () => {
    // A large element spanning multiple grid cells should only produce one clash per pair
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 1,
        typeID: IFCFLOWSEGMENT,
        type: "Pipe/Duct",
        name: "Long Pipe",
        aabb: { min: [0, 0, 0], max: [10, 0.2, 0.2] }, // Spans many cells
      }),
      makeElement({
        expressID: 2,
        typeID: IFCBEAM,
        type: "Beam",
        name: "Long Beam",
        aabb: { min: [0, 0, 0], max: [10, 0.3, 0.3] }, // Overlaps pipe across many cells
      }),
    ];

    const clashes = detectClashes(elements, { tolerance: 0, cellSize: 2.0 });
    // Should find exactly 1 clash, not 5+ (one per grid cell)
    expect(clashes.length).toBe(1);
  });

  it("assigns correct clash IDs", () => {
    const elements: ElementBBox[] = [];
    for (let i = 0; i < 5; i++) {
      elements.push(
        makeElement({
          expressID: i + 1,
          typeID: IFCFLOWSEGMENT,
          type: "Pipe/Duct",
          name: `Pipe ${i}`,
          aabb: { min: [0, 0, 0], max: [1, 1, 1] },
        })
      );
    }

    const clashes = detectClashes(elements, { tolerance: 0 });
    // IDs should be sequential
    expect(clashes[0].id).toBe("clash-1");
    expect(clashes[1].id).toBe("clash-2");
    expect(clashes[2].id).toBe("clash-3");
  });

  it("calculates correct overlap volume and center", () => {
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 1,
        typeID: IFCFLOWSEGMENT,
        type: "Pipe/Duct",
        aabb: { min: [0, 0, 0], max: [2, 2, 2] },
      }),
      makeElement({
        expressID: 2,
        typeID: IFCBEAM,
        type: "Beam",
        aabb: { min: [1, 1, 1], max: [3, 3, 3] },
      }),
    ];

    const clashes = detectClashes(elements, { tolerance: 0 });
    expect(clashes.length).toBe(1);
    expect(clashes[0].overlapVolume).toBe(1); // 1×1×1
    expect(clashes[0].overlapCenter).toEqual([1.5, 1.5, 1.5]);
  });

  it("generates correct description", () => {
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 1,
        typeID: IFCFLOWSEGMENT,
        type: "Pipe/Duct",
        name: "AC Duct D-045",
        aabb: { min: [0, 0, 0], max: [2, 1, 1] },
      }),
      makeElement({
        expressID: 2,
        typeID: IFCBEAM,
        type: "Beam",
        name: "Beam B-012",
        aabb: { min: [0.5, 0, 0], max: [1.5, 1, 1] },
      }),
    ];

    const clashes = detectClashes(elements, { tolerance: 0 });
    expect(clashes[0].description).toBe('Pipe/Duct "AC Duct D-045" clashes with Beam "Beam B-012"');
  });

  it("handles single element (no pairs possible)", () => {
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 1,
        typeID: IFCFLOWSEGMENT,
        aabb: { min: [0, 0, 0], max: [1, 1, 1] },
      }),
    ];
    const clashes = detectClashes(elements, { tolerance: 0.025 });
    expect(clashes.length).toBe(0);
  });

  it("handles negative coordinates correctly", () => {
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 1,
        typeID: IFCFLOWSEGMENT,
        type: "Pipe/Duct",
        aabb: { min: [-5, -5, -5], max: [-3, -3, -3] },
      }),
      makeElement({
        expressID: 2,
        typeID: IFCBEAM,
        type: "Beam",
        aabb: { min: [-4, -4, -4], max: [-2, -2, -2] },
      }),
    ];

    const clashes = detectClashes(elements, { tolerance: 0 });
    expect(clashes.length).toBe(1);
    expect(clashes[0].overlapVolume).toBe(1); // 1×1×1 overlap
  });

  it("filters out wall-wall same storey clashes", () => {
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 1,
        typeID: IFCWALL,
        type: "Wall",
        storey: "Level 1",
        aabb: { min: [0, 0, 0], max: [2, 0.3, 3] },
      }),
      makeElement({
        expressID: 2,
        typeID: IFCWALLSTANDARDCASE,
        type: "Wall",
        storey: "Level 1",
        aabb: { min: [1.5, 0, 0], max: [4, 0.3, 3] },
      }),
    ];

    const clashes = detectClashes(elements, { tolerance: 0 });
    expect(clashes.length).toBe(0);
  });
});
