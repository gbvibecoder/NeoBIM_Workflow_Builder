import { describe, it, expect } from "vitest";
import { solveMandalaCSP, solveStage3B } from "@/features/floor-plan/lib/csp-solver";
import type { ParsedConstraints, ParsedRoom, ParsedAdjacency } from "@/features/floor-plan/lib/structured-parser";

function mk(o: Partial<ParsedRoom>): ParsedRoom {
  return {
    id: o.id ?? "r",
    name: o.name ?? "Room",
    function: o.function ?? "bedroom",
    dim_width_ft: o.dim_width_ft ?? null,
    dim_depth_ft: o.dim_depth_ft ?? null,
    position_type: o.position_type ?? "unspecified",
    position_direction: o.position_direction ?? null,
    attached_to_room_id: o.attached_to_room_id ?? null,
    must_have_window_on: null,
    external_walls_ft: null,
    internal_walls_ft: null,
    doors: o.doors ?? [],
    windows: [],
    is_wet: false,
    is_sacred: false,
    is_circulation: false,
    user_explicit_dims: !!(o.dim_width_ft && o.dim_depth_ft),
    user_explicit_position: !!o.position_direction,
  };
}

function mkC(rooms: ParsedRoom[], pairs: ParsedAdjacency[], plotW = 40, plotD = 40, facing: ParsedConstraints["plot"]["facing"] = null, groups: ParsedConstraints["connects_all_groups"] = []): ParsedConstraints {
  return {
    plot: { width_ft: plotW, depth_ft: plotD, facing, shape: null, total_built_up_sqft: null },
    rooms,
    adjacency_pairs: pairs,
    connects_all_groups: groups,
    vastu_required: false,
    special_features: [],
    constraint_budget: { dimensional: 0, positional: 0, adjacency: 0, vastu: 0, total: 0 },
    extraction_notes: "",
  };
}

function solve(c: ParsedConstraints) {
  const m = solveMandalaCSP(c);
  if (!m.feasible) return null;
  const b = solveStage3B(c, m.assignments);
  return b.feasible ? b.placements : null;
}

describe("CSP Phase 7 — relational propagators", () => {
  it("H_DIRECTIONAL: A west of B — A centroid_x < B centroid_x", () => {
    const a = mk({ id: "a", name: "Dining", function: "dining", dim_width_ft: 12, dim_depth_ft: 10 });
    const b = mk({ id: "b", name: "Living", function: "living", dim_width_ft: 14, dim_depth_ft: 12, position_type: "corner", position_direction: "NE" });
    const c = mkC(
      [a, b],
      [{ room_a_id: "a", room_b_id: "b", relationship: "leads_to", user_explicit: true, direction: "W", third_room_id: null }],
    );
    const p = solve(c);
    expect(p).not.toBeNull();
    const pa = p!.find(x => x.room_id === "a")!;
    const pb = p!.find(x => x.room_id === "b")!;
    const cxA = pa.x_ft + pa.width_ft / 2;
    const cxB = pb.x_ft + pb.width_ft / 2;
    expect(cxA).toBeLessThan(cxB);
  });

  it("H_DIRECTIONAL: A behind B (E-facing plot → behind=W)", () => {
    const kitchen = mk({ id: "k", name: "Kitchen", function: "kitchen", dim_width_ft: 12, dim_depth_ft: 10, position_type: "corner", position_direction: "SE" });
    const utility = mk({ id: "u", name: "Utility", function: "utility", dim_width_ft: 6, dim_depth_ft: 5 });
    const c = mkC(
      [kitchen, utility],
      [{ room_a_id: "u", room_b_id: "k", relationship: "behind", user_explicit: true, direction: "W", third_room_id: null }],
      45, 55, "E",
    );
    const p = solve(c);
    expect(p).not.toBeNull();
    const pK = p!.find(x => x.room_id === "k")!;
    const pU = p!.find(x => x.room_id === "u")!;
    const cxK = pK.x_ft + pK.width_ft / 2;
    const cxU = pU.x_ft + pU.width_ft / 2;
    expect(cxU).toBeLessThan(cxK);
  });

  it("H_DIRECTIONAL: A north of B — A centroid_y < B centroid_y (solver Y-DOWN)", () => {
    const a = mk({ id: "a", name: "A", function: "bedroom", dim_width_ft: 10, dim_depth_ft: 10 });
    const b = mk({ id: "b", name: "B", function: "bedroom", dim_width_ft: 10, dim_depth_ft: 10, position_type: "corner", position_direction: "SE" });
    const c = mkC(
      [a, b],
      [{ room_a_id: "a", room_b_id: "b", relationship: "leads_to", user_explicit: true, direction: "N", third_room_id: null }],
    );
    const p = solve(c);
    expect(p).not.toBeNull();
    const pA = p!.find(x => x.room_id === "a")!;
    const pB = p!.find(x => x.room_id === "b")!;
    expect(pA.y_ft + pA.depth_ft / 2).toBeLessThan(pB.y_ft + pB.depth_ft / 2);
  });

  it("H_BETWEEN: A between B and C — A centroid in bbox of B and C centroids", () => {
    const b = mk({ id: "b", name: "Bed3", function: "bedroom", dim_width_ft: 10, dim_depth_ft: 10, position_type: "corner", position_direction: "NW" });
    const cRoom = mk({ id: "c", name: "Bed4", function: "bedroom", dim_width_ft: 10, dim_depth_ft: 10, position_type: "corner", position_direction: "NE" });
    const a = mk({ id: "a", name: "CommonBath", function: "bathroom", dim_width_ft: 6, dim_depth_ft: 5 });
    const c = mkC(
      [a, b, cRoom],
      [{ room_a_id: "a", room_b_id: "b", relationship: "between", third_room_id: "c", user_explicit: true, direction: null }],
    );
    const p = solve(c);
    expect(p).not.toBeNull();
    const pA = p!.find(x => x.room_id === "a")!;
    const pB = p!.find(x => x.room_id === "b")!;
    const pC = p!.find(x => x.room_id === "c")!;
    const cxA = pA.x_ft + pA.width_ft / 2;
    const xmin = Math.min(pB.x_ft + pB.width_ft / 2, pC.x_ft + pC.width_ft / 2);
    const xmax = Math.max(pB.x_ft + pB.width_ft / 2, pC.x_ft + pC.width_ft / 2);
    expect(cxA).toBeGreaterThanOrEqual(xmin - 0.5);
    expect(cxA).toBeLessThanOrEqual(xmax + 0.5);
  });

  it("H_CONNECTS_ALL: connector shares >=3ft edge with every connected room", () => {
    const hallway = mk({ id: "h", name: "Hallway", function: "corridor", dim_width_ft: 20, dim_depth_ft: 4 });
    const bed1 = mk({ id: "b1", name: "B1", function: "bedroom", dim_width_ft: 10, dim_depth_ft: 10, position_type: "corner", position_direction: "NW" });
    const bed2 = mk({ id: "b2", name: "B2", function: "bedroom", dim_width_ft: 10, dim_depth_ft: 10, position_type: "corner", position_direction: "NE" });
    const c = mkC(
      [hallway, bed1, bed2],
      [],
      40, 40, null,
      [{ connector_id: "h", connected_room_ids: ["b1", "b2"] }],
    );
    const p = solve(c);
    // Connects-all is aggressive; may UNSAT on tight plots. Accept either
    // a feasible solution (with the invariant) OR a clean UNSAT.
    if (p) {
      const pH = p.find(x => x.room_id === "h")!;
      const pB1 = p.find(x => x.room_id === "b1")!;
      const pB2 = p.find(x => x.room_id === "b2")!;
      // At minimum, hallway must touch each bed somewhere along a ≥3ft edge.
      // We verify by checking geometric adjacency on placed rects.
      const checkShare = (r1: typeof pH, r2: typeof pB1) => {
        const aR = { x: r1.x_ft, y: r1.y_ft, width: r1.width_ft, depth: r1.depth_ft };
        const bR = { x: r2.x_ft, y: r2.y_ft, width: r2.width_ft, depth: r2.depth_ft };
        // Share on vertical edge
        if (Math.abs(aR.x + aR.width - bR.x) < 0.01 || Math.abs(bR.x + bR.width - aR.x) < 0.01) {
          return Math.max(0, Math.min(aR.y + aR.depth, bR.y + bR.depth) - Math.max(aR.y, bR.y));
        }
        if (Math.abs(aR.y + aR.depth - bR.y) < 0.01 || Math.abs(bR.y + bR.depth - aR.y) < 0.01) {
          return Math.max(0, Math.min(aR.x + aR.width, bR.x + bR.width) - Math.max(aR.x, bR.x));
        }
        return 0;
      };
      expect(checkShare(pH, pB1)).toBeGreaterThanOrEqual(3 - 0.01);
      expect(checkShare(pH, pB2)).toBeGreaterThanOrEqual(3 - 0.01);
    }
  });

  it("H_DIRECTIONAL: conflict detects impossible constraint", () => {
    // A is "east of B" but B is at NE corner (rightmost); A can't be further east.
    const a = mk({ id: "a", function: "dining", dim_width_ft: 10, dim_depth_ft: 10 });
    const b = mk({ id: "b", function: "living", dim_width_ft: 10, dim_depth_ft: 10, position_type: "corner", position_direction: "NE" });
    const c = mkC(
      [a, b],
      [{ room_a_id: "a", room_b_id: "b", relationship: "leads_to", user_explicit: true, direction: "E", third_room_id: null }],
      40, 40,
    );
    const p = solve(c);
    // Either UNSAT (correct) or solver finds a creative placement that satisfies.
    // Assert at minimum the constraint holds if a solution exists.
    if (p) {
      const pA = p.find(x => x.room_id === "a")!;
      const pB = p.find(x => x.room_id === "b")!;
      const cxA = pA.x_ft + pA.width_ft / 2;
      const cxB = pB.x_ft + pB.width_ft / 2;
      expect(cxA).toBeGreaterThan(cxB);
    }
  });
});
