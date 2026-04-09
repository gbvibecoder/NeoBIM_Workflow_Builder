import { describe, it, expect } from "vitest";
import {
  shouldFilter,
  detectClashes,
  type AABB,
  type ElementBBox,
  type ClashDetectionOptions,
} from "@/features/3d-render/services/clash-detector";

// ─── Helper ────────────────────────────────────────────────────────

function makeElement(
  overrides: Partial<ElementBBox> & { aabb: AABB }
): ElementBBox {
  return {
    expressID: 1,
    typeID: 987401354, // IFCFLOWSEGMENT (pipe)
    type: "Pipe/Duct",
    name: "Test Element",
    storey: "Level 1",
    sourceModel: "Primary",
    ...overrides,
  };
}

// IFC type constants
const IFCWALL = 2391406946;
const IFCCOLUMN = 843113511;
const IFCBEAM = 753842376;
const IFCSLAB = 1529196076;
const IFCFLOWSEGMENT = 987401354;
const IFCSPACE = 3856911033;
const IFCOPENINGELEMENT = 3588315303;

// ─── Cross-Model shouldFilter ──────────────────────────────────────

describe("shouldFilter (cross-model)", () => {
  it("does NOT filter Column↔Wall across models (real coordination clash)", () => {
    const col = makeElement({
      typeID: IFCCOLUMN, type: "Column", sourceModel: "Structural",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const wall = makeElement({
      typeID: IFCWALL, type: "Wall", sourceModel: "Architecture",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(shouldFilter(col, wall)).toBe(false);
  });

  it("does NOT filter Column↔Slab across models", () => {
    const col = makeElement({
      typeID: IFCCOLUMN, type: "Column", sourceModel: "Structural",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const slab = makeElement({
      typeID: IFCSLAB, type: "Slab", sourceModel: "Architecture",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(shouldFilter(col, slab)).toBe(false);
  });

  it("does NOT filter Beam↔Slab across models", () => {
    const beam = makeElement({
      typeID: IFCBEAM, type: "Beam", sourceModel: "Structural",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const slab = makeElement({
      typeID: IFCSLAB, type: "Slab", sourceModel: "Architecture",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(shouldFilter(beam, slab)).toBe(false);
  });

  it("does NOT filter Pipe↔Beam across models (MEP vs structural)", () => {
    const pipe = makeElement({
      typeID: IFCFLOWSEGMENT, type: "Pipe/Duct", sourceModel: "MEP",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const beam = makeElement({
      typeID: IFCBEAM, type: "Beam", sourceModel: "Structural",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(shouldFilter(pipe, beam)).toBe(false);
  });

  it("still filters IfcOpeningElement across models (virtual)", () => {
    const opening = makeElement({
      typeID: IFCOPENINGELEMENT, type: "Opening", sourceModel: "Architecture",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const beam = makeElement({
      typeID: IFCBEAM, type: "Beam", sourceModel: "Structural",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(shouldFilter(opening, beam)).toBe(true);
  });

  it("still filters IfcSpace across models (virtual)", () => {
    const space = makeElement({
      typeID: IFCSPACE, type: "Space", sourceModel: "Architecture",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const pipe = makeElement({
      typeID: IFCFLOWSEGMENT, type: "Pipe/Duct", sourceModel: "MEP",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(shouldFilter(space, pipe)).toBe(true);
  });

  it("still filters Column↔Wall within same model", () => {
    const col = makeElement({
      typeID: IFCCOLUMN, type: "Column", sourceModel: "Architecture",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    const wall = makeElement({
      typeID: IFCWALL, type: "Wall", sourceModel: "Architecture",
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(shouldFilter(col, wall)).toBe(true);
  });
});

// ─── Cross-Model detectClashes ─────────────────────────────────────

describe("detectClashes (multi-model)", () => {
  it("detects cross-model MEP vs structural clash", () => {
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 100, typeID: IFCFLOWSEGMENT, type: "Pipe/Duct",
        name: "AC Duct D-045", sourceModel: "MEP",
        aabb: { min: [0, 0, 3], max: [5, 0.3, 3.3] },
      }),
      makeElement({
        expressID: 200, typeID: IFCBEAM, type: "Beam",
        name: "Beam B-012", sourceModel: "Structural",
        aabb: { min: [2, 0, 2.8], max: [3, 0.4, 3.4] },
      }),
    ];

    const clashes = detectClashes(elements, { tolerance: 0 });
    expect(clashes.length).toBe(1);
    expect(clashes[0].elementA.sourceModel).toBe("MEP");
    expect(clashes[0].elementB.sourceModel).toBe("Structural");
    expect(clashes[0].severity).toBe("hard");
  });

  it("includes sourceModel in clash result", () => {
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 1, typeID: IFCFLOWSEGMENT, sourceModel: "MEP",
        aabb: { min: [0, 0, 0], max: [2, 1, 1] },
      }),
      makeElement({
        expressID: 2, typeID: IFCBEAM, sourceModel: "Structural",
        aabb: { min: [0.5, 0, 0], max: [1.5, 1, 1] },
      }),
    ];

    const clashes = detectClashes(elements, { tolerance: 0 });
    expect(clashes[0].elementA.sourceModel).toBe("MEP");
    expect(clashes[0].elementB.sourceModel).toBe("Structural");
  });

  it("crossModelOnly skips within-model pairs", () => {
    const elements: ElementBBox[] = [
      // Two pipes from MEP model overlapping (same model)
      makeElement({
        expressID: 1, typeID: IFCFLOWSEGMENT, type: "Pipe/Duct",
        name: "Pipe 1", sourceModel: "MEP",
        aabb: { min: [0, 0, 0], max: [1, 1, 1] },
      }),
      makeElement({
        expressID: 2, typeID: IFCFLOWSEGMENT, type: "Pipe/Duct",
        name: "Pipe 2", sourceModel: "MEP",
        aabb: { min: [0, 0, 0], max: [1, 1, 1] },
      }),
      // Beam from structural model overlapping both pipes
      makeElement({
        expressID: 100, typeID: IFCBEAM, type: "Beam",
        name: "Beam 1", sourceModel: "Structural",
        aabb: { min: [0, 0, 0], max: [1, 1, 1] },
      }),
    ];

    // Without crossModelOnly: pipe-pipe + pipe-beam + pipe-beam = 3 clashes
    const allClashes = detectClashes(elements, { tolerance: 0 });
    expect(allClashes.length).toBe(3);

    // With crossModelOnly: only pipe-beam pairs = 2 clashes
    const crossOnly = detectClashes(elements, { tolerance: 0, crossModelOnly: true });
    expect(crossOnly.length).toBe(2);
    for (const c of crossOnly) {
      expect(c.elementA.sourceModel).not.toBe(c.elementB.sourceModel);
    }
  });

  it("handles elements with same expressID from different models", () => {
    // Both models have element #100 — should not cause dedup issues
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 100, typeID: IFCFLOWSEGMENT, type: "Pipe/Duct",
        name: "Pipe 100", sourceModel: "MEP",
        aabb: { min: [0, 0, 0], max: [2, 0.3, 0.3] },
      }),
      makeElement({
        expressID: 100, typeID: IFCBEAM, type: "Beam",
        name: "Beam 100", sourceModel: "Structural",
        aabb: { min: [0.5, 0, 0], max: [1.5, 0.4, 0.4] },
      }),
    ];

    const clashes = detectClashes(elements, { tolerance: 0 });
    expect(clashes.length).toBe(1);
    expect(clashes[0].elementA.name).toBe("Pipe 100");
    expect(clashes[0].elementB.name).toBe("Beam 100");
  });

  it("generates correct description for cross-model clash", () => {
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 1, typeID: IFCFLOWSEGMENT, type: "Pipe/Duct",
        name: "Pipe P-102", sourceModel: "MEP",
        aabb: { min: [0, 0, 0], max: [2, 1, 1] },
      }),
      makeElement({
        expressID: 2, typeID: IFCCOLUMN, type: "Column",
        name: "Column C-008", sourceModel: "Structural",
        aabb: { min: [0.5, 0, 0], max: [1.5, 1, 1] },
      }),
    ];

    const clashes = detectClashes(elements, { tolerance: 0 });
    expect(clashes[0].description).toBe('Pipe/Duct "Pipe P-102" clashes with Column "Column C-008"');
  });

  it("returns empty for non-overlapping cross-model elements", () => {
    const elements: ElementBBox[] = [
      makeElement({
        expressID: 1, typeID: IFCFLOWSEGMENT, sourceModel: "MEP",
        aabb: { min: [0, 0, 0], max: [1, 1, 1] },
      }),
      makeElement({
        expressID: 2, typeID: IFCBEAM, sourceModel: "Structural",
        aabb: { min: [10, 10, 10], max: [11, 11, 11] },
      }),
    ];

    const clashes = detectClashes(elements, { tolerance: 0.025 });
    expect(clashes.length).toBe(0);
  });
});
