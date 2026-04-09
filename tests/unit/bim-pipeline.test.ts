import { describe, it, expect } from "vitest";
import { getMaterialForElement, getMaterialByName, getDisciplineColor, getStoreyColor } from "@/features/3d-render/services/material-mapping";
import { extractMetadata } from "@/services/metadata-extractor";
import type { MassingGeometry } from "@/types/geometry";

// ─── Material Mapping ────────────────────────────────────────────────────────

describe("material-mapping", () => {
  it("returns PBR material for known element types", () => {
    const wall = getMaterialForElement("wall");
    expect(wall.color).toBe(0xE8E0D4);
    expect(wall.roughness).toBeGreaterThan(0.5);
    expect(wall.metalness).toBe(0);

    const glass = getMaterialForElement("window");
    expect(glass.transparent).toBe(true);
    expect(glass.transmission).toBeGreaterThan(0);
    expect(glass.ior).toBeCloseTo(1.52);

    const column = getMaterialForElement("column");
    expect(column.metalness).toBeGreaterThan(0);
  });

  it("falls back to wall material for unknown types", () => {
    const unknown = getMaterialForElement("unknown-type");
    expect(unknown.color).toBe(0xE8E0D4); // wall color
  });

  it("overrides material by IFC material name", () => {
    const steel = getMaterialByName("structural_steel", "beam");
    expect(steel.metalness).toBe(0.9);
    expect(steel.color).toBe(0x707070);

    const brick = getMaterialByName("brick", "wall");
    expect(brick.color).toBe(0xC47860);
  });

  it("falls back to element type when material name unknown", () => {
    const mat = getMaterialByName("unknown_material_xyz", "column");
    expect(mat.color).toBe(getMaterialForElement("column").color);
  });

  it("returns discipline colors", () => {
    expect(getDisciplineColor("architectural")).toBe(0x4488CC);
    expect(getDisciplineColor("structural")).toBe(0xCC4444);
    expect(getDisciplineColor("mep")).toBe(0x44AA44);
    expect(getDisciplineColor("unknown")).toBe(0x888888);
  });

  it("returns storey colors cyclically", () => {
    const c0 = getStoreyColor(0);
    const c1 = getStoreyColor(1);
    expect(c0).not.toBe(c1);
    // Should cycle after palette length
    const c12 = getStoreyColor(12);
    expect(c12).toBe(c0);
  });
});

// ─── Metadata Extractor ──────────────────────────────────────────────────────

describe("metadata-extractor", () => {
  const mockGeometry: MassingGeometry = {
    buildingType: "Office Tower",
    floors: 2,
    totalHeight: 7.2,
    footprintArea: 400,
    gfa: 760,
    footprint: [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 },
    ],
    storeys: [
      {
        index: 0,
        name: "Ground Floor",
        elevation: 0,
        height: 3.6,
        elements: [
          {
            id: "wall-s0-w0",
            type: "wall",
            vertices: [],
            faces: [],
            ifcType: "IfcWall",
            properties: {
              name: "Wall S1-W1",
              storeyIndex: 0,
              height: 3.6,
              thickness: 0.25,
              area: 72,
              volume: 18,
              discipline: "architectural",
              isExterior: true,
            },
          },
          {
            id: "col-s0-c0",
            type: "column",
            vertices: [],
            faces: [],
            ifcType: "IfcColumn",
            properties: {
              name: "Column S1-C1",
              storeyIndex: 0,
              height: 3.6,
              radius: 0.3,
              discipline: "structural",
            },
          },
        ],
      },
      {
        index: 1,
        name: "Level 2",
        elevation: 3.6,
        height: 3.6,
        elements: [
          {
            id: "wall-s1-w0",
            type: "wall",
            vertices: [],
            faces: [],
            ifcType: "IfcWall",
            properties: {
              name: "Wall S2-W1",
              storeyIndex: 1,
              height: 3.6,
              thickness: 0.25,
              discipline: "architectural",
            },
          },
        ],
      },
    ],
    boundingBox: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 20, y: 20, z: 7.2 },
    },
    metrics: [
      { label: "GFA", value: "760", unit: "m²" },
    ],
  };

  it("extracts project info", () => {
    const meta = extractMetadata(mockGeometry);
    expect(meta.projectInfo.buildingType).toBe("Office Tower");
    expect(meta.projectInfo.floors).toBe(2);
    expect(meta.projectInfo.totalHeight).toBe(7.2);
    expect(meta.projectInfo.gfa).toBe(760);
  });

  it("extracts all elements keyed by ID", () => {
    const meta = extractMetadata(mockGeometry);
    expect(Object.keys(meta.elements)).toHaveLength(3);
    expect(meta.elements["wall-s0-w0"]).toBeDefined();
    expect(meta.elements["col-s0-c0"]).toBeDefined();
    expect(meta.elements["wall-s1-w0"]).toBeDefined();
  });

  it("preserves element properties", () => {
    const meta = extractMetadata(mockGeometry);
    const wall = meta.elements["wall-s0-w0"];
    expect(wall.ifcType).toBe("IfcWall");
    expect(wall.storeyName).toBe("Ground Floor");
    expect(wall.properties.thickness).toBe(0.25);
    expect(wall.properties.isExterior).toBe(true);
  });

  it("counts elements by type", () => {
    const meta = extractMetadata(mockGeometry);
    expect(meta.summary.totalElements).toBe(3);
    expect(meta.summary.elementsByType.wall).toBe(2);
    expect(meta.summary.elementsByType.column).toBe(1);
  });

  it("counts elements by discipline", () => {
    const meta = extractMetadata(mockGeometry);
    expect(meta.summary.elementsByDiscipline.architectural).toBe(2);
    expect(meta.summary.elementsByDiscipline.structural).toBe(1);
  });

  it("extracts storey info", () => {
    const meta = extractMetadata(mockGeometry);
    expect(meta.storeys).toHaveLength(2);
    expect(meta.storeys[0].name).toBe("Ground Floor");
    expect(meta.storeys[0].elementCount).toBe(2);
    expect(meta.storeys[1].name).toBe("Level 2");
    expect(meta.storeys[1].elevation).toBe(3.6);
  });

  it("includes version and timestamp", () => {
    const meta = extractMetadata(mockGeometry);
    expect(meta.version).toBe(1);
    expect(meta.generatedAt).toBeTruthy();
  });
});
