/**
 * Diagnostic script for the floor plan generator.
 * Run: npx tsx -r tsconfig-paths/register scripts/diagnose-floor-plan.ts
 * Or:  OPENAI_API_KEY=xxx npx tsx scripts/diagnose-floor-plan.ts
 */
import * as fs from "fs";
import * as path from "path";

// Load .env.local manually
const envPath = path.join(__dirname, "..", ".env.local");
const envContent = fs.readFileSync(envPath, "utf8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
}

// Patch require for @/ imports
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, parent: unknown) {
  if (request.startsWith("@/")) {
    const resolved = path.join(__dirname, "..", "src", request.slice(2));
    return originalResolve.call(this, resolved, parent);
  }
  return originalResolve.call(this, request, parent);
};

// Now import the modules
import { parseConstraints, type ParsedConstraints } from "../src/features/floor-plan/lib/structured-parser";
import { fillDoorMetrics } from "../src/features/floor-plan/lib/strip-pack/strip-pack-engine";
import { runLLMLayoutEngine } from "../src/features/floor-plan/lib/llm-layout-engine";
import { toFloorPlanProject } from "../src/features/floor-plan/lib/strip-pack/converter";
import { computeLayoutMetrics, computeHonestScore } from "../src/features/floor-plan/lib/layout-metrics";

const TEST_PROMPTS = [
  { name: "E 3BHK-E 38x48 (L-test)", text: "A single-storey 3BHK residential house on a 38ft x 48ft east-facing plot with total built-up area of 1600 sq ft. Vastu compliant. Main entrance 7ft x 5ft porch on east wall. Living room 15ft x 13ft northeast. Dining room 12ft x 11ft adjacent to living. Kitchen 11ft x 10ft southeast. Pooja room 5ft x 5ft near northeast. Utility 5ft x 4ft behind kitchen. Master bedroom 14ft x 12ft southwest with attached ensuite 8ft x 6ft. Bedroom 2 12ft x 11ft northwest. Bedroom 3 11ft x 10ft west-center. Common bathroom 7ft x 5ft on hallway. Store room 5ft x 4ft. 4ft hallway. External walls 9 inches, internal 5 inches, doors 3ft." },
  { name: "W 4BHK-W 50x45 (L-test)", text: "A single-storey 4BHK house on a 50ft x 45ft west-facing plot, 2000 sqft. Porch 8x5 on west wall. Foyer 8x6. Living room 16x13 southwest. Dining 13x11 adjacent to living. Kitchen 12x10 northwest. Pantry 5x4 adjacent to kitchen. Utility 6x5 behind kitchen. Master bedroom 15x12 southeast with ensuite 8x6 and walk-in wardrobe 5x4. Bedroom 2 13x11 northeast. Bedroom 3 12x10 east-center. Bedroom 4 11x10 south-center. Common bathroom 7x5 on hallway. Pooja room 5x5 adjacent to foyer. 4ft hallway north-south." },
  { name: "N 3BHK-N 40x40", text: "3BHK house 40x40 north-facing 1400sqft. Porch 6x5 north wall. Foyer 6x5. Living 14x12 west side. Dining 12x10 adjacent to living. Kitchen 10x9 southeast. Utility 5x4. Master 13x11 southwest with ensuite 7x5. Bedroom 2 12x10 northwest. Bedroom 3 11x9 northeast. Common bathroom 6x5 on hallway. 4ft hallway east-west." },
  { name: "S 2BHK-S 25x30", text: "2BHK flat 25x30 south-facing 750sqft. Living room, kitchen, 2 bedrooms, 1 bathroom." },
  { name: "N 1BHK 20x25", text: "1BHK studio 20x25 north-facing 500sqft. Bedroom, bathroom, kitchen, living area." },
];

async function diagnose(prompt: string, runNumber: number) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`RUN ${runNumber}: Parsing prompt...`);
  console.log(`${"=".repeat(80)}\n`);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith("sk-test")) {
    console.error("ERROR: No real OPENAI_API_KEY in .env.local");
    process.exit(1);
  }

  // Step 1: Parse
  const parseStart = Date.now();
  const parseResult = await parseConstraints(prompt, apiKey);
  const parseMs = Date.now() - parseStart;
  const parsed = parseResult.constraints;

  console.log(`Parser took ${parseMs}ms (model: ${parseResult.parser_model})`);
  console.log(`Audit: ${parseResult.audit.passed ? "PASSED" : "FAILED"} (${parseResult.audit_attempts} attempt(s))`);
  if (parseResult.first_attempt_findings.length > 0) {
    console.log(`First attempt findings: ${parseResult.first_attempt_findings.map(f => f.message).join("; ")}`);
  }

  // Step 2: Log parsed output
  console.log(`\n--- PARSED CONSTRAINTS ---`);
  console.log(`Plot: ${parsed.plot.width_ft}x${parsed.plot.depth_ft}ft, facing=${parsed.plot.facing}, built_up=${parsed.plot.total_built_up_sqft}sqft`);
  console.log(`Rooms (${parsed.rooms.length}):`);
  for (const r of parsed.rooms) {
    const dims = r.dim_width_ft && r.dim_depth_ft ? `${r.dim_width_ft}x${r.dim_depth_ft}ft` : "no dims";
    const pos = r.position_direction ?? "no pos";
    const attached = r.attached_to_room_id ? `attached-to:${r.attached_to_room_id}` : "";
    console.log(`  [${r.id}] ${r.name} (${r.function}) ${dims} pos=${pos} ${attached}`);
  }
  console.log(`\nAdjacency pairs (${parsed.adjacency_pairs.length}):`);
  for (const a of parsed.adjacency_pairs) {
    console.log(`  ${a.room_a_id} ↔ ${a.room_b_id} (${a.relationship}${a.direction ? `, dir=${a.direction}` : ""})`);
  }
  console.log(`\nConnects-all groups: ${parsed.connects_all_groups.length}`);
  for (const g of parsed.connects_all_groups) {
    console.log(`  ${g.connector_id} → [${g.connected_room_ids.join(", ")}]`);
  }
  console.log(`Special features: ${parsed.special_features.map(f => f.feature).join(", ") || "none"}`);

  // Step 3: Check for parser issues
  console.log(`\n--- PARSER ISSUE CHECK ---`);
  const roomIds = new Set(parsed.rooms.map(r => r.id));
  let issues = 0;

  // Check adjacency pairs reference valid room IDs
  for (const a of parsed.adjacency_pairs) {
    if (!roomIds.has(a.room_a_id)) {
      console.log(`  WARNING: adjacency pair references non-existent room_a_id: ${a.room_a_id}`);
      issues++;
    }
    if (!roomIds.has(a.room_b_id)) {
      console.log(`  WARNING: adjacency pair references non-existent room_b_id: ${a.room_b_id}`);
      issues++;
    }
  }

  // Check attached_to_room_id references
  for (const r of parsed.rooms) {
    if (r.attached_to_room_id && !roomIds.has(r.attached_to_room_id)) {
      console.log(`  WARNING: ${r.name} attached_to_room_id=${r.attached_to_room_id} doesn't exist`);
      issues++;
    }
  }

  // Check inverted attachments
  for (const r of parsed.rooms) {
    if (r.attached_to_room_id) {
      const target = parsed.rooms.find(t => t.id === r.attached_to_room_id);
      if (target) {
        const parentFns = ["master_bedroom", "bedroom", "guest_bedroom", "kids_bedroom"];
        const childFns = ["bathroom", "master_bathroom", "powder_room", "walk_in_wardrobe", "walk_in_closet"];
        if (parentFns.includes(r.function) && childFns.includes(target.function)) {
          console.log(`  WARNING: INVERTED ATTACHMENT: ${r.name} (${r.function}) → ${target.name} (${target.function})`);
          issues++;
        }
      }
    }
  }

  // Check for missing porch
  const hasPorch = parsed.rooms.some(r => r.function === "porch" || r.function === "verandah");
  const hasPorchFeature = parsed.special_features.some(f => f.feature === "porch" || f.feature === "verandah");
  if (!hasPorch && hasPorchFeature) {
    console.log(`  WARNING: porch in special_features but no porch room`);
    issues++;
  }
  if (!hasPorch && prompt.toLowerCase().includes("porch")) {
    console.log(`  WARNING: prompt mentions "porch" but no porch room parsed`);
    issues++;
  }

  // Total area check
  const totalRequestedArea = parsed.rooms.reduce((s, r) => {
    const w = r.dim_width_ft ?? 10;
    const d = r.dim_depth_ft ?? 8;
    return s + w * d;
  }, 0);
  const plotArea = (parsed.plot.width_ft ?? 40) * (parsed.plot.depth_ft ?? 40);
  console.log(`  Total requested room area: ${Math.round(totalRequestedArea)}sqft vs plot area: ${plotArea}sqft (${Math.round(totalRequestedArea / plotArea * 100)}%)`);
  if (totalRequestedArea > plotArea * 0.95) {
    console.log(`  WARNING: rooms exceed 95% of plot area`);
    issues++;
  }

  console.log(`  Total issues found: ${issues}`);

  // Step 4: Run LLM Layout Engine
  console.log(`\n--- RUNNING LLM LAYOUT ENGINE ---`);
  const engineStart = Date.now();
  const rawResult = await runLLMLayoutEngine(prompt, parsed, apiKey);
  const result = fillDoorMetrics(rawResult);
  const engineMs = Date.now() - engineStart;

  console.log(`Engine took ${engineMs}ms`);
  console.log(`\nRooms placed: ${result.rooms.filter(r => r.placed).length}/${result.rooms.length}`);
  console.log(`Room details:`);
  for (const r of result.rooms) {
    if (r.placed) {
      console.log(`  [${r.strip}] ${r.name}: (${r.placed.x.toFixed(1)}, ${r.placed.y.toFixed(1)}) ${r.placed.width.toFixed(1)}x${r.placed.depth.toFixed(1)}ft = ${r.actual_area_sqft?.toFixed(0)}sqft`);
    } else {
      console.log(`  [${r.strip}] ${r.name}: NOT PLACED`);
    }
  }

  console.log(`\nSpine: (${result.spine.spine.x}, ${result.spine.spine.y}) ${result.spine.spine.width}x${result.spine.spine.depth}ft`);
  console.log(`Walls: ${result.walls.length} (${result.walls.filter(w => w.type === "external").length} external, ${result.walls.filter(w => w.type === "internal").length} internal)`);
  console.log(`Doors: ${result.doors.length}`);
  for (const d of result.doors) {
    console.log(`  ${d.between[0]} ↔ ${d.between[1]} (${d.orientation}, w=${d.width_ft}ft${d.is_main_entrance ? " MAIN" : ""})`);
  }
  console.log(`Windows: ${result.windows.length}`);

  // Step 5: Check shared walls (floating room detection)
  console.log(`\n--- FLOATING ROOM CHECK ---`);
  const placedRooms = result.rooms.filter(r => r.placed);
  const spineRect = result.spine.spine;
  let floatingCount = 0;
  for (const room of placedRooms) {
    if (!room.placed) continue;
    let sharesWall = false;
    // Check against spine
    if (sharesEdge(room.placed, spineRect)) {
      sharesWall = true;
    }
    // Check against other rooms
    for (const other of placedRooms) {
      if (other.id === room.id || !other.placed) continue;
      if (sharesEdge(room.placed, other.placed)) {
        sharesWall = true;
        break;
      }
    }
    if (!sharesWall) {
      console.log(`  FLOATING: ${room.name} at (${room.placed.x.toFixed(1)}, ${room.placed.y.toFixed(1)})`);
      floatingCount++;
    }
  }
  console.log(`  Floating rooms: ${floatingCount}/${placedRooms.length}`);

  // Step 6: Metrics
  console.log(`\n--- ENGINE METRICS ---`);
  console.log(`Efficiency: ${result.metrics.efficiency_pct}%`);
  console.log(`Door coverage: ${result.metrics.door_coverage_pct}% (${result.metrics.rooms_with_doors}/${result.metrics.total_rooms} rooms)`);
  console.log(`Orphan rooms: ${result.metrics.orphan_rooms.length} [${result.metrics.orphan_rooms.join(", ")}]`);
  console.log(`Void area: ${result.metrics.void_area_sqft}sqft`);

  // Step 7: Convert and compute honest score
  const project = toFloorPlanProject(result, parsed);
  const layoutMetrics = computeLayoutMetrics(project, parsed);
  const honestScore = computeHonestScore(layoutMetrics);

  console.log(`\n--- HONEST SCORE ---`);
  console.log(`Score: ${honestScore.score}/100 (Grade: ${honestScore.grade})`);
  for (const r of honestScore.rationale) {
    console.log(`  ${r}`);
  }
  console.log(`\nLayout metrics:`);
  console.log(`  Efficiency: ${layoutMetrics.efficiency_pct}%`);
  console.log(`  Door coverage: ${layoutMetrics.door_coverage_pct}%`);
  console.log(`  Orphan rooms: ${layoutMetrics.orphan_rooms.length} [${layoutMetrics.orphan_rooms.join(", ")}]`);
  console.log(`  Void area: ${layoutMetrics.void_area_sqft}sqft`);
  console.log(`  Dim deviation: ${layoutMetrics.mean_dim_deviation_pct}%`);
  console.log(`  Area deviation: ${layoutMetrics.area_deviation_pct}%`);

  // Step 8: Warnings
  if (result.warnings.length > 0) {
    console.log(`\n--- WARNINGS (${result.warnings.length}) ---`);
    for (const w of result.warnings) {
      console.log(`  ${w}`);
    }
  }

  return { honestScore, layoutMetrics, result, parsed };
}

function sharesEdge(a: { x: number; y: number; width: number; depth: number }, b: { x: number; y: number; width: number; depth: number }): boolean {
  const eps = 0.1;
  // Horizontal shared edge (A top = B bottom or A bottom = B top)
  if (Math.abs(a.y + a.depth - b.y) < eps || Math.abs(b.y + b.depth - a.y) < eps) {
    const overlapStart = Math.max(a.x, b.x);
    const overlapEnd = Math.min(a.x + a.width, b.x + b.width);
    if (overlapEnd - overlapStart > eps) return true;
  }
  // Vertical shared edge (A right = B left or A left = B right)
  if (Math.abs(a.x + a.width - b.x) < eps || Math.abs(b.x + b.width - a.x) < eps) {
    const overlapStart = Math.max(a.y, b.y);
    const overlapEnd = Math.min(a.y + a.depth, b.y + b.depth);
    if (overlapEnd - overlapStart > eps) return true;
  }
  return false;
}

async function main() {
  try {
    const allResults: Array<{ name: string; score: number; grade: string; eff: number; doors: number; orphans: number; placed: number; total: number; voids: number; dimDev: number }> = [];

    for (const prompt of TEST_PROMPTS) {
      console.log(`\n${"#".repeat(80)}`);
      console.log(`# ${prompt.name}`);
      console.log(`${"#".repeat(80)}`);
      const r = await diagnose(prompt.text, 1);
      allResults.push({
        name: prompt.name,
        score: r.honestScore.score,
        grade: r.honestScore.grade,
        eff: r.layoutMetrics.efficiency_pct,
        doors: r.layoutMetrics.door_coverage_pct,
        orphans: r.layoutMetrics.orphan_rooms.length,
        placed: r.result.rooms.filter((rm: any) => rm.placed).length,
        total: r.result.rooms.length,
        voids: r.layoutMetrics.void_area_sqft,
        dimDev: r.layoutMetrics.mean_dim_deviation_pct,
      });
    }

    console.log(`\n${"=".repeat(90)}`);
    console.log("FINAL SUMMARY — ALL PROMPTS");
    console.log(`${"=".repeat(90)}`);
    console.log("Prompt                          Score  Grade  Eff%   Doors%  Orphans  Placed  Voids  DimDev%");
    console.log("-".repeat(90));
    for (const r of allResults) {
      console.log(
        `${r.name.padEnd(32)}${String(r.score).padStart(3)}/100  ${r.grade.padEnd(6)} ${r.eff.toFixed(0).padStart(3)}%   ${r.doors.toFixed(0).padStart(4)}%   ${String(r.orphans).padStart(4)}     ${r.placed}/${r.total}   ${String(r.voids).padStart(4)}   ${r.dimDev.toFixed(1).padStart(5)}%`
      );
    }
    console.log("-".repeat(90));

    const allPass = allResults.every(r => r.score >= 50 && r.doors >= 90 && r.orphans <= 2 && r.eff >= 60 && r.placed === r.total);
    console.log(`\nALL PASS: ${allPass ? "YES" : "NO"}`);
    if (!allPass) {
      for (const r of allResults) {
        const fails: string[] = [];
        if (r.score < 50) fails.push(`score ${r.score}<50`);
        if (r.doors < 90) fails.push(`doors ${r.doors}<90`);
        if (r.orphans > 2) fails.push(`orphans ${r.orphans}>2`);
        if (r.eff < 60) fails.push(`eff ${r.eff}<60`);
        if (r.placed !== r.total) fails.push(`placed ${r.placed}/${r.total}`);
        if (fails.length > 0) console.log(`  FAIL: ${r.name}: ${fails.join(", ")}`);
      }
    }
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
