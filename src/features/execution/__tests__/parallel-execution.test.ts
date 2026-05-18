/**
 * Integration test: parallel execution + fan-in merge.
 *
 * Simulates three parallel nodes (TR-028, TR-030, TR-031) each
 * producing a BriefSpec mutation, then verifies that the merge
 * produces a BriefSpec with all three mutations intact.
 */

import { describe, it, expect } from "vitest";
import { mergeBriefSpecs, isBriefSpecLike } from "../utils/spec-merge";
import type { BriefSpec } from "@/features/brief-to-ifc/v3/types";

function makeBaseSpec(): BriefSpec {
  return {
    project: { name: "Parallel Test", type: "office", location: "Delhi", description: "Parallel exec test" },
    site: { bounds_m: [50, 40], height_limit_m: 20, coordinate_origin: "sw_corner" },
    spaces: [{ id: "s1", name: "Hall", long_name: "Main Hall", polygon_world_m: [[0,0],[20,0],[20,15],[0,15]], height_m: 3, occupancy_type: "office" }],
    elements: [{ id: "e1", type: "wall", origin_world_m: [0,0,0], dims_m: [20, 0.2, 3], material_id: "m1", description: "Wall", object_type: "Wall", tag: "W1" }],
    materials: [{ id: "m1", name: "Concrete", rgb: [0.7, 0.7, 0.7], roughness: 0.8, method: "MATT", category: "Structural" }],
    brand_language: { primary_text: "Modern", approved_terms: [], forbidden_terms: [] },
    furniture: [{ id: "x", type: "table", count: 1, material_id: "m1", description: "Table" }],
  };
}

describe("parallel execution + merge integration", () => {
  it("three parallel async tasks merge correctly with wall time < sequential", async () => {
    const base = makeBaseSpec();
    const start = Date.now();

    // Simulate 3 parallel node executions with 200ms delay each
    const [nodeAResult, nodeBResult, nodeCResult] = await Promise.all([
      // nodeA: Item Decomposer — adds parts
      new Promise<BriefSpec>((resolve) => {
        setTimeout(() => {
          const spec = structuredClone(base);
          spec.furniture = [{
            id: "x",
            type: "table",
            count: 1,
            material_id: "m1",
            description: "Table",
            parts: [
              { id: "p1", subtype: "top", origin_local_m: [0,0,0.7], dims_m: [1.0,0.5,0.03], material_id: "m1", shape: "box", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
              { id: "p2", subtype: "leg", origin_local_m: [0,0,0], dims_m: [0.05,0.05,0.7], material_id: "m1", shape: "cylinder", rotation_z_rad: 0, ifc_class: "IfcFurnishingElement" },
            ],
          }];
          resolve(spec);
        }, 200);
      }),
      // nodeB: Trim Specifier — adds trim
      new Promise<BriefSpec>((resolve) => {
        setTimeout(() => {
          const spec = structuredClone(base);
          spec.trim = [
            { id: "t1", type: "skirting", hostId: "e1", material_id: "m1", rotation_z_rad: 0, ifc_class: "IfcCovering" },
          ];
          resolve(spec);
        }, 200);
      }),
      // nodeC: Material Resolver — resolves materials
      new Promise<BriefSpec>((resolve) => {
        setTimeout(() => {
          const spec = structuredClone(base);
          spec.materials = [
            { id: "m1", name: "Polished Concrete", rgb: [0.75,0.75,0.72], roughness: 0.3, method: "PHONG", category: "Structural" },
          ];
          resolve(spec);
        }, 200);
      }),
    ]);

    const wallTime = Date.now() - start;

    // All three are BriefSpec-like
    expect(isBriefSpecLike(nodeAResult)).toBe(true);
    expect(isBriefSpecLike(nodeBResult)).toBe(true);
    expect(isBriefSpecLike(nodeCResult)).toBe(true);

    // Merge the results
    const merged = mergeBriefSpecs([base, nodeAResult, nodeBResult, nodeCResult]);

    // Assertions:
    // 1. Wall time proves parallelism (200ms ×3 = 600ms sequential; parallel ≈ 200ms)
    expect(wallTime).toBeLessThan(500); // generous bound for CI

    // 2. Furniture parts survived (nodeA)
    const table = merged.furniture!.find(f => f.id === "x")!;
    expect(table.parts).toHaveLength(2);
    expect(table.parts![0].id).toBe("p1");

    // 3. Trim survived (nodeB)
    expect(merged.trim).toHaveLength(1);
    expect(merged.trim![0].id).toBe("t1");
    expect(merged.trim![0].type).toBe("skirting");

    // 4. Materials normalized (nodeC)
    const mat = merged.materials.find(m => m.id === "m1")!;
    expect(mat.name).toBe("Polished Concrete");
    expect(mat.method).toBe("PHONG");

    // 5. Structural data untouched
    expect(merged.project.name).toBe("Parallel Test");
    expect(merged.spaces).toHaveLength(1);
    expect(merged.elements).toHaveLength(1);
  });
});
