import { describe, it, expect } from "vitest";
import { generateMassingGeometry } from "@/services/massing-generator";

describe("Massing Generator", () => {
  describe("Basic geometry generation", () => {
    it("generates geometry for a simple 5-storey building", () => {
      const result = generateMassingGeometry({
        floors: 5,
        footprint_m2: 500,
        building_type: "Office Building",
      });

      expect(result.floors).toBe(5);
      expect(result.buildingType).toBe("Office Building");
      expect(result.footprintArea).toBeGreaterThan(0);
      expect(result.gfa).toBeGreaterThan(0);
      expect(result.totalHeight).toBeGreaterThan(0);
      expect(result.footprint.length).toBeGreaterThanOrEqual(4);
      // 5 floor storeys + 1 roof + 1 basement (>= 3 floors) = 7
      expect(result.storeys.length).toBe(7);
    });

    it("generates geometry for a 1-storey villa", () => {
      const result = generateMassingGeometry({
        floors: 1,
        footprint_m2: 200,
        building_type: "Villa",
      });

      expect(result.floors).toBe(1);
      // 1 floor + 1 roof = 2 storeys
      expect(result.storeys.length).toBe(2);
      expect(result.totalHeight).toBeGreaterThan(0);
      expect(result.totalHeight).toBeLessThan(10);
    });

    it("generates geometry for a 30-storey tower", () => {
      const result = generateMassingGeometry({
        floors: 30,
        footprint_m2: 400,
        building_type: "Office Tower",
      });

      expect(result.floors).toBe(30);
      expect(result.storeys.length).toBe(32); // 30 + roof + basement
      expect(result.totalHeight).toBeGreaterThan(90);
    });

    it("clamps floors to max 50", () => {
      const result = generateMassingGeometry({ floors: 100 });
      expect(result.floors).toBe(50);
    });

    it("clamps floors to min 1", () => {
      const result = generateMassingGeometry({ floors: -5 });
      expect(result.floors).toBe(1);
    });
  });

  describe("Footprint shapes", () => {
    it("creates rectangular footprint for standard buildings", () => {
      const result = generateMassingGeometry({
        floors: 5,
        footprint_m2: 500,
        building_type: "Office Building",
      });

      expect(result.footprint.length).toBe(4);
      // Check it's a proper rectangle (4 corners)
      const xs = result.footprint.map(p => p.x);
      const ys = result.footprint.map(p => p.y);
      expect(Math.min(...xs)).toBe(0);
      expect(Math.min(...ys)).toBe(0);
    });

    it("creates L-shaped footprint for mixed-use buildings > 200m²", () => {
      const result = generateMassingGeometry({
        floors: 5,
        footprint_m2: 600,
        building_type: "Mixed-Use Complex",
      });

      expect(result.footprint.length).toBe(6); // L-shape has 6 vertices
    });

    it("creates rectangular footprint for small mixed-use buildings", () => {
      const result = generateMassingGeometry({
        floors: 2,
        footprint_m2: 150,
        building_type: "Mixed-Use Building",
      });

      expect(result.footprint.length).toBe(4); // too small for L-shape
    });
  });

  describe("Storey elements", () => {
    it("each storey has exterior walls matching the footprint edge count", () => {
      const result = generateMassingGeometry({
        floors: 3,
        footprint_m2: 400,
        building_type: "Office Building",
      });

      const edgeCount = result.footprint.length; // 4 for rectangle

      // Check floor storeys (not roof)
      for (let i = 0; i < result.floors; i++) {
        const storey = result.storeys[i];
        const exteriorWalls = storey.elements.filter(e => e.type === "wall" && !e.properties.isPartition);
        const slabs = storey.elements.filter(e => e.type === "slab");

        expect(exteriorWalls.length).toBe(edgeCount);
        expect(slabs.length).toBe(1);
      }
    });

    it("each storey has interior elements (spaces, columns, partition walls)", () => {
      const result = generateMassingGeometry({
        floors: 2,
        footprint_m2: 400,
        building_type: "Office Building",
      });

      for (let i = 0; i < result.floors; i++) {
        const storey = result.storeys[i];
        const spaces = storey.elements.filter(e => e.type === "space");
        const columns = storey.elements.filter(e => e.type === "column");
        const partitions = storey.elements.filter(e => e.type === "wall" && e.properties.isPartition);

        expect(spaces.length).toBeGreaterThan(0);
        expect(columns.length).toBeGreaterThan(0);
        expect(partitions.length).toBeGreaterThan(0);
      }
    });

    it("roof storey has a single roof slab", () => {
      const result = generateMassingGeometry({
        floors: 3,
        footprint_m2: 400,
        building_type: "Office",
      });

      const roofStorey = result.storeys[result.storeys.length - 1];
      expect(roofStorey.name).toBe("Roof");
      // Roof slab + parapet walls around perimeter
      expect(roofStorey.elements.length).toBeGreaterThanOrEqual(1);
      expect(roofStorey.elements[0].type).toBe("roof");
    });

    it("wall elements have proper vertices (8 vertices per wall)", () => {
      const result = generateMassingGeometry({
        floors: 1,
        footprint_m2: 400,
        building_type: "Office",
      });

      const walls = result.storeys[0].elements.filter(e => e.type === "wall");
      for (const wall of walls) {
        expect(wall.vertices.length).toBe(8); // box has 8 vertices
        expect(wall.faces.length).toBe(6); // box has 6 faces
        expect(wall.ifcType).toBe("IfcWall");
      }
    });

    it("slab elements have correct vertex count", () => {
      const result = generateMassingGeometry({
        floors: 1,
        footprint_m2: 400,
        building_type: "Office",
      });

      const slab = result.storeys[0].elements.find(e => e.type === "slab");
      expect(slab).toBeDefined();
      // Slab: top + bottom = 2 * footprint vertices
      expect(slab!.vertices.length).toBe(result.footprint.length * 2);
      expect(slab!.ifcType).toBe("IfcSlab");
    });
  });

  describe("Floor height by building type", () => {
    it("uses 5.0m for warehouse/industrial", () => {
      const result = generateMassingGeometry({
        floors: 2,
        building_type: "Warehouse",
      });
      expect(result.totalHeight).toBeCloseTo(10.0, 0);
    });

    it("uses 3.8m for office (ground floor 4.5m min)", () => {
      const result = generateMassingGeometry({
        floors: 2,
        building_type: "Office Building",
      });
      // Ground floor = max(3.8, 4.5) = 4.5, upper = 3.8 → total = 8.3
      expect(result.totalHeight).toBeCloseTo(8.3, 0);
    });

    it("uses 3.0m for residential (ground floor 4.5m min)", () => {
      const result = generateMassingGeometry({
        floors: 2,
        building_type: "Residential Apartment",
      });
      // Ground floor = max(3.0, 4.5) = 4.5, upper = 3.0 → total = 7.5
      expect(result.totalHeight).toBeCloseTo(7.5, 0);
    });

    it("uses explicit height when both floors and height given", () => {
      const result = generateMassingGeometry({
        floors: 5,
        height: 20,
        building_type: "Office",
      });
      // floorHeight = 20/5 = 4.0, ground = max(4.0, 4.5) = 4.5, upper = 4×4.0 = 16 → total = 20.5
      expect(result.totalHeight).toBeCloseTo(20.5, 0);
    });
  });

  describe("Metrics and bounding box", () => {
    it("returns correct metrics array", () => {
      const result = generateMassingGeometry({
        floors: 5,
        footprint_m2: 500,
        building_type: "Office",
      });

      expect(result.metrics.length).toBe(6);
      const labels = result.metrics.map(m => m.label);
      expect(labels).toContain("GFA");
      expect(labels).toContain("Height");
      expect(labels).toContain("Floors");
      expect(labels).toContain("Footprint");
      expect(labels).toContain("Floor Height");
      expect(labels).toContain("Plot Ratio");
    });

    it("bounding box encloses the geometry", () => {
      const result = generateMassingGeometry({
        floors: 5,
        footprint_m2: 500,
        building_type: "Office",
      });

      // With basement (>= 3 floors), min.z is negative
      expect(result.boundingBox.min.z).toBeLessThanOrEqual(0);
      expect(result.boundingBox.max.z).toBe(result.totalHeight);
      expect(result.boundingBox.min.x).toBeLessThanOrEqual(result.boundingBox.max.x);
      expect(result.boundingBox.min.y).toBeLessThanOrEqual(result.boundingBox.max.y);
    });
  });

  describe("Default values", () => {
    it("uses sensible defaults when minimal input is given", () => {
      const result = generateMassingGeometry({});

      expect(result.floors).toBe(5);
      expect(result.buildingType).toBe("Mixed-Use Building");
      expect(result.footprintArea).toBeGreaterThan(0);
      expect(result.gfa).toBeGreaterThan(0);
      expect(result.storeys.length).toBeGreaterThan(0);
    });
  });
});
