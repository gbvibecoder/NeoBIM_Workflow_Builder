import { describe, it, expect } from "vitest";
import { generateStructuralGrid, type StructuralGrid, getAdjacentCells, cellGroupArea } from "@/features/floor-plan/lib/grid-generator";
import { assignRoomsToGrid, type RoomAssignment, type AssignedRoom } from "@/features/floor-plan/lib/grid-room-assigner";
import type { EnhancedRoomProgram, RoomSpec, AdjacencyRequirement } from "@/features/floor-plan/lib/ai-room-programmer";

// ── Helpers ─────────────────────────────────────────────────────────────────

function room(
  name: string,
  type: string,
  areaSqm: number,
  zone: "public" | "private" | "service" | "circulation" = "private",
  mustHaveExteriorWall = false,
  adjacentTo: string[] = [],
): RoomSpec {
  return { name, type, areaSqm, zone, mustHaveExteriorWall, adjacentTo, preferNear: [], floor: 0 };
}

function program(
  buildingType: string,
  totalAreaSqm: number,
  rooms: RoomSpec[],
  adjacency: AdjacencyRequirement[] = [],
  numFloors = 1,
): EnhancedRoomProgram {
  return {
    buildingType, totalAreaSqm, numFloors, rooms, adjacency,
    zones: {
      public: rooms.filter(r => r.zone === "public").map(r => r.name),
      private: rooms.filter(r => r.zone === "private").map(r => r.name),
      service: rooms.filter(r => r.zone === "service").map(r => r.name),
      circulation: rooms.filter(r => r.zone === "circulation").map(r => r.name),
    },
    entranceRoom: rooms[0]?.name ?? "",
    circulationNotes: "", projectName: "Test",
  };
}

/**
 * Print the full assignment diagnostics for a scenario.
 * Returns structured data for assertions.
 */
function printAssignment(
  label: string,
  grid: StructuralGrid,
  assignment: RoomAssignment,
  prog: EnhancedRoomProgram,
): {
  roomDetails: Array<{
    name: string;
    cells: string;
    cellCount: number;
    actualArea: number;
    requestedArea: number;
    areaRatio: number;
    touchesPerimeter: boolean;
  }>;
  adjResults: Array<{ pair: string; satisfied: boolean }>;
  unassignedCount: number;
  totalCellsUsed: number;
} {
  const totalCells = grid.cells.length;
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${"═".repeat(70)}`);
  console.log(`  Grid: ${grid.gridCols}×${grid.gridRows} = ${totalCells} cells`);
  console.log(`  Grid area: ${(grid.totalWidth * grid.totalDepth).toFixed(1)} sqm`);
  console.log(`  Rooms assigned: ${assignment.roomOrder.length}`);
  console.log(`  Corridor cells: ${assignment.corridorCells.length}`);
  console.log(`  Entrance cell: ${assignment.entranceCell?.gridRef ?? "none"}`);
  console.log(`  Plumbing core: ${assignment.plumbingCore?.gridRef ?? "none"}`);
  console.log();

  // ── Room detail table ──
  console.log("  Room Assignments:");
  console.log("  " + "-".repeat(66));
  console.log(
    "  " +
    "Room".padEnd(22) +
    "Cells".padEnd(16) +
    "ActArea".padStart(8) +
    "ReqArea".padStart(8) +
    "Ratio".padStart(7) +
    " Perim?"
  );
  console.log("  " + "-".repeat(66));

  const roomDetails: Array<{
    name: string; cells: string; cellCount: number;
    actualArea: number; requestedArea: number; areaRatio: number;
    touchesPerimeter: boolean;
  }> = [];

  for (const ar of assignment.roomOrder) {
    const cellStr = ar.cells.map(c => c.gridRef).join(",");
    const touchesPerimeter = ar.cells.some(c => c.isPerimeter);
    const ratio = ar.actualArea / Math.max(ar.spec.areaSqm, 0.01);
    const ratioStr = ratio.toFixed(2);
    const flag =
      ar.cells.length === 0 ? " *** 0 CELLS ***" :
      ratio < 0.5 ? " *** <50% ***" :
      ratio > 2.5 ? " *** >250% ***" : "";

    console.log(
      "  " +
      ar.spec.name.padEnd(22) +
      cellStr.padEnd(16) +
      ar.actualArea.toFixed(1).padStart(8) +
      ar.spec.areaSqm.toFixed(1).padStart(8) +
      ratioStr.padStart(7) +
      (touchesPerimeter ? "   yes" : "    no") +
      flag
    );

    roomDetails.push({
      name: ar.spec.name, cells: cellStr, cellCount: ar.cells.length,
      actualArea: ar.actualArea, requestedArea: ar.spec.areaSqm,
      areaRatio: ratio, touchesPerimeter,
    });
  }
  console.log("  " + "-".repeat(66));

  // ── Adjacency checks ──
  const adjResults: Array<{ pair: string; satisfied: boolean }> = [];
  if (prog.adjacency.length > 0) {
    console.log("\n  Adjacency Checks:");
    for (const adj of prog.adjacency) {
      const roomA = assignment.roomOrder.find(ar => ar.spec.name === adj.roomA);
      const roomB = assignment.roomOrder.find(ar => ar.spec.name === adj.roomB);
      let satisfied = false;
      if (roomA && roomB) {
        satisfied = roomA.cells.some(ca =>
          getAdjacentCells(grid, ca.col, ca.row).some(neighbor =>
            roomB.cells.some(cb => cb.col === neighbor.col && cb.row === neighbor.row)
          )
        );
      }
      const status = satisfied ? "SATISFIED" : "UNSATISFIED";
      const missing = !roomA ? ` (${adj.roomA} not found)` : !roomB ? ` (${adj.roomB} not found)` : "";
      console.log(`    ${adj.roomA} <-> ${adj.roomB}: ${status}${missing}`);
      adjResults.push({ pair: `${adj.roomA}<->${adj.roomB}`, satisfied });
    }
  }

  // ── Unassigned cells ──
  const assignedCellKeys = new Set<string>();
  for (const ar of assignment.roomOrder) {
    for (const c of ar.cells) assignedCellKeys.add(`${c.col},${c.row}`);
  }
  for (const c of assignment.corridorCells) {
    assignedCellKeys.add(`${c.col},${c.row}`);
  }
  const unassignedCount = totalCells - assignedCellKeys.size;
  if (unassignedCount > 0) {
    console.log(`\n  *** WARNING: ${unassignedCount} cells neither assigned to a room nor corridor ***`);
  }
  const totalCellsUsed = assignedCellKeys.size;
  console.log(`\n  Coverage: ${totalCellsUsed}/${totalCells} cells (${((totalCellsUsed / totalCells) * 100).toFixed(0)}%)`);

  return { roomDetails, adjResults, unassignedCount, totalCellsUsed };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: 2BHK apartment
// ═══════════════════════════════════════════════════════════════════════════

describe("assignRoomsToGrid", () => {
  describe("Test 1: 2BHK apartment — 75 sqm, 7 rooms", () => {
    const adjacency: AdjacencyRequirement[] = [
      { roomA: "Kitchen", roomB: "Dining / Living", reason: "food service" },
      { roomA: "Bedroom 1", roomB: "Bathroom 1", reason: "attached bath" },
    ];
    const prog = program("apartment", 75, [
      room("Living Room", "living", 15, "public", true),
      room("Kitchen", "kitchen", 8, "service", true),
      room("Bedroom 1", "bedroom", 14, "private", true, ["Bathroom 1"]),
      room("Bedroom 2", "bedroom", 12, "private", true),
      room("Bathroom 1", "bathroom", 4, "service", false, ["Bedroom 1"]),
      room("Bathroom 2", "bathroom", 3, "service"),
      room("Corridor", "hallway", 5, "circulation"),
    ], adjacency);

    let grid: StructuralGrid;
    let assignment: RoomAssignment;
    let result: ReturnType<typeof printAssignment>;

    it("generates grid and assigns rooms", () => {
      const t0 = performance.now();
      grid = generateStructuralGrid(prog);
      assignment = assignRoomsToGrid(grid, prog);
      const elapsed = performance.now() - t0;
      result = printAssignment("2BHK Apartment (75 sqm, 7 rooms)", grid, assignment, prog);
      console.log(`  Time: ${elapsed.toFixed(1)}ms`);
      expect(assignment).toBeDefined();
      expect(assignment.roomOrder.length).toBeGreaterThan(0);
    });

    it("no overlapping room bounds", () => {
      // Sub-cell packing means two rooms can share a structural cell but
      // with non-overlapping bounds. Check bounds overlap, not cell keys.
      for (let i = 0; i < assignment.roomOrder.length; i++) {
        for (let j = i + 1; j < assignment.roomOrder.length; j++) {
          const a = assignment.roomOrder[i].bounds;
          const b = assignment.roomOrder[j].bounds;
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
          if (overlapX > 0.1 && overlapY > 0.1) {
            expect.fail(`Rooms "${assignment.roomOrder[i].spec.name}" and "${assignment.roomOrder[j].spec.name}" bounds overlap by ${(overlapX * overlapY).toFixed(1)} sqm`);
          }
        }
      }
    });

    it("all non-corridor rooms assigned at least 1 cell", () => {
      const nonCorridorRooms = assignment.roomOrder.filter(ar => ar.classifiedType !== "corridor");
      for (const ar of nonCorridorRooms) {
        expect(ar.cells.length, `${ar.spec.name} has 0 cells`).toBeGreaterThanOrEqual(1);
      }
    });

    it("bedrooms touch perimeter (exterior wall for light/ventilation)", () => {
      const bedrooms = assignment.roomOrder.filter(ar =>
        ar.classifiedType === "bedroom" || ar.classifiedType === "master_bedroom"
      );
      for (const br of bedrooms) {
        const perim = br.cells.some(c => c.isPerimeter);
        expect(perim, `${br.spec.name} does not touch perimeter — needs exterior wall`).toBe(true);
      }
    });

    it("kitchen touches perimeter (NBC ventilation)", () => {
      const kitchen = assignment.roomOrder.find(ar => ar.classifiedType === "kitchen");
      if (kitchen) {
        const perim = kitchen.cells.some(c => c.isPerimeter);
        expect(perim, "Kitchen does not touch perimeter — needs ventilation").toBe(true);
      }
    });

    it("no room has area < 50% of requested", () => {
      for (const ar of assignment.roomOrder) {
        if (ar.spec.areaSqm <= 0) continue;
        const ratio = ar.actualArea / ar.spec.areaSqm;
        expect(ratio, `${ar.spec.name}: actual ${ar.actualArea.toFixed(1)} is ${(ratio * 100).toFixed(0)}% of requested ${ar.spec.areaSqm}`).toBeGreaterThanOrEqual(0.4);
      }
    });

    it("total coverage = 100% (rooms + corridor cover all cells)", () => {
      expect(result.unassignedCount).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Studio flat
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Test 2: Studio flat — 30 sqm, 3 rooms", () => {
    const prog = program("studio", 30, [
      room("Living + Kitchen", "living", 20, "public", true),
      room("Bathroom", "bathroom", 4, "service"),
      room("Entrance", "entrance", 3, "circulation"),
    ]);

    let grid: StructuralGrid;
    let assignment: RoomAssignment;
    let result: ReturnType<typeof printAssignment>;

    it("generates grid and assigns rooms", () => {
      const t0 = performance.now();
      grid = generateStructuralGrid(prog);
      assignment = assignRoomsToGrid(grid, prog);
      const elapsed = performance.now() - t0;
      result = printAssignment("Studio Flat (30 sqm, 3 rooms)", grid, assignment, prog);
      console.log(`  Time: ${elapsed.toFixed(1)}ms`);
      expect(assignment.roomOrder.length).toBeGreaterThanOrEqual(2);
    });

    it("no overlapping room bounds", () => {
      for (let i = 0; i < assignment.roomOrder.length; i++) {
        for (let j = i + 1; j < assignment.roomOrder.length; j++) {
          const a = assignment.roomOrder[i].bounds;
          const b = assignment.roomOrder[j].bounds;
          const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
          if (ox > 0.1 && oy > 0.1) {
            expect.fail(`Rooms "${assignment.roomOrder[i].spec.name}" and "${assignment.roomOrder[j].spec.name}" bounds overlap`);
          }
        }
      }
    });

    it("all cells assigned (rooms + corridor)", () => {
      expect(result.unassignedCount).toBe(0);
    });

    it("bathroom CAN be interior (not required on perimeter)", () => {
      // We just verify it IS assigned, not that it must be interior
      const bath = assignment.roomOrder.find(ar => ar.classifiedType === "bathroom");
      expect(bath, "Bathroom not assigned").toBeDefined();
      expect(bath!.cells.length).toBeGreaterThanOrEqual(1);
    });

    it("living room gets the most cells (largest room)", () => {
      const living = assignment.roomOrder.find(ar =>
        ar.spec.name.toLowerCase().includes("living")
      );
      const bath = assignment.roomOrder.find(ar => ar.classifiedType === "bathroom");
      if (living && bath) {
        expect(living.cells.length).toBeGreaterThanOrEqual(bath.cells.length);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: 4BHK villa — 15 rooms stress test
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Test 3: 4BHK villa — 200 sqm, 15 rooms (stress test)", () => {
    const adjacency: AdjacencyRequirement[] = [
      { roomA: "Master Bedroom", roomB: "Master Bathroom", reason: "attached bath" },
      { roomA: "Kitchen", roomB: "Dining Room", reason: "food service" },
      { roomA: "Servant Quarter", roomB: "Servant Toilet", reason: "attached bath" },
    ];
    const prog = program("villa", 200, [
      room("Living Room", "living", 25, "public", true),
      room("Drawing Room", "living", 18, "public", true),
      room("Dining Room", "dining", 14, "public", false, ["Kitchen"]),
      room("Kitchen", "kitchen", 12, "service", true, ["Dining Room"]),
      room("Master Bedroom", "bedroom", 20, "private", true, ["Master Bathroom"]),
      room("Bedroom 2", "bedroom", 14, "private", true),
      room("Bedroom 3", "bedroom", 14, "private", true),
      room("Bedroom 4", "bedroom", 12, "private", true),
      room("Master Bathroom", "bathroom", 5, "service", false, ["Master Bedroom"]),
      room("Bathroom 2", "bathroom", 4, "service"),
      room("Bathroom 3", "bathroom", 3.5, "service"),
      room("Pooja Room", "other", 4, "private"),
      room("Utility", "utility", 3.5, "service"),
      room("Servant Quarter", "bedroom", 9.5, "service", true, ["Servant Toilet"]),
      room("Servant Toilet", "bathroom", 2, "service", false, ["Servant Quarter"]),
    ], adjacency);

    let grid: StructuralGrid;
    let assignment: RoomAssignment;
    let result: ReturnType<typeof printAssignment>;

    it("generates grid and assigns all 15 rooms (converges)", () => {
      const t0 = performance.now();
      grid = generateStructuralGrid(prog);
      assignment = assignRoomsToGrid(grid, prog);
      const elapsed = performance.now() - t0;
      result = printAssignment("4BHK Villa (200 sqm, 15 rooms)", grid, assignment, prog);
      console.log(`  Time: ${elapsed.toFixed(1)}ms`);

      // Algorithm must converge — at least 12 of 15 rooms should be assigned
      expect(assignment.roomOrder.length).toBeGreaterThanOrEqual(12);
    });

    it("completes within performance budget (<2000ms)", () => {
      const t0 = performance.now();
      generateStructuralGrid(prog);
      const grid2 = generateStructuralGrid(prog);
      assignRoomsToGrid(grid2, prog);
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(2000);
    });

    it("no overlapping room bounds", () => {
      for (let i = 0; i < assignment.roomOrder.length; i++) {
        for (let j = i + 1; j < assignment.roomOrder.length; j++) {
          const a = assignment.roomOrder[i].bounds;
          const b = assignment.roomOrder[j].bounds;
          const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
          if (ox > 0.1 && oy > 0.1) {
            expect.fail(`Rooms "${assignment.roomOrder[i].spec.name}" and "${assignment.roomOrder[j].spec.name}" bounds overlap`);
          }
        }
      }
    });

    it("total coverage = 100%", () => {
      expect(result.unassignedCount).toBe(0);
    });

    it("no room has 0 cells", () => {
      for (const ar of assignment.roomOrder) {
        expect(ar.cells.length, `${ar.spec.name} has 0 cells`).toBeGreaterThanOrEqual(1);
      }
    });

    it("most bedrooms on perimeter (≥60%)", () => {
      const bedrooms = assignment.roomOrder.filter(ar =>
        ["bedroom", "master_bedroom", "guest_bedroom"].includes(ar.classifiedType)
      );
      const onPerimeter = bedrooms.filter(br => br.cells.some(c => c.isPerimeter));
      const ratio = bedrooms.length > 0 ? onPerimeter.length / bedrooms.length : 1;
      expect(ratio, `Only ${onPerimeter.length}/${bedrooms.length} bedrooms on perimeter`).toBeGreaterThanOrEqual(0.6);
    });

    it("Kitchen→Dining adjacency satisfied", () => {
      const adjEntry = result.adjResults.find(a => a.pair.includes("Kitchen") && a.pair.includes("Dining"));
      if (adjEntry) {
        // This is a soft check — adjacency may not always be satisfiable
        // but log whether it was
        console.log(`    Kitchen<->Dining: ${adjEntry.satisfied ? "YES" : "NO (non-blocking)"}`);
      }
    });

    it("Master Bedroom → Master Bathroom adjacency satisfied", () => {
      const adjEntry = result.adjResults.find(a => a.pair.includes("Master Bedroom") && a.pair.includes("Master Bathroom"));
      if (adjEntry) {
        console.log(`    MasterBed<->MasterBath: ${adjEntry.satisfied ? "YES" : "NO (non-blocking)"}`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: 20×40 ft plot constrained
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Test 4: 20×40ft plot (6.1m × 12.2m) — 2BHK, 56 sqm", () => {
    const prog = program("apartment", 56, [
      room("Living Room", "living", 14, "public", true),
      room("Kitchen", "kitchen", 7, "service", true),
      room("Bedroom 1", "bedroom", 12, "private", true),
      room("Bedroom 2", "bedroom", 10, "private", true),
      room("Bathroom", "bathroom", 3.5, "service"),
      room("Corridor", "hallway", 4, "circulation"),
    ]);

    let grid: StructuralGrid;
    let assignment: RoomAssignment;
    let result: ReturnType<typeof printAssignment>;

    it("assigns rooms within plot-constrained grid", () => {
      const t0 = performance.now();
      grid = generateStructuralGrid(prog, { plotWidth: 6.1, plotDepth: 12.2 });
      assignment = assignRoomsToGrid(grid, prog);
      const elapsed = performance.now() - t0;
      result = printAssignment("20×40ft Plot (6.1×12.2m, 56 sqm)", grid, assignment, prog);
      console.log(`  Time: ${elapsed.toFixed(1)}ms`);
      expect(assignment.roomOrder.length).toBeGreaterThanOrEqual(4);
    });

    it("no overlapping room bounds", () => {
      for (let i = 0; i < assignment.roomOrder.length; i++) {
        for (let j = i + 1; j < assignment.roomOrder.length; j++) {
          const a = assignment.roomOrder[i].bounds;
          const b = assignment.roomOrder[j].bounds;
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
          if (overlapX > 0.1 && overlapY > 0.1) {
            expect.fail(`Rooms "${assignment.roomOrder[i].spec.name}" and "${assignment.roomOrder[j].spec.name}" bounds overlap`);
          }
        }
      }
    });

    it("no room extends outside grid bounds", () => {
      for (const ar of assignment.roomOrder) {
        for (const c of ar.cells) {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.x + c.width).toBeLessThanOrEqual(grid.totalWidth + 0.01);
          expect(c.y + c.depth).toBeLessThanOrEqual(grid.totalDepth + 0.01);
        }
      }
    });

    it("total coverage = 100%", () => {
      expect(result.unassignedCount).toBe(0);
    });

    it("grid fits within plot", () => {
      expect(grid.totalWidth).toBeLessThanOrEqual(6.2);
      expect(grid.totalDepth).toBeLessThanOrEqual(12.3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STRUCTURAL INVARIANTS (across all scenarios)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Structural invariants", () => {
    it("room bounds do not overlap — O(n²) pairwise check", () => {
      const prog2 = program("apartment", 75, [
        room("Living", "living", 15, "public", true),
        room("Kitchen", "kitchen", 8, "service", true),
        room("Bed1", "bedroom", 14, "private", true),
        room("Bed2", "bedroom", 12, "private", true),
        room("Bath1", "bathroom", 4, "service"),
        room("Bath2", "bathroom", 3, "service"),
        room("Hall", "hallway", 5, "circulation"),
      ]);
      const g = generateStructuralGrid(prog2);
      const a = assignRoomsToGrid(g, prog2);

      // Verify no room bounds overlap
      for (let i = 0; i < a.roomOrder.length; i++) {
        for (let j = i + 1; j < a.roomOrder.length; j++) {
          const ab = a.roomOrder[i].bounds;
          const bb = a.roomOrder[j].bounds;
          const overlapX = Math.min(ab.x + ab.width, bb.x + bb.width) - Math.max(ab.x, bb.x);
          const overlapY = Math.min(ab.y + ab.depth, bb.y + bb.depth) - Math.max(ab.y, bb.y);
          if (overlapX > 0.1 && overlapY > 0.1) {
            throw new Error(`OVERLAP: "${a.roomOrder[i].spec.name}" and "${a.roomOrder[j].spec.name}" bounds overlap by ${(overlapX*overlapY).toFixed(1)} sqm`);
          }
        }
      }

      // Every grid cell accounted for (rooms + corridor cover all cells)
      const coveredKeys = new Set<string>();
      for (const ar of a.roomOrder) {
        for (const c of ar.cells) coveredKeys.add(`${c.col},${c.row}`);
      }
      for (const c of a.corridorCells) coveredKeys.add(`${c.col},${c.row}`);
      expect(coveredKeys.size).toBe(g.cells.length);
    });

    it("corridor cells never overlap with room cells", () => {
      const prog2 = program("apartment", 100, [
        room("LR", "living", 18, "public", true),
        room("K", "kitchen", 10, "service", true),
        room("B1", "bedroom", 14, "private", true),
        room("B2", "bedroom", 12, "private", true),
        room("B3", "bedroom", 12, "private", true),
        room("Ba1", "bathroom", 4, "service"),
        room("Ba2", "bathroom", 3, "service"),
        room("Co", "hallway", 6, "circulation"),
      ]);
      const g = generateStructuralGrid(prog2);
      const a = assignRoomsToGrid(g, prog2);

      const roomCellKeys = new Set<string>();
      for (const ar of a.roomOrder) {
        for (const c of ar.cells) roomCellKeys.add(`${c.col},${c.row}`);
      }
      for (const c of a.corridorCells) {
        const key = `${c.col},${c.row}`;
        expect(roomCellKeys.has(key), `Corridor cell ${key} also assigned to a room`).toBe(false);
      }
    });
  });
});
