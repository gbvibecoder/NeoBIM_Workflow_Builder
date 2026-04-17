import { describe, it, expect } from "vitest";
import { detectInfeasibility } from "@/features/floor-plan/lib/infeasibility-detector";
import type { ParsedConstraints, ParsedRoom } from "@/features/floor-plan/lib/structured-parser";

function makeRoom(overrides: Partial<ParsedRoom>): ParsedRoom {
  return {
    id: overrides.id ?? "r1",
    name: overrides.name ?? "Room",
    function: overrides.function ?? "other",
    dim_width_ft: overrides.dim_width_ft ?? null,
    dim_depth_ft: overrides.dim_depth_ft ?? null,
    position_type: overrides.position_type ?? "unspecified",
    position_direction: overrides.position_direction ?? null,
    attached_to_room_id: overrides.attached_to_room_id ?? null,
    must_have_window_on: overrides.must_have_window_on ?? null,
    external_walls_ft: overrides.external_walls_ft ?? null,
    internal_walls_ft: overrides.internal_walls_ft ?? null,
    doors: overrides.doors ?? [],
    windows: overrides.windows ?? [],
    is_wet: overrides.is_wet ?? false,
    is_sacred: overrides.is_sacred ?? false,
    is_circulation: overrides.is_circulation ?? false,
    user_explicit_dims: overrides.user_explicit_dims ?? false,
    user_explicit_position: overrides.user_explicit_position ?? false,
  };
}

function makeConstraints(rooms: ParsedRoom[], plot: Partial<ParsedConstraints["plot"]> = {}, vastu = false): ParsedConstraints {
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
    connects_all_groups: [],
    vastu_required: vastu,
    special_features: [],
    constraint_budget: { dimensional: 0, positional: 0, adjacency: 0, vastu: 0, total: 0 },
    extraction_notes: "",
  };
}

describe("Infeasibility Detector", () => {
  it("AREA_IMPOSSIBLE — total room area exceeds 120% of plot", () => {
    const constraints = makeConstraints(
      [
        makeRoom({ id: "b1", name: "Bedroom 1", function: "bedroom", dim_width_ft: 20, dim_depth_ft: 10 }),
        makeRoom({ id: "b2", name: "Bedroom 2", function: "bedroom", dim_width_ft: 20, dim_depth_ft: 10 }),
        makeRoom({ id: "h", name: "Hall", function: "living", dim_width_ft: 20, dim_depth_ft: 10 }),
      ],
      { width_ft: 20, depth_ft: 20 },
    );
    const r = detectInfeasibility(constraints);
    expect(r.feasible).toBe(false);
    expect(r.kind).toBe("AREA_IMPOSSIBLE");
    expect(r.reason).toMatch(/exceeds.*plot/i);
  });

  it("AREA_IMPOSSIBLE — does not flag when ratio < 1.2", () => {
    const constraints = makeConstraints(
      [
        makeRoom({ id: "b1", name: "Bedroom 1", function: "bedroom", dim_width_ft: 12, dim_depth_ft: 10 }),
        makeRoom({ id: "h", name: "Hall", function: "living", dim_width_ft: 14, dim_depth_ft: 12 }),
      ],
      { width_ft: 30, depth_ft: 25 },
    );
    const r = detectInfeasibility(constraints);
    expect(r.feasible).toBe(true);
  });

  it("ROOM_TOO_BIG — room longest dim exceeds plot longest dim (no rotation saves it)", () => {
    const constraints = makeConstraints(
      [makeRoom({ id: "lr", name: "Living", function: "living", dim_width_ft: 45, dim_depth_ft: 14 })],
      { width_ft: 30, depth_ft: 40 },
    );
    const r = detectInfeasibility(constraints);
    expect(r.feasible).toBe(false);
    expect(r.kind).toBe("ROOM_TOO_BIG");
    expect(r.reason).toMatch(/Living.*exceeds plot/i);
  });

  it("POSITION_CONFLICT — two corner rooms claim the same direction", () => {
    const constraints = makeConstraints(
      [
        makeRoom({ id: "m", name: "Master", function: "master_bedroom", position_type: "corner", position_direction: "SW" }),
        makeRoom({ id: "k", name: "Kitchen", function: "kitchen", position_type: "corner", position_direction: "SW" }),
      ],
      { width_ft: 40, depth_ft: 40 },
      true,
    );
    const r = detectInfeasibility(constraints);
    expect(r.feasible).toBe(false);
    expect(r.kind).toBe("POSITION_CONFLICT");
    expect(r.reason).toMatch(/SW corner/);
    expect(r.reason).toMatch(/Master/);
    expect(r.reason).toMatch(/Kitchen/);
  });

  it("POSITION_CONFLICT — two zone rooms in same zone do NOT conflict", () => {
    const constraints = makeConstraints(
      [
        makeRoom({ id: "b1", name: "Bedroom 2", function: "bedroom", position_type: "zone", position_direction: "N" }),
        makeRoom({ id: "b2", name: "Bedroom 3", function: "bedroom", position_type: "zone", position_direction: "N" }),
      ],
      { width_ft: 40, depth_ft: 40 },
    );
    const r = detectInfeasibility(constraints);
    expect(r.feasible).toBe(true);
  });

  it("VASTU_CONFLICT — kitchen in NE violates V-RP-002", () => {
    const constraints = makeConstraints(
      [makeRoom({ id: "k", name: "Kitchen", function: "kitchen", position_type: "zone", position_direction: "NE" })],
      { width_ft: 40, depth_ft: 40 },
      true,
    );
    const r = detectInfeasibility(constraints);
    expect(r.feasible).toBe(false);
    expect(r.kind).toBe("VASTU_CONFLICT");
    expect(r.reason).toMatch(/V-RP-002/);
    expect(r.reason).toMatch(/Kitchen/);
    expect(r.reason).toMatch(/NE/);
  });

  it("VASTU_CONFLICT — master_bedroom in NE violates V-RP-001", () => {
    const constraints = makeConstraints(
      [makeRoom({ id: "m", name: "Master", function: "master_bedroom", position_type: "corner", position_direction: "NE" })],
      { width_ft: 40, depth_ft: 40 },
      true,
    );
    const r = detectInfeasibility(constraints);
    expect(r.feasible).toBe(false);
    expect(r.kind).toBe("VASTU_CONFLICT");
    expect(r.reason).toMatch(/V-RP-001/);
  });

  it("VASTU_CONFLICT — pooja in W violates V-RP-005", () => {
    const constraints = makeConstraints(
      [makeRoom({ id: "p", name: "Pooja", function: "pooja", position_type: "zone", position_direction: "W" })],
      { width_ft: 40, depth_ft: 40 },
      true,
    );
    const r = detectInfeasibility(constraints);
    expect(r.feasible).toBe(false);
    expect(r.kind).toBe("VASTU_CONFLICT");
    expect(r.reason).toMatch(/V-RP-005/);
  });

  it("VASTU_CONFLICT — kitchen in CENTER violates V-EL-003 (brahmasthan)", () => {
    const constraints = makeConstraints(
      [makeRoom({ id: "k", name: "Kitchen", function: "kitchen", position_type: "zone", position_direction: "CENTER" })],
      { width_ft: 40, depth_ft: 40 },
      true,
    );
    const r = detectInfeasibility(constraints);
    expect(r.feasible).toBe(false);
    expect(r.kind).toBe("VASTU_CONFLICT");
    expect(r.reason).toMatch(/V-RP-002|V-EL-003/);
  });

  it("VASTU not required — same kitchen-in-NE is feasible", () => {
    const constraints = makeConstraints(
      [makeRoom({ id: "k", name: "Kitchen", function: "kitchen", position_type: "zone", position_direction: "NE" })],
      { width_ft: 40, depth_ft: 40 },
      false,
    );
    const r = detectInfeasibility(constraints);
    expect(r.feasible).toBe(true);
  });

  it("All clear — typical 2BHK fits a 40x40 plot with valid Vastu", () => {
    const constraints = makeConstraints(
      [
        makeRoom({ id: "m", name: "Master", function: "master_bedroom", dim_width_ft: 14, dim_depth_ft: 12, position_type: "corner", position_direction: "SW" }),
        makeRoom({ id: "b2", name: "Bedroom 2", function: "bedroom", dim_width_ft: 12, dim_depth_ft: 10 }),
        makeRoom({ id: "k", name: "Kitchen", function: "kitchen", dim_width_ft: 10, dim_depth_ft: 8, position_type: "corner", position_direction: "SE" }),
        makeRoom({ id: "lr", name: "Living", function: "living", dim_width_ft: 16, dim_depth_ft: 13 }),
      ],
      { width_ft: 40, depth_ft: 40 },
      true,
    );
    const r = detectInfeasibility(constraints);
    expect(r.feasible).toBe(true);
  });
});
