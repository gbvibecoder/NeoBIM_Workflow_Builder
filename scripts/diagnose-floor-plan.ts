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
  { name: "E 4BHK-E (L-shape test)", text: `A single-storey 4BHK residential villa on a 45ft x 55ft east-facing plot with total built-up area of 2200 sq ft. Vastu compliant. The main entrance is a 10ft x 6ft porch on the east wall leading into a 10ft x 8ft foyer. The living room is 18ft x 14ft in the northeast corner. The dining room is 14ft x 12ft adjacent to the living room. The kitchen is 12ft x 11ft in the southeast corner adjacent to the dining room. A 6ft x 5ft pooja room sits adjacent to the foyer. A 7ft x 5ft utility room is behind the kitchen. The master bedroom is 16ft x 13ft in the southwest corner with an attached 9ft x 7ft ensuite bathroom and a 6ft x 4ft walk-in wardrobe. Bedroom 2 is 14ft x 12ft in the northwest corner. Bedroom 3 is 13ft x 11ft west-center. Bedroom 4 is 12ft x 10ft north-center. A common bathroom 8ft x 6ft sits on the central hallway. A 4ft wide hallway runs north-south connecting all rooms. All external walls 9 inches, internal walls 5 inches, all doors 3ft wide.` },
  { name: "W 4BHK-W", text: `A single-storey 4BHK residential house on a 50ft x 45ft west-facing plot with total built-up area of 2000 sq ft. The main entrance is a 8ft x 5ft porch on the west wall leading into a 8ft x 6ft foyer. The living room is 16ft x 13ft in the southwest corner with a large west-facing window, flowing north into a 13ft x 11ft dining room. The kitchen is 12ft x 10ft adjacent to the dining room in the northwest area with a window on the north wall. A 5ft x 4ft pantry sits adjacent to the kitchen. A 6ft x 5ft utility room is behind the kitchen. The master bedroom is 15ft x 12ft in the southeast corner with an attached 8ft x 6ft ensuite bathroom and a 5ft x 4ft walk-in wardrobe. Bedroom 2 is 13ft x 11ft in the northeast corner. Bedroom 3 is 12ft x 10ft east-center. Bedroom 4 is 11ft x 10ft south-center, doubles as a study. A common bathroom 7ft x 5ft sits on the central hallway accessible to all bedrooms. A 5ft x 5ft pooja room adjacent to the foyer. A 4ft wide hallway runs north-south connecting all rooms. All external walls 9 inches, internal walls 5 inches, all doors 3ft wide.` },
  { name: "N 3BHK-N", text: `A single-storey 3BHK residential house on a 40ft x 40ft north-facing plot with total built-up area of 1400 sq ft. The main entrance is a 6ft x 5ft porch centered on the north wall leading directly into a 6ft x 5ft foyer which opens into the hallway. The hallway is 4ft wide running east-west connecting all rooms. The living room is 14ft x 12ft on the west side of the hallway with a north-facing window. The dining room is 12ft x 10ft adjacent to the living room on its south side. The kitchen is 10ft x 9ft adjacent to the dining room in the southeast area with a window on the east wall. A 5ft x 4ft utility room is adjacent to the kitchen. The master bedroom is 13ft x 11ft in the southwest corner with an attached 7ft x 5ft ensuite bathroom on its south side. Bedroom 2 is 12ft x 10ft in the northwest area. Bedroom 3 is 11ft x 9ft in the northeast area. A common bathroom 6ft x 5ft is on the hallway between bedrooms 2 and 3. All external walls 9 inches, internal walls 5 inches, all doors 3ft wide.` },
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
