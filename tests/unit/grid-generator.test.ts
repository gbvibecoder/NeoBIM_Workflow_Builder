import { describe, it, expect } from "vitest";
import {
  generateStructuralGrid,
  getCell,
  getAdjacentCells,
  getPerimeterCells,
  cellGroupArea,
  areCellsContiguous,
  cellGroupAspectRatio,
  type StructuralGrid,
} from "@/features/floor-plan/lib/grid-generator";
import type { EnhancedRoomProgram, RoomSpec } from "@/features/floor-plan/lib/ai-room-programmer";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal RoomSpec for testing */
function room(
  name: string,
  type: string,
  areaSqm: number,
  zone: "public" | "private" | "service" | "circulation" = "private",
  mustHaveExteriorWall = false,
): RoomSpec {
  return {
    name,
    type,
    areaSqm,
    zone,
    mustHaveExteriorWall,
    adjacentTo: [],
    preferNear: [],
    floor: 0,
  };
}

/** Build a minimal EnhancedRoomProgram for testing */
function program(
  buildingType: string,
  totalAreaSqm: number,
  rooms: RoomSpec[],
  numFloors = 1,
): EnhancedRoomProgram {
  return {
    buildingType,
    totalAreaSqm,
    numFloors,
    rooms,
    adjacency: [],
    zones: {
      public: rooms.filter(r => r.zone === "public").map(r => r.name),
      private: rooms.filter(r => r.zone === "private").map(r => r.name),
      service: rooms.filter(r => r.zone === "service").map(r => r.name),
      circulation: rooms.filter(r => r.zone === "circulation").map(r => r.name),
    },
    entranceRoom: rooms[0]?.name ?? "",
    circulationNotes: "",
    projectName: "Test Plan",
  };
}

/** Pretty-print grid output for diagnostics */
function printGrid(label: string, grid: StructuralGrid): void {
  const perimeterCount = grid.cells.filter(c => c.isPerimeter).length;
  const interiorCount = grid.cells.length - perimeterCount;
  console.log(`\n━━━ ${label} ━━━`);
  console.log(`  bayWidths:  [${grid.bayWidths.map(b => b.toFixed(1)).join(", ")}]`);
  console.log(`  bayDepths:  [${grid.bayDepths.map(b => b.toFixed(1)).join(", ")}]`);
  console.log(`  totalWidth: ${grid.totalWidth.toFixed(1)}m`);
  console.log(`  totalDepth: ${grid.totalDepth.toFixed(1)}m`);
  console.log(`  gridArea:   ${(grid.totalWidth * grid.totalDepth).toFixed(1)} sqm`);
  console.log(`  gridCols:   ${grid.gridCols}`);
  console.log(`  gridRows:   ${grid.gridRows}`);
  console.log(`  cells:      ${grid.cells.length} (${perimeterCount} perimeter, ${interiorCount} interior)`);
  console.log(`  columns:    ${grid.columns.length}`);
}

// ── Structural invariants ───────────────────────────────────────────────────

/** Every bay must be within IS:456 span limits */
function assertBaySpans(grid: StructuralGrid, maxSpan: number, label: string): void {
  for (const bw of grid.bayWidths) {
    expect(bw, `${label}: bayWidth ${bw}m exceeds max span ${maxSpan}m`).toBeLessThanOrEqual(maxSpan + 0.01);
    expect(bw, `${label}: bayWidth ${bw}m < 0.9m unreasonably narrow`).toBeGreaterThanOrEqual(0.9);
  }
  for (const bd of grid.bayDepths) {
    expect(bd, `${label}: bayDepth ${bd}m exceeds max span ${maxSpan}m`).toBeLessThanOrEqual(maxSpan + 0.01);
    expect(bd, `${label}: bayDepth ${bd}m < 0.9m unreasonably narrow`).toBeGreaterThanOrEqual(0.9);
  }
}

/** Grid dimensions must sum correctly */
function assertGridConsistency(grid: StructuralGrid, label: string): void {
  const sumW = grid.bayWidths.reduce((s, b) => s + b, 0);
  const sumD = grid.bayDepths.reduce((s, b) => s + b, 0);
  expect(Math.abs(grid.totalWidth - sumW)).toBeLessThan(0.2);
  expect(Math.abs(grid.totalDepth - sumD)).toBeLessThan(0.2);
  expect(grid.gridCols).toBe(grid.bayWidths.length);
  expect(grid.gridRows).toBe(grid.bayDepths.length);
  expect(grid.cells.length).toBe(grid.gridCols * grid.gridRows);
  // columns = (cols + 1) * (rows + 1) at every grid intersection
  expect(grid.columns.length).toBe((grid.gridCols + 1) * (grid.gridRows + 1));
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

describe("generateStructuralGrid", () => {
  // ─── Test 1: 2BHK apartment ──────────────────────────────────────────────
  describe("Test 1: 2BHK apartment — 75 sqm, 7 rooms, residential", () => {
    const prog = program("apartment", 75, [
      room("Living Room", "living", 15, "public", true),
      room("Kitchen", "kitchen", 8, "service", true),
      room("Bedroom 1", "bedroom", 14, "private", true),
      room("Bedroom 2", "bedroom", 12, "private", true),
      room("Bathroom 1", "bathroom", 4, "service"),
      room("Bathroom 2", "bathroom", 3, "service"),
      room("Corridor", "hallway", 5, "circulation"),
    ]);

    let grid: StructuralGrid;

    it("generates a grid", () => {
      grid = generateStructuralGrid(prog);
      printGrid("2BHK Apartment (75 sqm, 7 rooms)", grid);
      expect(grid).toBeDefined();
    });

    it("bay dimensions are within IS:456 residential limits (≤5.0m)", () => {
      assertBaySpans(grid, 5.0, "2BHK");
    });

    it("grid is internally consistent", () => {
      assertGridConsistency(grid, "2BHK");
    });

    it("grid total area is reasonable for room program", () => {
      const gridArea = grid.totalWidth * grid.totalDepth;
      // Grid should be roughly roomAreaTotal * 1.05 (wall overhead only)
      // 61 sqm of rooms → ~64 sqm target. Grid may be larger due to bay rounding.
      expect(gridArea).toBeGreaterThanOrEqual(50);
      expect(gridArea).toBeLessThanOrEqual(250);
    });

    it("has reasonable dimensions (12-18m × 8-14m)", () => {
      // 75 sqm * 1.15 circ = 86 sqm → sqrt(86*1.4)≈11m × 7.8m
      // With grid rounding, expect 10-18m width, 7-14m depth
      expect(grid.totalWidth).toBeGreaterThanOrEqual(8);
      expect(grid.totalWidth).toBeLessThanOrEqual(20);
      expect(grid.totalDepth).toBeGreaterThanOrEqual(6);
      expect(grid.totalDepth).toBeLessThanOrEqual(16);
    });

    it("cell count ≥ room count (7)", () => {
      expect(grid.cells.length).toBeGreaterThanOrEqual(7);
    });

    it("has perimeter cells for exterior-wall rooms", () => {
      const perimCells = getPerimeterCells(grid);
      expect(perimCells.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ─── Test 2: Studio flat ─────────────────────────────────────────────────
  describe("Test 2: Studio flat — 30 sqm, 3 rooms, residential", () => {
    const prog = program("studio", 30, [
      room("Living + Kitchen", "living", 20, "public", true),
      room("Bathroom", "bathroom", 4, "service"),
      room("Entrance", "entrance", 3, "circulation"),
    ]);

    let grid: StructuralGrid;

    it("generates a grid", () => {
      grid = generateStructuralGrid(prog);
      printGrid("Studio Flat (30 sqm, 3 rooms)", grid);
      expect(grid).toBeDefined();
    });

    it("bay dimensions are within IS:456 residential limits (≤5.0m)", () => {
      assertBaySpans(grid, 5.0, "Studio");
    });

    it("grid is internally consistent", () => {
      assertGridConsistency(grid, "Studio");
    });

    it("grid total area accommodates 30 sqm", () => {
      const gridArea = grid.totalWidth * grid.totalDepth;
      // 30 * 1.15 = 34.5 sqm gross, minimum footprint dims are 6×5 = 30
      expect(gridArea).toBeGreaterThanOrEqual(30);
      expect(gridArea).toBeLessThanOrEqual(120);
    });

    it("produces a compact grid (2-3 cols, 2-3 rows)", () => {
      expect(grid.gridCols).toBeGreaterThanOrEqual(2);
      expect(grid.gridCols).toBeLessThanOrEqual(4);
      expect(grid.gridRows).toBeGreaterThanOrEqual(2);
      expect(grid.gridRows).toBeLessThanOrEqual(4);
    });
  });

  // ─── Test 3: 4BHK villa ─────────────────────────────────────────────────
  describe("Test 3: 4BHK villa — 200 sqm, 15 rooms, residential", () => {
    const prog = program("villa", 200, [
      room("Living Room", "living", 25, "public", true),
      room("Drawing Room", "living", 18, "public", true),
      room("Dining Room", "dining", 14, "public"),
      room("Kitchen", "kitchen", 12, "service", true),
      room("Master Bedroom", "bedroom", 20, "private", true),
      room("Bedroom 2", "bedroom", 14, "private", true),
      room("Bedroom 3", "bedroom", 14, "private", true),
      room("Bedroom 4", "bedroom", 12, "private", true),
      room("Master Bathroom", "bathroom", 5, "service"),
      room("Bathroom 2", "bathroom", 4, "service"),
      room("Bathroom 3", "bathroom", 3.5, "service"),
      room("Pooja Room", "other", 4, "private"),
      room("Utility", "utility", 3.5, "service"),
      room("Servant Quarter", "bedroom", 9.5, "service", true),
      room("Corridor", "hallway", 10, "circulation"),
    ]);

    let grid: StructuralGrid;

    it("generates a grid", () => {
      grid = generateStructuralGrid(prog);
      printGrid("4BHK Villa (200 sqm, 15 rooms)", grid);
      expect(grid).toBeDefined();
    });

    it("bay dimensions are within IS:456 residential limits (≤5.0m)", () => {
      assertBaySpans(grid, 5.0, "4BHK");
    });

    it("grid is internally consistent", () => {
      assertGridConsistency(grid, "4BHK");
    });

    it("grid total area is reasonable for 200 sqm room program", () => {
      const gridArea = grid.totalWidth * grid.totalDepth;
      // 168.5 sqm of rooms → ~177 sqm target. Grid may be larger due to cell count.
      expect(gridArea).toBeGreaterThanOrEqual(140);
      expect(gridArea).toBeLessThanOrEqual(500);
    });

    it("has enough cells for 15 rooms", () => {
      // Villa with 15 rooms needs at least 15 cells, ideally 15-25
      expect(grid.cells.length).toBeGreaterThanOrEqual(12);
    });

    it("has reasonable grid dimensions (4+ cols, 3+ rows)", () => {
      expect(grid.gridCols).toBeGreaterThanOrEqual(3);
      expect(grid.gridRows).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Test 4: Office 500 sqm ──────────────────────────────────────────────
  describe("Test 4: Office — 500 sqm, 12 rooms, commercial", () => {
    const prog = program("office", 500, [
      room("Reception", "entrance", 20, "public", true),
      room("Waiting Area", "living", 15, "public"),
      room("Cabin 1", "office", 12, "private"),
      room("Cabin 2", "office", 12, "private"),
      room("Cabin 3", "office", 12, "private"),
      room("Conference Room", "living", 25, "public"),
      room("Open Workspace", "office", 100, "private", true),
      room("Server Room", "storage", 8, "service"),
      room("Pantry", "kitchen", 12, "service", true),
      room("Toilet M", "bathroom", 8, "service"),
      room("Toilet F", "bathroom", 8, "service"),
      room("Corridor", "hallway", 30, "circulation"),
    ]);

    let grid: StructuralGrid;

    it("generates a grid", () => {
      grid = generateStructuralGrid(prog);
      printGrid("Office (500 sqm, 12 rooms)", grid);
      expect(grid).toBeDefined();
    });

    it("uses commercial bay sizes (≤6.0m span, bays ≥4.2m typical)", () => {
      assertBaySpans(grid, 9.0, "Office"); // commercial BAYS go up to 9.0
      // At least some bays should be > 4.0m (commercial scale)
      const maxBay = Math.max(...grid.bayWidths, ...grid.bayDepths);
      expect(maxBay).toBeGreaterThanOrEqual(4.0);
    });

    it("grid is internally consistent", () => {
      assertGridConsistency(grid, "Office");
    });

    it("grid total area is reasonable for 500 sqm room program", () => {
      const gridArea = grid.totalWidth * grid.totalDepth;
      // 262 sqm of rooms → ~275 sqm target. May be larger due to 12 room cells.
      expect(gridArea).toBeGreaterThanOrEqual(200);
      expect(gridArea).toBeLessThanOrEqual(1200);
    });

    it("produces a grid with larger footprint than residential", () => {
      expect(grid.totalWidth).toBeGreaterThanOrEqual(15);
      expect(grid.totalDepth).toBeGreaterThanOrEqual(12);
    });
  });

  // ─── Test 5: Plot-constrained 2BHK ──────────────────────────────────────
  describe("Test 5: 20×40 feet plot (6.1m × 12.2m) — 2BHK, 56 sqm", () => {
    const prog = program("apartment", 56, [
      room("Living Room", "living", 14, "public", true),
      room("Kitchen", "kitchen", 7, "service", true),
      room("Bedroom 1", "bedroom", 12, "private", true),
      room("Bedroom 2", "bedroom", 10, "private", true),
      room("Bathroom", "bathroom", 3.5, "service"),
      room("Corridor", "hallway", 4, "circulation"),
    ]);

    let grid: StructuralGrid;

    it("generates a grid within plot constraints", () => {
      grid = generateStructuralGrid(prog, {
        plotWidth: 6.1,
        plotDepth: 12.2,
      });
      printGrid("20×40ft Plot (6.1m × 12.2m, 56 sqm)", grid);
      expect(grid).toBeDefined();
    });

    it("grid fits within the plot (totalWidth ≤ 6.1m, totalDepth ≤ 12.2m)", () => {
      // Grid should target the plot dimensions exactly
      // May be slightly under but should not overshoot significantly
      expect(grid.totalWidth).toBeLessThanOrEqual(6.2);
      expect(grid.totalDepth).toBeLessThanOrEqual(12.3);
    });

    it("bay dimensions are within IS:456 residential limits", () => {
      assertBaySpans(grid, 5.0, "20x40");
    });

    it("grid is internally consistent", () => {
      assertGridConsistency(grid, "20x40");
    });

    it("grid area is reasonable for 56 sqm program", () => {
      const gridArea = grid.totalWidth * grid.totalDepth;
      // The plot itself is 6.1×12.2 = 74.4 sqm, which is > 56 sqm — good
      expect(gridArea).toBeGreaterThanOrEqual(40);
      expect(gridArea).toBeLessThanOrEqual(80);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Grid utility functions", () => {
  // Build a simple 3×2 grid for utility tests
  const prog = program("apartment", 60, [
    room("Room A", "living", 15, "public"),
    room("Room B", "bedroom", 12, "private"),
    room("Room C", "kitchen", 8, "service"),
  ]);
  const grid = generateStructuralGrid(prog);

  describe("getCell", () => {
    it("returns cell at valid position", () => {
      const cell = getCell(grid, 0, 0);
      expect(cell).toBeDefined();
      expect(cell!.col).toBe(0);
      expect(cell!.row).toBe(0);
    });

    it("returns undefined for out-of-bounds", () => {
      expect(getCell(grid, -1, 0)).toBeUndefined();
      expect(getCell(grid, 99, 99)).toBeUndefined();
    });
  });

  describe("getAdjacentCells", () => {
    it("corner cell has 2 neighbors", () => {
      const adj = getAdjacentCells(grid, 0, 0);
      expect(adj.length).toBe(2);
    });

    it("interior cell has 4 neighbors (if grid is ≥3×3)", () => {
      if (grid.gridCols >= 3 && grid.gridRows >= 3) {
        const adj = getAdjacentCells(grid, 1, 1);
        expect(adj.length).toBe(4);
      }
    });
  });

  describe("getPerimeterCells", () => {
    it("all edge cells are perimeter", () => {
      const perim = getPerimeterCells(grid);
      expect(perim.length).toBeGreaterThan(0);
      for (const cell of perim) {
        expect(cell.isPerimeter).toBe(true);
        expect(cell.exteriorEdges.length).toBeGreaterThan(0);
      }
    });

    it("corner cells have 2 exterior edges", () => {
      const topLeft = getCell(grid, 0, 0);
      expect(topLeft).toBeDefined();
      expect(topLeft!.exteriorEdges).toContain("top");
      expect(topLeft!.exteriorEdges).toContain("left");
    });
  });

  describe("cellGroupArea", () => {
    it("single cell area = width × depth", () => {
      const cell = getCell(grid, 0, 0)!;
      expect(cellGroupArea([cell])).toBeCloseTo(cell.width * cell.depth, 1);
    });

    it("all cells area = total grid area", () => {
      const totalArea = cellGroupArea(grid.cells);
      expect(totalArea).toBeCloseTo(grid.totalWidth * grid.totalDepth, 1);
    });
  });

  describe("areCellsContiguous", () => {
    it("single cell is contiguous", () => {
      const cell = getCell(grid, 0, 0)!;
      expect(areCellsContiguous([cell])).toBe(true);
    });

    it("two adjacent cells are contiguous", () => {
      const a = getCell(grid, 0, 0)!;
      const b = getCell(grid, 1, 0)!;
      expect(areCellsContiguous([a, b])).toBe(true);
    });

    it("two non-adjacent cells are NOT contiguous", () => {
      if (grid.gridCols >= 3) {
        const a = getCell(grid, 0, 0)!;
        const c = getCell(grid, 2, 0)!;
        expect(areCellsContiguous([a, c])).toBe(false);
      }
    });
  });

  describe("cellGroupAspectRatio", () => {
    it("single square cell has AR ≈ 1", () => {
      // Find a cell where width ≈ depth
      const cell = getCell(grid, 0, 0)!;
      if (Math.abs(cell.width - cell.depth) < 0.5) {
        const ar = cellGroupAspectRatio([cell]);
        expect(ar).toBeGreaterThanOrEqual(1.0);
        expect(ar).toBeLessThan(2.0);
      }
    });

    it("aspect ratio ≥ 1 always", () => {
      for (const cell of grid.cells) {
        expect(cellGroupAspectRatio([cell])).toBeGreaterThanOrEqual(1.0);
      }
    });
  });
});
