/**
 * Multi-option floor plan regression test.
 *
 * Generates 3 options per prompt (with temperature diversity), scores each,
 * and reports the best/worst/range. Validates that the "Midjourney approach"
 * reliably produces at least one good layout for ANY prompt.
 *
 * Run: npx tsx scripts/test-multi-option.ts
 * Requires: OPENAI_API_KEY in .env.local
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
import { parseConstraints } from "../src/features/floor-plan/lib/structured-parser";
import { fillDoorMetrics } from "../src/features/floor-plan/lib/strip-pack/strip-pack-engine";
import { runLLMLayoutEngine } from "../src/features/floor-plan/lib/llm-layout-engine";
import { toFloorPlanProject } from "../src/features/floor-plan/lib/strip-pack/converter";
import { computeLayoutMetrics, computeHonestScore } from "../src/features/floor-plan/lib/layout-metrics";

const TEST_PROMPTS = [
  {
    tag: "P1 3BHK-E 38x48",
    text: "3BHK east-facing 38x48 1600sqft with vastu, pooja room, master bedroom southwest with ensuite, kitchen southeast, living room northeast, 3 bedrooms, common bathroom, store room, utility, 4ft hallway",
  },
  {
    tag: "P2 4BHK-W 50x45",
    text: "4BHK west-facing 50x45 2000sqft, porch 8x5, living 16x13 southwest, kitchen 12x10 northwest, master 15x12 southeast with ensuite and wardrobe, 3 more bedrooms, common bathroom, pooja room, pantry, utility, 4ft hallway north-south",
  },
  {
    tag: "P3 3BHK-N 40x40",
    text: "3BHK north-facing 40x40 1400sqft, porch 6x5, living 14x12, dining 12x10, kitchen 10x9, master 13x11 southwest with ensuite 7x5, 2 bedrooms, common bathroom, utility, 4ft hallway east-west",
  },
  {
    tag: "P4 2BHK-S 25x30",
    text: "2BHK south-facing 25x30 750sqft, living room, kitchen, 2 bedrooms, 1 bathroom",
  },
  {
    tag: "P5 1BHK-N 20x25",
    text: "1BHK 20x25 500sqft north-facing, bedroom, bathroom, kitchen, living area",
  },
  {
    tag: "P6 3BHK generic",
    text: "3BHK 1200sqft north-facing 35x40",
  },
  {
    tag: "P7 4BHK-E vastu",
    text: "4BHK 45x55 east vastu compliant with pooja room and servant quarter",
  },
  {
    tag: "P8 Hinglish 3BHK",
    text: "3BHK flat 1000sqft pooja room chahiye vastu north facing",
  },
];

const TEMPERATURES = [0.2, 0.4, 0.6];

interface OptionResult {
  score: number;
  grade: string;
  doorsPct: number;
  orphans: number;
  efficiency: number;
  rooms: number;
  compactness: number;
  temp: number;
  error?: string;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not found in .env.local");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════");
  console.log("MULTI-OPTION FLOOR PLAN REGRESSION TEST");
  console.log(`Running ${TEST_PROMPTS.length} prompts × ${TEMPERATURES.length} options`);
  console.log("═══════════════════════════════════════════════════\n");

  const results: Array<{ tag: string; options: OptionResult[] }> = [];
  let totalLShapes = 0;
  let totalRetries = 0;
  let totalOptions = 0;

  for (const prompt of TEST_PROMPTS) {
    console.log(`\n── ${prompt.tag} ──`);
    console.log(`  Prompt: "${prompt.text.slice(0, 60)}..."`);

    // Parse once, reuse for all options
    const parseStart = Date.now();
    const parseRes = await parseConstraints(prompt.text, apiKey);
    const parseMs = Date.now() - parseStart;
    console.log(`  Parse: ${parseMs}ms, ${parseRes.constraints.rooms.length} rooms`);

    // Generate 3 options in parallel
    const optionPromises = TEMPERATURES.map((temp, i) => {
      const start = Date.now();
      return runLLMLayoutEngine(prompt.text, parseRes.constraints, apiKey, { temperature: temp })
        .then(result => {
          const filled = fillDoorMetrics(result);
          const project = toFloorPlanProject(filled, parseRes.constraints);
          const metrics = computeLayoutMetrics(project, parseRes.constraints);
          const score = computeHonestScore(metrics);

          // Compute compactness from rooms
          const nonCorridorRooms = result.rooms.filter(r => r.type !== "corridor");
          let compactness = 1;
          if (nonCorridorRooms.length > 0) {
            const placed = nonCorridorRooms.filter(r => r.placed);
            if (placed.length > 0) {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              let area = 0;
              for (const r of placed) {
                const p = r.placed!;
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x + p.width);
                maxY = Math.max(maxY, p.y + p.depth);
                area += p.width * p.depth;
              }
              const bbox = (maxX - minX) * (maxY - minY);
              compactness = bbox > 0 ? area / bbox : 1;
            }
          }

          // Check if retry was triggered (scan warnings)
          const hadRetry = result.warnings.some(w => w.includes("retrying") || w.includes("Retry"));
          if (hadRetry) totalRetries++;

          if (compactness < 0.75) totalLShapes++;
          totalOptions++;

          const opt: OptionResult = {
            score: score.score,
            grade: score.grade,
            doorsPct: metrics.door_coverage_pct,
            orphans: metrics.orphan_rooms.length,
            efficiency: metrics.efficiency_pct,
            rooms: project.floors[0]?.rooms.length ?? 0,
            compactness: Math.round(compactness * 100),
            temp,
          };

          console.log(
            `  Option-${i} (t=${temp}): score=${opt.score} (${opt.grade}) ` +
            `doors=${opt.doorsPct}% orphans=${opt.orphans} eff=${opt.efficiency}% ` +
            `compact=${opt.compactness}% ${Date.now() - start}ms${hadRetry ? " [RETRY]" : ""}`,
          );

          return opt;
        })
        .catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  Option-${i} (t=${temp}): FAILED — ${msg.slice(0, 80)}`);
          totalOptions++;
          return { score: 0, grade: "F", doorsPct: 0, orphans: 99, efficiency: 0, rooms: 0, compactness: 0, temp, error: msg } as OptionResult;
        });
    });

    const options = await Promise.all(optionPromises);
    results.push({ tag: prompt.tag, options });
  }

  // ── Report ──────────────────────────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════════");
  console.log("MULTI-OPTION TEST RESULTS");
  console.log("═══════════════════════════════════════════════════\n");

  console.log("  Prompt                    Best   Worst  Range  Doors%  Orphans  Compact%");
  console.log("  ───────────────────────────────────────────────────────────────────────");

  let totalBestScore = 0;
  let allPass = true;

  for (const r of results) {
    const valid = r.options.filter(o => !o.error);
    if (valid.length === 0) {
      console.log(`  ${r.tag.padEnd(24)} ALL FAILED`);
      allPass = false;
      continue;
    }

    valid.sort((a, b) => b.score - a.score);
    const best = valid[0];
    const worst = valid[valid.length - 1];
    const range = best.score - worst.score;

    const pass = best.score >= 50 && best.doorsPct >= 80 && best.orphans <= 2;
    const icon = pass ? "✅" : "❌";
    if (!pass) allPass = false;
    totalBestScore += best.score;

    console.log(
      `${icon} ${r.tag.padEnd(24)} ${String(best.score).padStart(4)}   ${String(worst.score).padStart(4)}   Δ${String(range).padStart(3)}   ${String(best.doorsPct).padStart(4)}%   ${String(best.orphans).padStart(5)}    ${String(best.compactness).padStart(5)}%`,
    );
  }

  const avgBest = Math.round(totalBestScore / results.length);

  console.log("\n───────────────────────────────────────────────────");
  console.log(`AVERAGE BEST SCORE: ${avgBest}/100`);
  console.log(`L-SHAPES DETECTED: ${totalLShapes} out of ${totalOptions} options`);
  console.log(`RETRIES TRIGGERED: ${totalRetries} out of ${totalOptions} options`);
  console.log(`\nVERDICT: ${allPass && avgBest >= 75 ? "PHASE 1 COMPLETE ✅" : "ISSUES FOUND ❌"}`);
  if (!allPass) {
    console.log("  Some prompts did not meet minimum criteria (best score >= 50, doors >= 80%, orphans <= 2)");
  }
  if (avgBest < 75) {
    console.log(`  Average best score ${avgBest} < 75 target`);
  }
  console.log("═══════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
