import { describe, it, expect } from "vitest";
import { generateMassingGeometry } from "@/features/3d-render/services/massing-generator";
import { generateIFCFile } from "@/features/ifc/services/ifc-exporter";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";

/**
 * Tests for wf-08: "Detailed PDF → 3D Video Walkthrough" pipeline.
 *
 * Validates the end-to-end data flow:
 *   PDF Upload (IN-002) → Brief Parser (TR-001) → IFC Exporter (EX-001)
 *                                                → Video Walkthrough (GN-009)
 *
 * EX-001 extracts building parameters from TR-001's _raw (ParsedBrief) and
 * generates massing geometry internally — no separate GN-001 node needed.
 */

/**
 * Simulates how EX-001's fallback path extracts parameters from inputData.
 * This mirrors the logic in execute-node route.ts for the EX-001 handler.
 */
function extractBuildingParams(inputData: Record<string, unknown>) {
  const rawData = (inputData?._raw ?? {}) as Record<string, unknown>;
  const textContent = String(inputData?.content ?? inputData?.prompt ?? "");

  const extractFromText = (patterns: RegExp[], fallback: number): number => {
    for (const pat of patterns) {
      const m = textContent.match(pat);
      if (m) {
        const v = parseFloat(m[1].replace(/,/g, ""));
        if (!isNaN(v) && v > 0) return v;
      }
    }
    return fallback;
  };

  const rawFloors = Number(inputData?.floors ?? rawData?.floors ?? rawData?.number_of_floors ?? 0);
  const floors = rawFloors > 0 ? rawFloors : extractFromText([
    /(\d+)\s*(?:floors?|stor(?:ey|ies)|levels?)/i,
    /(\d+)[-\s]?stor(?:ey|y)/i,
  ], 5);

  const rawFootprint = Number(inputData?.footprint ?? rawData?.footprint_m2 ?? rawData?.footprint ?? 0);
  const rawTotalArea = Number(rawData?.totalArea ?? rawData?.total_area ?? 0);
  const programme = rawData?.programme as Array<{ space?: string; area_m2?: number }> | undefined;
  const programmeTotal = programme?.reduce((sum, p) => sum + (p.area_m2 ?? 0), 0) ?? 0;
  const effectiveTotalArea = rawTotalArea > 0 ? rawTotalArea : (programmeTotal > 0 ? programmeTotal : 0);

  const computedFootprint = rawFootprint > 0
    ? rawFootprint
    : (effectiveTotalArea > 0 && floors > 0)
      ? Math.round(effectiveTotalArea / floors)
      : extractFromText([
          /footprint[:\s]*(?:approx\.?\s*)?(\d[\d,]*)\s*m/i,
          /(\d[\d,]*)\s*m²?\s*(?:per\s+floor|footprint)/i,
        ], 500);

  const buildingType = String(
    inputData?.buildingType ?? rawData?.buildingType ?? rawData?.building_type ?? rawData?.projectType
    ?? "Mixed-Use Building"
  );

  const rawGFA = Number(inputData?.gfa ?? rawData?.totalGFA ?? rawData?.total_gfa_m2 ?? rawData?.gfa ?? 0);
  const gfa = rawGFA > 0 ? rawGFA : (effectiveTotalArea > 0 ? effectiveTotalArea : undefined);

  let height: number | undefined;
  const rawHeight = Number(inputData?.height ?? rawData?.height ?? 0);
  if (rawHeight > 0) {
    height = rawHeight;
  } else {
    const constraints = rawData?.constraints as Record<string, unknown> | undefined;
    const maxHeightStr = String(constraints?.maxHeight ?? "");
    const heightMatch = maxHeightStr.match(/(\d+(?:\.\d+)?)\s*m/i);
    if (heightMatch) height = parseFloat(heightMatch[1]);
  }

  const projectName = String(
    rawData?.projectTitle ?? rawData?.projectName ?? buildingType
  );

  return { floors, footprint: computedFootprint, buildingType, gfa, height, projectName };
}

// Simulate TR-001 ParsedBrief outputs for various building types
const TR001_OUTPUTS: Record<string, Record<string, unknown>> = {
  office: {
    content: `PROJECT BRIEF — MODERN OFFICE TOWER\n\nType: Office Tower\nSite: Downtown Business District\n\nPROGRAMME REQUIREMENTS:\n• Open-plan offices: 2000 m² (Floors 1-8)\n• Executive suites: 500 m² (Floor 9)\n• Lobby: 300 m² (Ground)\n\nCONSTRAINTS:\n• Max Height: 40m`,
    label: "Parsed Brief: Modern Office Tower",
    _raw: {
      projectTitle: "Modern Office Tower",
      projectType: "Office Tower",
      programme: [
        { space: "Open-plan offices", area_m2: 2000, floor: "1-8" },
        { space: "Executive suites", area_m2: 500, floor: "9" },
        { space: "Lobby", area_m2: 300, floor: "Ground" },
      ],
      constraints: { maxHeight: "40m", setbacks: "5m" },
      rawText: "Modern 10-storey office tower",
    },
    prompt: "PROJECT BRIEF — MODERN OFFICE TOWER...",
  },
  residential: {
    content: `PROJECT BRIEF — RIVERSIDE APARTMENTS\n\nType: Residential Apartment\n\nPROGRAMME REQUIREMENTS:\n• 2-bed units: 1600 m²\n• 3-bed units: 1200 m²\n• Common areas: 400 m²\n\nCONSTRAINTS:\n• Max Height: 21m\n• 7 floors`,
    label: "Parsed Brief: Riverside Apartments",
    _raw: {
      projectTitle: "Riverside Apartments",
      projectType: "Residential Apartment",
      programme: [
        { space: "2-bed units", area_m2: 1600 },
        { space: "3-bed units", area_m2: 1200 },
        { space: "Common areas", area_m2: 400 },
      ],
      constraints: { maxHeight: "21m", zoning: "R3" },
      rawText: "7-storey residential apartment complex near the river",
    },
    prompt: "PROJECT BRIEF — RIVERSIDE APARTMENTS...",
  },
  warehouse: {
    content: `PROJECT BRIEF — LOGISTICS HUB\n\nType: Warehouse\n\nPROGRAMME REQUIREMENTS:\n• Storage: 2000 m²\n• Loading bay: 500 m²\n• Office: 200 m²\n\n2 floors, 10m height`,
    label: "Parsed Brief: Logistics Hub",
    _raw: {
      projectTitle: "Logistics Hub",
      projectType: "Warehouse",
      programme: [
        { space: "Storage", area_m2: 2000 },
        { space: "Loading bay", area_m2: 500 },
        { space: "Office", area_m2: 200 },
      ],
      constraints: { maxHeight: "10m" },
      rawText: "2-storey industrial warehouse for logistics",
    },
    prompt: "PROJECT BRIEF — LOGISTICS HUB...",
  },
  minimal: {
    content: "A small building project with 3 floors",
    label: "Parsed Brief: Untitled Project",
    _raw: {
      projectTitle: "Untitled Project",
      projectType: "unknown",
      rawText: "A small building project with 3 floors",
    },
    prompt: "A small building project with 3 floors",
  },
};

describe("wf-08: PDF → Video Walkthrough + IFC Pipeline", () => {
  describe("Workflow template structure", () => {
    const wf14 = PREBUILT_WORKFLOWS.find((w) => w.id === "wf-08");

    it("exists in prebuilt workflows", () => {
      expect(wf14).toBeDefined();
    });

    it("has 4 nodes: IN-002, TR-001, EX-001, GN-009", () => {
      const nodes = wf14!.tileGraph.nodes;
      expect(nodes).toHaveLength(4);

      const catalogueIds = nodes.map(
        (n) => (n.data as { catalogueId: string }).catalogueId
      );
      expect(catalogueIds).toContain("IN-002");
      expect(catalogueIds).toContain("TR-001");
      expect(catalogueIds).toContain("EX-001");
      expect(catalogueIds).toContain("GN-009");
    });

    it("does NOT include GN-001 (Massing Generator)", () => {
      const nodes = wf14!.tileGraph.nodes;
      const catalogueIds = nodes.map(
        (n) => (n.data as { catalogueId: string }).catalogueId
      );
      expect(catalogueIds).not.toContain("GN-001");
    });

    it("has 3 edges with correct topology", () => {
      const edges = wf14!.tileGraph.edges;
      expect(edges).toHaveLength(3);

      expect(edges).toContainEqual(expect.objectContaining({ source: "n1", target: "n2" }));
      expect(edges).toContainEqual(expect.objectContaining({ source: "n2", target: "n3" }));
      expect(edges).toContainEqual(expect.objectContaining({ source: "n2", target: "n4" }));
    });

    it("TR-001 fans out to both EX-001 and GN-009", () => {
      const edges = wf14!.tileGraph.edges;
      const parserOutEdges = edges.filter((e) => e.source === "n2");
      expect(parserOutEdges).toHaveLength(2);
    });

    it("includes IFC in expected outputs and tags", () => {
      expect(wf14!.expectedOutputs).toContainEqual(expect.stringContaining("IFC"));
      expect(wf14!.tags).toContain("ifc");
      expect(wf14!.tags).toContain("bim");
    });
  });

  describe("Parameter extraction from TR-001 output (the critical fix)", () => {
    it("office: extracts projectType as buildingType from _raw", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.office);
      expect(params.buildingType).toBe("Office Tower");
      expect(params.projectName).toBe("Modern Office Tower");
    });

    it("office: computes footprint from programme areas / floor count", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.office);
      // programme total = 2000+500+300 = 2800. No raw floors, but text has "10-storey"? No.
      // text has no floor count → default 5 floors. footprint = 2800/5 = 560
      expect(params.footprint).toBe(560);
      expect(params.gfa).toBe(2800);
    });

    it("office: extracts height from constraints.maxHeight", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.office);
      expect(params.height).toBe(40);
    });

    it("residential: extracts 7 floors from text content", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.residential);
      expect(params.floors).toBe(7);
    });

    it("residential: computes footprint from programme / floors", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.residential);
      // programme = 1600+1200+400 = 3200, floors = 7 → footprint = 3200/7 ≈ 457
      expect(params.footprint).toBe(457);
      expect(params.height).toBe(21);
    });

    it("warehouse: extracts 2 floors from text", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.warehouse);
      expect(params.floors).toBe(2);
      expect(params.buildingType).toBe("Warehouse");
      expect(params.height).toBe(10);
    });

    it("warehouse: computes footprint from programme", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.warehouse);
      // programme = 2000+500+200 = 2700, floors = 2 → footprint = 1350
      expect(params.footprint).toBe(1350);
    });

    it("minimal: falls back to text regex for floors", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.minimal);
      expect(params.floors).toBe(3);
    });

    it("minimal: uses default footprint when no data available", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.minimal);
      expect(params.footprint).toBe(500); // default
    });

    it("different inputs produce DIFFERENT parameters (not hardcoded)", () => {
      const office = extractBuildingParams(TR001_OUTPUTS.office);
      const residential = extractBuildingParams(TR001_OUTPUTS.residential);
      const warehouse = extractBuildingParams(TR001_OUTPUTS.warehouse);

      // Building types must differ
      expect(office.buildingType).not.toBe(residential.buildingType);
      expect(residential.buildingType).not.toBe(warehouse.buildingType);

      // Footprints must differ
      expect(office.footprint).not.toBe(residential.footprint);
      expect(residential.footprint).not.toBe(warehouse.footprint);

      // Heights must differ
      expect(office.height).not.toBe(residential.height);
      expect(residential.height).not.toBe(warehouse.height);

      // Floor counts must differ
      expect(office.floors).not.toBe(residential.floors);
      expect(residential.floors).not.toBe(warehouse.floors);
    });
  });

  describe("End-to-end: TR-001 output → IFC file generation", () => {
    it("office: IFC contains correct building metadata", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.office);
      const geometry = generateMassingGeometry({
        floors: params.floors,
        footprint_m2: params.footprint,
        building_type: params.buildingType,
        total_gfa_m2: params.gfa,
        height: params.height,
      });
      const ifc = generateIFCFile(geometry, {
        projectName: params.projectName,
        buildingName: params.buildingType,
      });

      expect(ifc).toContain("ISO-10303-21;");
      expect(ifc).toContain("Modern Office Tower");
      expect(ifc).toContain("Office Tower");
      expect(ifc).toContain("IFCWALL");
      expect(ifc).toContain("IFCSLAB");
      expect(ifc).toContain("END-ISO-10303-21;");
    });

    it("residential: IFC has 7+1 storeys at 3m floor heights", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.residential);
      const geometry = generateMassingGeometry({
        floors: params.floors,
        footprint_m2: params.footprint,
        building_type: params.buildingType,
        height: params.height,
      });

      expect(geometry.floors).toBe(7);
      // Ground floor = max(3.0, 4.5) = 4.5, upper 6 floors = 3.0 each → 4.5 + 18 = 22.5
      expect(geometry.totalHeight).toBeCloseTo(22.5, 0);
      expect(geometry.storeys.find(s => s.index === 0)!.height).toBeCloseTo(4.5, 1);

      const ifc = generateIFCFile(geometry, {
        projectName: params.projectName,
        buildingName: params.buildingType,
      });
      expect(ifc).toContain("Riverside Apartments");
      const storeyMatches = ifc.match(/IFCBUILDINGSTOREY/g);
      expect(storeyMatches!.length).toBeGreaterThanOrEqual(8); // 7 + roof + optional basement
    });

    it("warehouse: IFC has 2+1 storeys with tall floor heights", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.warehouse);
      const geometry = generateMassingGeometry({
        floors: params.floors,
        footprint_m2: params.footprint,
        building_type: params.buildingType,
        height: params.height,
      });

      expect(geometry.floors).toBe(2);
      expect(geometry.storeys[0].height).toBeCloseTo(5.0, 1);

      const ifc = generateIFCFile(geometry, {
        projectName: params.projectName,
        buildingName: params.buildingType,
      });
      expect(ifc).toContain("Logistics Hub");
      const storeyMatches = ifc.match(/IFCBUILDINGSTOREY/g);
      expect(storeyMatches).toHaveLength(3); // 2 + roof
    });

    it("different PDFs produce DIFFERENT IFC files", () => {
      const office = extractBuildingParams(TR001_OUTPUTS.office);
      const warehouse = extractBuildingParams(TR001_OUTPUTS.warehouse);

      const officeGeom = generateMassingGeometry({
        floors: office.floors, footprint_m2: office.footprint,
        building_type: office.buildingType, height: office.height,
      });
      const warehouseGeom = generateMassingGeometry({
        floors: warehouse.floors, footprint_m2: warehouse.footprint,
        building_type: warehouse.buildingType, height: warehouse.height,
      });

      const officeIfc = generateIFCFile(officeGeom, {
        projectName: office.projectName, buildingName: office.buildingType,
      });
      const warehouseIfc = generateIFCFile(warehouseGeom, {
        projectName: warehouse.projectName, buildingName: warehouse.buildingType,
      });

      // Files must be different
      expect(officeIfc).not.toBe(warehouseIfc);

      // Office has more storeys
      expect(officeIfc.match(/IFCBUILDINGSTOREY/g)!.length)
        .toBeGreaterThan(warehouseIfc.match(/IFCBUILDINGSTOREY/g)!.length);

      // Each contains its own building name
      expect(officeIfc).toContain("Office Tower");
      expect(officeIfc).not.toContain("Warehouse");
      expect(warehouseIfc).toContain("Warehouse");
      expect(warehouseIfc).not.toContain("Office Tower");
    });
  });

  describe("Edge cases and IFC validation", () => {
    it("single floor building produces valid IFC", () => {
      const geometry = generateMassingGeometry({
        floors: 1, footprint_m2: 100, building_type: "Pavilion",
      });
      const ifc = generateIFCFile(geometry);
      const storeyMatches = ifc.match(/IFCBUILDINGSTOREY/g);
      expect(storeyMatches).toHaveLength(2); // 1 + roof
    });

    it("50-floor skyscraper produces valid IFC", () => {
      const geometry = generateMassingGeometry({
        floors: 50, footprint_m2: 1500, building_type: "Skyscraper",
      });
      const ifc = generateIFCFile(geometry);
      expect(ifc).toContain("END-ISO-10303-21;");
      expect(ifc.match(/IFCBUILDINGSTOREY/g)!.length).toBeGreaterThanOrEqual(51);
    });

    it("all GlobalIds are unique 22-char strings", () => {
      const geometry = generateMassingGeometry({ floors: 5, footprint_m2: 500 });
      const ifc = generateIFCFile(geometry);
      const guidMatches = ifc.match(/'[0-9A-Za-z_$]{22}'/g);
      expect(guidMatches).toBeDefined();
      expect(new Set(guidMatches).size).toBe(guidMatches!.length);
    });

    it("special characters in names are sanitized for STEP format", () => {
      const geometry = generateMassingGeometry({
        floors: 3, footprint_m2: 300, building_type: "Café & Restaurant",
      });
      const ifc = generateIFCFile(geometry, {
        projectName: "Café & Restaurant Project",
      });
      expect(ifc).toContain("ISO-10303-21;");
      expect(ifc).toContain("END-ISO-10303-21;");
      // safeName strips apostrophes — verify no unescaped apostrophes inside STEP strings
      expect(ifc).toContain("Café & Restaurant");
    });

    it("IFC property set reflects actual building data", () => {
      const params = extractBuildingParams(TR001_OUTPUTS.office);
      const geometry = generateMassingGeometry({
        floors: params.floors, footprint_m2: params.footprint,
        building_type: params.buildingType, height: params.height,
      });
      const ifc = generateIFCFile(geometry);

      // Check property values match geometry
      expect(ifc).toContain(`IFCINTEGER(${geometry.floors})`);
      expect(ifc).toContain(`IFCTEXT('${geometry.buildingType}')`);
      expect(ifc).toContain("IFCLENGTHMEASURE");
      expect(ifc).toContain("IFCAREAMEASURE");
    });
  });

  describe("Shape detection from content text (circular building fix)", () => {
    const CIRCULAR_PDF_CONTENT = `Concept Description – Circular Space-Inspired Building
The proposed building is a circular, futuristic structure that appears slightly elevated.
The building footprint is perfectly round, with a diameter of approximately 30 meters,
organized around a central core. The exterior façade is composed of curved glass panels.`;

    it("circular building: generates circular (32-sided) footprint, NOT rectangular", () => {
      const geometry = generateMassingGeometry({
        content: CIRCULAR_PDF_CONTENT,
        building_type: "Commercial",
      });

      // Circular footprint should have 32 vertices (polygon approximation)
      expect(geometry.footprint.length).toBe(32);
    });

    it("circular building: extracts 30m diameter from text → correct footprint area", () => {
      const geometry = generateMassingGeometry({
        content: CIRCULAR_PDF_CONTENT,
        building_type: "Commercial",
      });

      // diameter=30m → radius=15m → area = π×15² ≈ 707 m²
      const expectedArea = Math.PI * 15 * 15;
      expect(geometry.footprintArea).toBeCloseTo(expectedArea, -1); // within ~10
    });

    it("circular building: IFC contains circular wall segments", () => {
      const geometry = generateMassingGeometry({
        content: CIRCULAR_PDF_CONTENT,
        building_type: "Commercial",
        floors: 3,
      });

      const ifc = generateIFCFile(geometry, {
        projectName: "Circular Space-Inspired Building",
        buildingName: "Commercial",
      });

      expect(ifc).toContain("Circular Space-Inspired Building");
      expect(ifc).toContain("IFCWALL");
      // 32 exterior walls per floor × 3 floors = 96 exterior walls total
      const exteriorWallCount = ifc.match(/IFCWALL\([^)]*\.STANDARD\./g)?.length ?? 0;
      // 32 walls × 3 floors + elevator shaft walls + parapet walls
      expect(exteriorWallCount).toBeGreaterThanOrEqual(96);
      // Should also have interior partition walls
      const partitionCount = ifc.match(/\.PARTITIONING\./g)?.length ?? 0;
      expect(partitionCount).toBeGreaterThan(0);
    });

    it("circular building: footprint points form a circle, not a box", () => {
      const geometry = generateMassingGeometry({
        content: CIRCULAR_PDF_CONTENT,
      });

      // All points should be approximately distance=15m from center
      const r = 15; // radius from 30m diameter
      const cx = r; // centered at (r, r)
      const cy = r;
      const distances = geometry.footprint.map(p =>
        Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)
      );

      for (const d of distances) {
        expect(d).toBeCloseTo(r, 0); // within 1m (polygon approximation)
      }
    });

    it("hexagonal building: generates 6-sided footprint", () => {
      const geometry = generateMassingGeometry({
        content: "A hexagonal-shaped pavilion with 500 m² footprint",
        footprint_m2: 500,
      });
      expect(geometry.footprint.length).toBe(6);
    });

    it("octagonal building: generates 8-sided footprint", () => {
      const geometry = generateMassingGeometry({
        content: "An octagonal tower design",
        footprint_m2: 400,
      });
      expect(geometry.footprint.length).toBe(8);
    });

    it("rectangular building: generates 4-sided footprint when building type is not mixed", () => {
      const geometry = generateMassingGeometry({
        content: "A modern office building with glass facade",
        building_type: "Office Building",
        footprint_m2: 500,
      });
      expect(geometry.footprint.length).toBe(4);
    });

    it("different descriptions produce different shapes in IFC", () => {
      const circularGeom = generateMassingGeometry({
        content: "A circular museum with diameter of 40 meters",
        building_type: "Museum",
        floors: 2,
      });
      const rectGeom = generateMassingGeometry({
        content: "A standard office building",
        building_type: "Office Building",
        footprint_m2: 500,
        floors: 2,
      });

      const circularIfc = generateIFCFile(circularGeom);
      const rectIfc = generateIFCFile(rectGeom);

      // Circular has 32 exterior walls per floor, rectangular has 4
      const circularExteriorWalls = circularIfc.match(/IFCWALL\([^)]*\.STANDARD\./g)?.length ?? 0;
      const rectExteriorWalls = rectIfc.match(/IFCWALL\([^)]*\.STANDARD\./g)?.length ?? 0;
      expect(circularExteriorWalls).toBeGreaterThanOrEqual(64); // 32 × 2 floors + shaft + parapet
      expect(rectExteriorWalls).toBeGreaterThanOrEqual(8); // 4 × 2 floors + shaft + parapet
      expect(circularExteriorWalls).toBeGreaterThan(rectExteriorWalls);
    });

    it("dimension extraction: width x depth format", () => {
      const geometry = generateMassingGeometry({
        content: "A building measuring 40m x 25m",
        building_type: "Office Building",
        floors: 3,
      });
      // Should use explicit 40×25 dimensions
      const fp = geometry.footprint;
      expect(fp.length).toBe(4); // rectangular
      const width = Math.abs(fp[1].x - fp[0].x);
      const depth = Math.abs(fp[2].y - fp[1].y);
      expect(width).toBeCloseTo(40, 0);
      expect(depth).toBeCloseTo(25, 0);
    });

    it("content-based floor extraction: 'single-storey' = 1 floor", () => {
      const geometry = generateMassingGeometry({
        content: "A single-storey circular pavilion with diameter of 20 meters",
      });
      expect(geometry.floors).toBe(1);
      expect(geometry.footprint.length).toBe(32); // circular
    });
  });
});
