/**
 * Layer-1 verification for the v7 prompt fix.
 *
 * Calls `enrichBrief()` directly (no sandbox, no HTTP, no DB) on the
 * canonical L-shape office brief and checks two invariants:
 *
 *   1. The first non-trivial space has a polygon_world_m with > 4 vertices
 *      (proves Opus is now emitting the L outline, not a 4-vertex
 *      bounding rectangle — the v6 failure mode).
 *   2. site.bounds_m matches the AABB of the polygon (10×8), not the
 *      flattened linear extent (14×4).
 *
 * Runs in ~30-60s for ~$0.05 (one Opus 4.7 enrichment call).
 *
 * Usage: npx tsx scripts/forensics/verify-l-shape-enrichment.ts
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
import { enrichBrief } from "@/features/brief-to-ifc/v3/brief-enrichment";

loadEnv({ path: path.resolve(process.cwd(), ".env.local") });

const L_SHAPE_BRIEF =
  "L-shaped open office, with one 10m long arm by 4m wide and a 4m by 4m " +
  "extension at right angles. 3.2m ceiling height. 8 workstations in the " +
  "long arm laid out in two rows of 4 desks, a meeting table seating 6 in " +
  "the extension, kitchenette with sink and counter in the corner where the " +
  "L joins. Polished concrete floor, exposed ceiling, glass partitions for " +
  "the meeting area.";

async function main(): Promise<void> {
  console.log("→ enrichBrief() on L-shape brief…");
  const t0 = Date.now();
  const result = await enrichBrief({
    brief: L_SHAPE_BRIEF,
    projectType: "office",
  });
  const ms = Date.now() - t0;

  if (!result.ok || !result.brief) {
    console.error(`✗ enrichment failed (${ms}ms): ${result.error?.message}`);
    process.exit(1);
  }

  const brief = result.brief;
  console.log(`✓ enrichment done in ${ms}ms · cost $${result.costUsd.toFixed(4)}`);
  console.log("");
  console.log("─── site ───────────────────────────────────────────────");
  console.log(`bounds_m:       [${brief.site.bounds_m.join(", ")}]`);
  console.log(`height_limit_m: ${brief.site.height_limit_m}`);
  console.log("");
  console.log("─── spaces ─────────────────────────────────────────────");
  for (const sp of brief.spaces) {
    const poly = sp.polygon_world_m;
    const polyDesc = poly === null
      ? "null"
      : `${poly.length} vertices: ${JSON.stringify(poly)}`;
    console.log(`${sp.id} (${sp.name}): polygon=${polyDesc}`);
  }

  // ── Invariant checks ──────────────────────────────────────────────
  const issues: string[] = [];

  const [w, d] = brief.site.bounds_m;
  // The L-shape AABB is 10×8. Anything close to 14×4 (flattened) is the
  // failure. Allow a wide tolerance for the agent's interpretation.
  if (w > 12 || d < 6) {
    issues.push(
      `site.bounds_m ${w}×${d} looks flattened (v6 failure mode); expected ~10×8 AABB`,
    );
  }

  const spacesWithPolygon = brief.spaces.filter(s => s.polygon_world_m !== null);
  if (spacesWithPolygon.length === 0) {
    issues.push("no space has polygon_world_m (every space is null)");
  }

  const irregularSpaces = spacesWithPolygon.filter(s => {
    const poly = s.polygon_world_m!;
    return poly.length > 4;
  });

  if (irregularSpaces.length === 0) {
    issues.push(
      `no space has > 4 vertices (all polygons are simple rectangles) — ` +
      `expected at least one L-shape outline with 6+ vertices`,
    );
  }

  // Doors/windows for Gap B — the brief doesn't strongly imply doors, but
  // glass partitions for the meeting area COULD map to windows. Don't
  // make this a hard check; just report what's emitted.
  const doorElements = brief.elements.filter(e => e.type === "door");
  const windowElements = brief.elements.filter(e => e.type === "window");
  console.log("");
  console.log("─── typed openings ──────────────────────────────────────");
  console.log(`type:"door" elements:   ${doorElements.length}`);
  console.log(`type:"window" elements: ${windowElements.length}`);

  // ── Verdict ───────────────────────────────────────────────────────
  console.log("");
  console.log("─── invariant checks ───────────────────────────────────");
  if (issues.length === 0) {
    console.log("✓ ALL INVARIANTS PASS — Layer 1 prompt fix works for L-shape");
    console.log(`  bounds_m: [${w}, ${d}] (AABB of L)`);
    console.log(`  irregular spaces: ${irregularSpaces.length}`);
    process.exit(0);
  } else {
    console.log("✗ INVARIANT FAILURES:");
    for (const issue of issues) {
      console.log(`  - ${issue}`);
    }
    process.exit(2);
  }
}

main().catch(err => {
  console.error("script crashed:", err);
  process.exit(1);
});
