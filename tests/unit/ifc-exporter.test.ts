import { describe, it, expect } from "vitest";
import { generateIFCFile } from "@/features/ifc/services/ifc-exporter";
import { generateMassingGeometry } from "@/services/massing-generator";
import type { MassingGeometry } from "@/types/geometry";

function createTestGeometry(overrides?: Partial<Parameters<typeof generateMassingGeometry>[0]>): MassingGeometry {
  return generateMassingGeometry({
    floors: 3,
    footprint_m2: 400,
    building_type: "Office Building",
    ...overrides,
  });
}

describe("IFC Exporter", () => {
  describe("File structure", () => {
    it("generates a valid IFC4 file with correct header and footer", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toContain("ISO-10303-21;");
      expect(ifc).toContain("HEADER;");
      expect(ifc).toContain("FILE_SCHEMA(('IFC4'));");
      expect(ifc).toContain("ENDSEC;");
      expect(ifc).toContain("DATA;");
      expect(ifc).toContain("END-ISO-10303-21;");
    });

    it("includes FILE_DESCRIPTION with CoordinationView", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toContain("FILE_DESCRIPTION(('ViewDefinition [DesignTransferView_V1]'),'2;1');");
    });

    it("includes FILE_NAME with custom building name", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry, { buildingName: "Test Tower" });

      expect(ifc).toContain("FILE_NAME('Test Tower.ifc'");
    });
  });

  describe("IFC spatial hierarchy", () => {
    it("contains IfcProject", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toMatch(/IFCPROJECT\(/);
    });

    it("contains IfcSite", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toMatch(/IFCSITE\(/);
    });

    it("contains IfcBuilding", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toMatch(/IFCBUILDING\(/);
    });

    it("contains correct number of IfcBuildingStorey entries", () => {
      const geometry = createTestGeometry({ floors: 5 });
      const ifc = generateIFCFile(geometry);

      const storeyCount = (ifc.match(/IFCBUILDINGSTOREY\(/g) || []).length;
      // 5 floors + 1 roof + optional basement = 6-7 storeys
      expect(storeyCount).toBeGreaterThanOrEqual(6);
    });

    it("contains IfcRelAggregates for spatial structure", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      const aggregateCount = (ifc.match(/IFCRELAGGREGATES\(/g) || []).length;
      // 3 base aggregations + space aggregations per storey (floors + roof)
      // storeys→building, building→site, site→project, plus spaces→storey for each floor with spaces
      expect(aggregateCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Building elements", () => {
    it("contains IfcWall elements (exterior + interior)", () => {
      const geometry = createTestGeometry({ floors: 2 });
      const ifc = generateIFCFile(geometry);

      // Count exterior walls (.STANDARD.) — includes elevator shaft + parapet walls
      const exteriorWallCount = (ifc.match(/IFCWALL\([^)]*\.STANDARD\./g) || []).length;
      // At least 4 exterior walls per floor × 2 floors = 8, plus shaft walls + parapet
      expect(exteriorWallCount).toBeGreaterThanOrEqual(8);

      // Total walls (exterior + partition + shaft + parapet) should be more
      const totalWallCount = (ifc.match(/IFCWALL\(/g) || []).length;
      expect(totalWallCount).toBeGreaterThan(8);
    });

    it("contains IfcSlab elements (floors + roof)", () => {
      const geometry = createTestGeometry({ floors: 3 });
      const ifc = generateIFCFile(geometry);

      const slabCount = (ifc.match(/IFCSLAB\(/g) || []).length;
      // 3 floor slabs + 1 roof + basement slab + canopy/balcony slabs
      expect(slabCount).toBeGreaterThanOrEqual(4);
    });

    it("contains IfcRelContainedInSpatialStructure for each storey", () => {
      const geometry = createTestGeometry({ floors: 3 });
      const ifc = generateIFCFile(geometry);

      const relCount = (ifc.match(/IFCRELCONTAINEDINSPATIALSTRUCTURE\(/g) || []).length;
      // 3 floor storeys + 1 roof + optional basement = 4-5+
      expect(relCount).toBeGreaterThanOrEqual(4);
    });
  });

  describe("Geometry representations", () => {
    it("contains IfcExtrudedAreaSolid for walls and slabs", () => {
      const geometry = createTestGeometry({ floors: 1 });
      const ifc = generateIFCFile(geometry);

      const solidCount = (ifc.match(/IFCEXTRUDEDAREASOLID\(/g) || []).length;
      // Each wall (4) + floor slab (1) + roof slab (1) = 6
      expect(solidCount).toBeGreaterThanOrEqual(6);
    });

    it("contains IfcShapeRepresentation for each element", () => {
      const geometry = createTestGeometry({ floors: 1 });
      const ifc = generateIFCFile(geometry);

      const shapeCount = (ifc.match(/IFCSHAPEREPRESENTATION\(/g) || []).length;
      // 4 walls + 1 floor slab + 1 roof slab = 6
      expect(shapeCount).toBeGreaterThanOrEqual(6);
    });

    it("uses IfcRectangleProfileDef for walls", () => {
      const geometry = createTestGeometry({ floors: 1 });
      const ifc = generateIFCFile(geometry);

      expect(ifc).toMatch(/IFCRECTANGLEPROFILEDEF\(/);
    });

    it("uses IfcArbitraryClosedProfileDef for slabs", () => {
      const geometry = createTestGeometry({ floors: 1 });
      const ifc = generateIFCFile(geometry);

      expect(ifc).toMatch(/IFCARBITRARYCLOSEDPROFILEDEF\(/);
    });
  });

  describe("Units and context", () => {
    it("defines SI units (metre, square metre, cubic metre, radian)", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toContain(".METRE.");
      expect(ifc).toContain(".SQUARE_METRE.");
      expect(ifc).toContain(".CUBIC_METRE.");
      expect(ifc).toContain(".RADIAN.");
    });

    it("defines IfcUnitAssignment", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toMatch(/IFCUNITASSIGNMENT\(/);
    });

    it("defines geometric representation context", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toMatch(/IFCGEOMETRICREPRESENTATIONCONTEXT\(/);
      expect(ifc).toMatch(/IFCGEOMETRICREPRESENTATIONSUBCONTEXT\(/);
    });
  });

  describe("Owner history and metadata", () => {
    it("contains IfcOwnerHistory", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toMatch(/IFCOWNERHISTORY\(/);
    });

    it("contains IfcApplication referencing BuildFlow", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toContain("'BuildFlow'");
    });

    it("contains IfcPropertySet with building info", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toContain("'BuildFlow_BuildingInfo'");
      expect(ifc).toContain("'NumberOfFloors'");
      expect(ifc).toContain("'TotalHeight'");
      expect(ifc).toContain("'GrossFloorArea'");
      expect(ifc).toContain("'FootprintArea'");
      expect(ifc).toContain("'BuildingType'");
    });

    it("contains IfcRelDefinesByProperties", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(ifc).toMatch(/IFCRELDEFINESBYPROPERTIES\(/);
    });
  });

  describe("Custom options", () => {
    it("uses custom project name", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry, { projectName: "My Custom Project" });

      expect(ifc).toContain("'My Custom Project'");
    });

    it("uses custom site name", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry, { siteName: "Plot 42" });

      expect(ifc).toContain("'Plot 42'");
    });

    it("uses custom author", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry, { author: "Test User" });

      expect(ifc).toContain("'Test User'");
    });
  });

  describe("Edge cases", () => {
    it("handles 1-storey building", () => {
      const geometry = createTestGeometry({ floors: 1 });
      const ifc = generateIFCFile(geometry);

      expect(ifc).toContain("ISO-10303-21;");
      expect(ifc).toContain("END-ISO-10303-21;");

      const storeyCount = (ifc.match(/IFCBUILDINGSTOREY\(/g) || []).length;
      expect(storeyCount).toBe(2); // ground floor + roof
    });

    it("handles 30-storey tower", () => {
      const geometry = createTestGeometry({ floors: 30 });
      const ifc = generateIFCFile(geometry);

      expect(ifc).toContain("ISO-10303-21;");
      expect(ifc).toContain("END-ISO-10303-21;");

      const storeyCount = (ifc.match(/IFCBUILDINGSTOREY\(/g) || []).length;
      expect(storeyCount).toBeGreaterThanOrEqual(31); // 30 + roof + optional basement
    });

    it("handles L-shaped footprint (mixed-use)", () => {
      const geometry = createTestGeometry({
        floors: 3,
        footprint_m2: 600,
        building_type: "Mixed-Use Complex",
      });
      const ifc = generateIFCFile(geometry);

      expect(ifc).toContain("ISO-10303-21;");
      expect(ifc).toContain("END-ISO-10303-21;");

      // L-shape has 6 edges = 6 exterior walls per floor
      const exteriorWallCount = (ifc.match(/IFCWALL\([^)]*\.STANDARD\./g) || []).length;
      expect(exteriorWallCount).toBeGreaterThanOrEqual(18); // 6 × 3 floors + shaft + parapet

      // Should also have interior partition walls
      const partitionCount = (ifc.match(/IFCWALL\([^)]*\.PARTITIONING\./g) || []).length;
      expect(partitionCount).toBeGreaterThan(0);
    });

    it("returns a non-empty string", () => {
      const geometry = createTestGeometry();
      const ifc = generateIFCFile(geometry);

      expect(typeof ifc).toBe("string");
      expect(ifc.length).toBeGreaterThan(500);
    });

    it("all IFC express IDs (#N) are unique", () => {
      const geometry = createTestGeometry({ floors: 5 });
      const ifc = generateIFCFile(geometry);

      // Extract all #N= assignments
      const idMatches = ifc.match(/#(\d+)=/g) || [];
      const ids = idMatches.map(m => m.replace("=", ""));
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("Interior elements", () => {
    it("generates IfcSpace elements for rooms", () => {
      const geometry = createTestGeometry({ floors: 2 });
      const ifc = generateIFCFile(geometry);

      const spaceCount = (ifc.match(/IFCSPACE\(/g) || []).length;
      expect(spaceCount).toBeGreaterThan(0);
    });

    it("generates IfcColumn elements", () => {
      const geometry = createTestGeometry({ floors: 2 });
      const ifc = generateIFCFile(geometry);

      const columnCount = (ifc.match(/IFCCOLUMN\(/g) || []).length;
      expect(columnCount).toBeGreaterThan(0);
    });

    it("generates partition walls (.PARTITIONING.)", () => {
      const geometry = createTestGeometry({ floors: 1 });
      const ifc = generateIFCFile(geometry);

      const partitionCount = (ifc.match(/\.PARTITIONING\./g) || []).length;
      expect(partitionCount).toBeGreaterThan(0);
    });

    it("uses IfcCircleProfileDef for columns", () => {
      const geometry = createTestGeometry({ floors: 1 });
      const ifc = generateIFCFile(geometry);

      expect(ifc).toMatch(/IFCCIRCLEPROFILEDEF\(/);
    });

    it("generates IfcRelAggregates for spaces in storeys", () => {
      const geometry = createTestGeometry({ floors: 2 });
      const ifc = generateIFCFile(geometry);

      // Should have space aggregation lines containing "Spaces"
      expect(ifc).toContain("Spaces");
    });

    it("generates interior elements for circular buildings", () => {
      const geometry = generateMassingGeometry({
        floors: 3,
        footprint_m2: 500,
        building_type: "Observatory",
        content: "circular observatory with diameter of 25 meters",
      });
      const ifc = generateIFCFile(geometry);

      // Should have spaces, columns, and partition walls
      const spaceCount = (ifc.match(/IFCSPACE\(/g) || []).length;
      const columnCount = (ifc.match(/IFCCOLUMN\(/g) || []).length;
      const partitionCount = (ifc.match(/\.PARTITIONING\./g) || []).length;

      expect(spaceCount).toBeGreaterThan(0);
      expect(columnCount).toBeGreaterThan(0);
      expect(partitionCount).toBeGreaterThan(0);
    });

    it("generates corridor spaces", () => {
      const geometry = createTestGeometry({ floors: 1 });
      const ifc = generateIFCFile(geometry);

      // Should contain a corridor or circulation space
      expect(ifc).toMatch(/Corridor|Core \/ Circulation/);
    });

    it("uses programme data for room names when provided", () => {
      const geometry = generateMassingGeometry({
        floors: 1,
        footprint_m2: 400,
        building_type: "Office Building",
        programme: [
          { space: "Executive Suite", area_m2: 100, floor: "Ground" },
          { space: "Server Room", area_m2: 50, floor: "Ground" },
          { space: "Cafeteria", area_m2: 80, floor: "Ground" },
        ],
      });
      const ifc = generateIFCFile(geometry);

      expect(ifc).toContain("Executive Suite");
      expect(ifc).toContain("Server Room");
      expect(ifc).toContain("Cafeteria");
    });
  });

  describe("End-to-end: massing → IFC", () => {
    it("generates valid IFC from text prompt parameters", () => {
      // Simulate the full pipeline: text input → massing → IFC
      const geometry = generateMassingGeometry({
        floors: 10,
        footprint_m2: 500,
        building_type: "Office Tower",
        content: "Modern 10-storey office tower in downtown",
      });

      const ifc = generateIFCFile(geometry, {
        projectName: "Downtown Office",
        buildingName: "Tower A",
        siteName: "Block 5, CBD",
        author: "Architect",
      });

      // Validate structure
      expect(ifc).toContain("ISO-10303-21;");
      expect(ifc).toContain("'Downtown Office'");
      expect(ifc).toContain("'Tower A'");
      expect(ifc).toContain("'Block 5, CBD'");
      expect(ifc).toContain("IFCINTEGER(10)"); // floors property
      expect(ifc).toContain("END-ISO-10303-21;");

      // Should have reasonable size
      expect(ifc.length).toBeGreaterThan(2000);
    });

    it("generates valid IFC for a small residential building", () => {
      const geometry = generateMassingGeometry({
        floors: 2,
        footprint_m2: 150,
        building_type: "Residential Apartment",
      });

      const ifc = generateIFCFile(geometry);

      expect(ifc).toContain("IFCINTEGER(2)");
      expect(ifc).toContain("'Residential Apartment'");
      expect(ifc).toContain("END-ISO-10303-21;");
    });

    it("generates valid IFC for a large warehouse", () => {
      const geometry = generateMassingGeometry({
        floors: 1,
        footprint_m2: 2000,
        building_type: "Warehouse",
      });

      const ifc = generateIFCFile(geometry);

      // Warehouse: 5m floor height
      expect(ifc).toContain("IFCINTEGER(1)");
      expect(ifc).toContain("END-ISO-10303-21;");

      // At least 4 exterior walls for 1 floor (+ parapet walls)
      const exteriorWallCount = (ifc.match(/IFCWALL\([^)]*\.STANDARD\./g) || []).length;
      expect(exteriorWallCount).toBeGreaterThanOrEqual(4);
    });
  });
});
