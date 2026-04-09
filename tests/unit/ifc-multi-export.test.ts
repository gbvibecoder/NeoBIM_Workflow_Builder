import { describe, it, expect } from "vitest";
import { generateMassingGeometry } from "@/services/massing-generator";
import { generateIFCFile, generateMultipleIFCFiles } from "@/features/ifc/services/ifc-exporter";

// Generate a test building geometry once for all tests
const testGeometry = generateMassingGeometry({
  floors: 5,
  footprint_m2: 600,
  building_type: "Office Building",
  content: "5 storey office building rectangular",
});

// ─── generateMultipleIFCFiles ──────────────────────────────────────

describe("generateMultipleIFCFiles", () => {
  const files = generateMultipleIFCFiles(testGeometry, {
    projectName: "Test Project",
    buildingName: "Test Building",
  });

  it("returns 4 non-empty strings", () => {
    expect(files.architectural.length).toBeGreaterThan(100);
    expect(files.structural.length).toBeGreaterThan(100);
    expect(files.mep.length).toBeGreaterThan(100);
    expect(files.combined.length).toBeGreaterThan(100);
  });

  it("all files have valid IFC header", () => {
    for (const [key, content] of Object.entries(files)) {
      expect(content.startsWith("ISO-10303-21;"), `${key} missing IFC header`).toBe(true);
      expect(content.includes("FILE_SCHEMA(('IFC4'))"), `${key} missing IFC4 schema`).toBe(true);
      expect(content.includes("END-ISO-10303-21;"), `${key} missing IFC footer`).toBe(true);
    }
  });

  it("all files have spatial hierarchy (Project/Site/Building/Storeys)", () => {
    for (const [key, content] of Object.entries(files)) {
      expect(content.includes("IFCPROJECT"), `${key} missing IFCPROJECT`).toBe(true);
      expect(content.includes("IFCSITE"), `${key} missing IFCSITE`).toBe(true);
      expect(content.includes("IFCBUILDING("), `${key} missing IFCBUILDING`).toBe(true);
      expect(content.includes("IFCBUILDINGSTOREY"), `${key} missing IFCBUILDINGSTOREY`).toBe(true);
    }
  });

  it("architectural file contains walls, windows, doors", () => {
    expect(files.architectural).toContain("IFCWALL(");
    expect(files.architectural).toContain("IFCWINDOW(");
    expect(files.architectural).toContain("IFCDOOR(");
  });

  it("architectural file does NOT contain structural elements", () => {
    expect(files.architectural).not.toContain("IFCCOLUMN(");
    expect(files.architectural).not.toContain("IFCBEAM(");
  });

  it("structural file contains columns, beams, slabs", () => {
    expect(files.structural).toContain("IFCCOLUMN(");
    expect(files.structural).toContain("IFCBEAM(");
    expect(files.structural).toContain("IFCSLAB(");
  });

  it("structural file does NOT contain architectural elements", () => {
    expect(files.structural).not.toContain("IFCWALL(");
    expect(files.structural).not.toContain("IFCWINDOW(");
    expect(files.structural).not.toContain("IFCDOOR(");
  });

  it("MEP file contains duct and pipe segments", () => {
    expect(files.mep).toContain("IFCDUCTSEGMENT(");
    expect(files.mep).toContain("IFCPIPESEGMENT(");
  });

  it("MEP file contains cable tray segments", () => {
    expect(files.mep).toContain("IFCCABLECARRIERSEGMENT(");
  });

  it("MEP file contains equipment (flow terminal)", () => {
    expect(files.mep).toContain("IFCFLOWTERMINAL(");
  });

  it("combined file contains ALL element types", () => {
    expect(files.combined).toContain("IFCWALL(");
    expect(files.combined).toContain("IFCWINDOW(");
    expect(files.combined).toContain("IFCCOLUMN(");
    expect(files.combined).toContain("IFCBEAM(");
    expect(files.combined).toContain("IFCSLAB(");
    expect(files.combined).toContain("IFCDUCTSEGMENT(");
    expect(files.combined).toContain("IFCPIPESEGMENT(");
  });

  it("combined file is larger than individual discipline files", () => {
    expect(files.combined.length).toBeGreaterThan(files.architectural.length);
    expect(files.combined.length).toBeGreaterThan(files.structural.length);
    expect(files.combined.length).toBeGreaterThan(files.mep.length);
  });
});

// ─── Backward compatibility ────────────────────────────────────────

describe("generateIFCFile backward compatibility", () => {
  it("still works without filter option (defaults to all)", () => {
    const content = generateIFCFile(testGeometry, { projectName: "Test" });
    expect(content.startsWith("ISO-10303-21;")).toBe(true);
    expect(content).toContain("IFCWALL(");
    expect(content).toContain("IFCCOLUMN(");
    expect(content).toContain("IFCDUCTSEGMENT(");
  });
});

// ─── Enhanced geometry ─────────────────────────────────────────────

describe("Enhanced massing geometry", () => {
  it("has basement level for 5-floor building", () => {
    const basement = testGeometry.storeys.find(s => s.isBasement);
    expect(basement).toBeDefined();
    expect(basement!.index).toBe(-1);
    expect(basement!.elevation).toBeLessThan(0);
  });

  it("has roof parapet walls", () => {
    const roofStorey = testGeometry.storeys.find(s => s.name === "Roof");
    expect(roofStorey).toBeDefined();
    const parapets = roofStorey!.elements.filter(e => e.type === "parapet");
    expect(parapets.length).toBeGreaterThan(0);
  });

  it("has elevator shaft elements", () => {
    const groundFloor = testGeometry.storeys.find(s => s.index === 0);
    expect(groundFloor).toBeDefined();
    const shaftWalls = groundFloor!.elements.filter(e =>
      e.properties.name?.includes("Elevator Shaft")
    );
    expect(shaftWalls.length).toBeGreaterThan(0);
  });

  it("has MEP elements on each floor", () => {
    const groundFloor = testGeometry.storeys.find(s => s.index === 0);
    expect(groundFloor).toBeDefined();
    const mepElements = groundFloor!.elements.filter(e =>
      e.properties.discipline === "mep"
    );
    expect(mepElements.length).toBeGreaterThan(5); // ducts + pipes + cable tray + equipment
  });

  it("has discipline tags on all elements", () => {
    for (const storey of testGeometry.storeys) {
      for (const element of storey.elements) {
        if (element.type === "space") continue; // spaces don't always have discipline
        expect(
          element.properties.discipline,
          `Element ${element.id} (${element.type}) missing discipline tag`
        ).toBeDefined();
      }
    }
  });

  it("ground floor has taller height than upper floors", () => {
    const ground = testGeometry.storeys.find(s => s.index === 0);
    const level2 = testGeometry.storeys.find(s => s.index === 1);
    expect(ground).toBeDefined();
    expect(level2).toBeDefined();
    expect(ground!.height).toBeGreaterThanOrEqual(4.5);
    expect(ground!.height).toBeGreaterThan(level2!.height);
  });
});
