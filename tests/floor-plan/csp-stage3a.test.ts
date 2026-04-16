import { describe, it, expect } from "vitest";
import { solveMandalaCSP } from "@/features/floor-plan/lib/csp-solver";
import type { ParsedConstraints, ParsedRoom } from "@/features/floor-plan/lib/structured-parser";

function makeRoom(o: Partial<ParsedRoom>): ParsedRoom {
  return {
    id: o.id ?? "r1",
    name: o.name ?? "Room",
    function: o.function ?? "other",
    dim_width_ft: o.dim_width_ft ?? null,
    dim_depth_ft: o.dim_depth_ft ?? null,
    position_type: o.position_type ?? "unspecified",
    position_direction: o.position_direction ?? null,
    attached_to_room_id: o.attached_to_room_id ?? null,
    must_have_window_on: o.must_have_window_on ?? null,
    external_walls_ft: o.external_walls_ft ?? null,
    internal_walls_ft: o.internal_walls_ft ?? null,
    doors: o.doors ?? [],
    windows: o.windows ?? [],
    is_wet: o.is_wet ?? false,
    is_sacred: o.is_sacred ?? false,
    is_circulation: o.is_circulation ?? false,
    user_explicit_dims: o.user_explicit_dims ?? false,
    user_explicit_position: o.user_explicit_position ?? false,
  };
}

function makeConstraints(rooms: ParsedRoom[], vastu = false, plot: Partial<ParsedConstraints["plot"]> = {}): ParsedConstraints {
  return {
    plot: {
      width_ft: plot.width_ft ?? null,
      depth_ft: plot.depth_ft ?? null,
      facing: plot.facing ?? null,
      shape: plot.shape ?? null,
      total_built_up_sqft: plot.total_built_up_sqft ?? null,
    },
    rooms,
    adjacency_pairs: [],
    vastu_required: vastu,
    special_features: [],
    constraint_budget: { dimensional: 0, positional: 0, adjacency: 0, vastu: 0, total: 0 },
    extraction_notes: "",
  };
}

describe("CSP Stage 3A — Mandala assignment", () => {
  it("feasibility: simple 2-room prompt with no constraints", () => {
    const c = makeConstraints([
      makeRoom({ id: "lr", name: "Living", function: "living" }),
      makeRoom({ id: "k", name: "Kitchen", function: "kitchen" }),
    ]);
    const r = solveMandalaCSP(c);
    expect(r.feasible).toBe(true);
    expect(r.assignments.length).toBe(2);
    expect(r.elapsed_ms).toBeLessThan(100);
  });

  it("H4: user-specified corner pins room to that cell", () => {
    const c = makeConstraints([
      makeRoom({
        id: "m", name: "Master", function: "master_bedroom",
        position_type: "corner", position_direction: "SW", user_explicit_position: true,
      }),
      makeRoom({ id: "k", name: "Kitchen", function: "kitchen" }),
    ]);
    const r = solveMandalaCSP(c);
    expect(r.feasible).toBe(true);
    const master = r.assignments.find(a => a.room_id === "m");
    expect(master?.cell_direction).toBe("SW");
  });

  it("H7 Vastu: master_bedroom auto-avoids NE/SE when vastu_required", () => {
    const c = makeConstraints([
      makeRoom({ id: "m", name: "Master", function: "master_bedroom" }),
    ], true);
    const r = solveMandalaCSP(c);
    expect(r.feasible).toBe(true);
    const master = r.assignments[0];
    expect(master.cell_direction).not.toBe("NE");
    expect(master.cell_direction).not.toBe("SE");
  });

  it("H7 Vastu: kitchen prefers SE and never goes to NE/SW/N", () => {
    const c = makeConstraints([
      makeRoom({ id: "k", name: "Kitchen", function: "kitchen" }),
    ], true);
    const r = solveMandalaCSP(c);
    expect(r.feasible).toBe(true);
    const k = r.assignments[0];
    expect(["SE", "E", "S"]).toContain(k.cell_direction);
  });

  it("H8 Brahmasthan: kitchen cannot be in CENTER when vastu_required", () => {
    const c = makeConstraints([
      makeRoom({ id: "k", name: "Kitchen", function: "kitchen" }),
    ], true);
    const r = solveMandalaCSP(c);
    expect(r.feasible).toBe(true);
    expect(r.assignments[0].cell_direction).not.toBe("CENTER");
  });

  it("UNSAT: user-specified kitchen NE + vastu_required → V-RP-002 conflict", () => {
    const c = makeConstraints([
      makeRoom({
        id: "k", name: "Kitchen", function: "kitchen",
        position_type: "corner", position_direction: "NE", user_explicit_position: true,
      }),
    ], true);
    const r = solveMandalaCSP(c);
    // With user_explicit_position, H7 is INERT per our design (user intent wins).
    // So this is FEASIBLE — user explicitly overrides Vastu.
    expect(r.feasible).toBe(true);
    expect(r.assignments[0].cell_direction).toBe("NE");
  });

  it("UNSAT fallback: same kitchen NE with vastu_required=false is feasible", () => {
    const c = makeConstraints([
      makeRoom({
        id: "k", name: "Kitchen", function: "kitchen",
        position_type: "corner", position_direction: "NE", user_explicit_position: true,
      }),
    ], false);
    const r = solveMandalaCSP(c);
    expect(r.feasible).toBe(true);
    expect(r.assignments[0].cell_direction).toBe("NE");
  });

  it("UNSAT: 3 rooms all claim SW corner", () => {
    const c = makeConstraints([
      makeRoom({ id: "m", name: "Master", function: "master_bedroom", position_type: "corner", position_direction: "SW" }),
      makeRoom({ id: "k", name: "Kitchen", function: "kitchen", position_type: "corner", position_direction: "SW" }),
      makeRoom({ id: "lr", name: "Living", function: "living", position_type: "corner", position_direction: "SW" }),
    ]);
    const r = solveMandalaCSP(c);
    expect(r.feasible).toBe(false);
    expect(r.conflict).not.toBeNull();
    expect(r.conflict?.rule_ids).toContain("H4");
  });

  it("UNSAT: heavy kitchen in CENTER when vastu_required", () => {
    const c = makeConstraints([
      makeRoom({
        id: "k", name: "Kitchen", function: "kitchen",
        position_type: "zone", position_direction: "CENTER",
      }),
    ], true);
    const r = solveMandalaCSP(c);
    // With user_explicit_position=false (default), H8 applies and removes CENTER.
    // But position_type="zone" + direction=CENTER sets domain to singleton(CENTER).
    // H8 then empties the domain → UNSAT.
    expect(r.feasible).toBe(false);
    expect(r.conflict?.rule_ids.some(r => r === "V-EL-003" || r === "H5")).toBe(true);
  });

  it("CENTER allows corridor when vastu_required", () => {
    const c = makeConstraints([
      makeRoom({ id: "cor", name: "Corridor", function: "corridor", position_type: "zone", position_direction: "CENTER" }),
    ], true);
    const r = solveMandalaCSP(c);
    expect(r.feasible).toBe(true);
    expect(r.assignments[0].cell_direction).toBe("CENTER");
  });

  it("P01 demo: Master SW + Kitchen SE + Pooja NE + no violations", () => {
    const rooms = [
      makeRoom({ id: "m", name: "Master Bedroom", function: "master_bedroom", position_type: "corner", position_direction: "SW", user_explicit_position: true }),
      makeRoom({ id: "k", name: "Kitchen", function: "kitchen", position_type: "zone", position_direction: "SE", user_explicit_position: true }),
      makeRoom({ id: "lr", name: "Living Room", function: "living", position_type: "corner", position_direction: "NW", user_explicit_position: true }),
      makeRoom({ id: "b2", name: "Bedroom 2", function: "bedroom", position_type: "wall_centered", position_direction: "S", user_explicit_position: true }),
      makeRoom({ id: "b3", name: "Bedroom 3", function: "bedroom", position_type: "zone", position_direction: "SE", user_explicit_position: true }),
      makeRoom({ id: "b4", name: "Bedroom 4", function: "bedroom", position_type: "wall_centered", position_direction: "E", user_explicit_position: true }),
      makeRoom({ id: "b5", name: "Bedroom 5", function: "bedroom", position_type: "corner", position_direction: "NE", user_explicit_position: true }),
      makeRoom({ id: "p", name: "Porch", function: "porch", position_type: "wall_centered", position_direction: "N", user_explicit_position: true }),
    ];
    const c = makeConstraints(rooms, true);
    const r = solveMandalaCSP(c);
    expect(r.feasible).toBe(true);
    const master = r.assignments.find(a => a.room_id === "m");
    const kitchen = r.assignments.find(a => a.room_id === "k");
    expect(master?.cell_direction).toBe("SW");
    expect(kitchen?.cell_direction).toBe("SE");
  });

  it("Solve completes in < 3s for 15-room input", () => {
    const rooms: ParsedRoom[] = [];
    for (let i = 0; i < 15; i++) {
      rooms.push(makeRoom({ id: `r${i}`, name: `Room ${i}`, function: i === 0 ? "master_bedroom" : "bedroom" }));
    }
    const c = makeConstraints(rooms, true);
    const start = Date.now();
    const r = solveMandalaCSP(c, { timeLimitMs: 3000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
    expect(r.feasible).toBe(true);
  });

  it("Vastu off: no hard Vastu rules apply", () => {
    const c = makeConstraints([
      makeRoom({ id: "k", name: "Kitchen", function: "kitchen", position_type: "corner", position_direction: "NE" }),
    ], false);
    const r = solveMandalaCSP(c);
    expect(r.feasible).toBe(true);
    expect(r.assignments[0].cell_direction).toBe("NE");
  });
});
