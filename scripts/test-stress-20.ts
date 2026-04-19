/**
 * 20-prompt stress test for multi-option floor plan generation.
 *
 * Tests every edge case real Indian users would type: standard, detailed,
 * vague, Hinglish, impossibly small, large, exclusions, combined rooms.
 *
 * Run: npx tsx scripts/test-stress-20.ts
 * Requires: OPENAI_API_KEY in .env.local
 */
import * as fs from "fs";
import * as path from "path";

// Load .env.local
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

// Patch @/ imports
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, parent: unknown) {
  if (request.startsWith("@/")) {
    return originalResolve.call(this, path.join(__dirname, "..", "src", request.slice(2)), parent);
  }
  return originalResolve.call(this, request, parent);
};

import { parseConstraints } from "../src/features/floor-plan/lib/structured-parser";
import { fillDoorMetrics } from "../src/features/floor-plan/lib/strip-pack/strip-pack-engine";
import { runLLMLayoutEngine } from "../src/features/floor-plan/lib/llm-layout-engine";
import { toFloorPlanProject } from "../src/features/floor-plan/lib/strip-pack/converter";
import { computeLayoutMetrics, computeHonestScore } from "../src/features/floor-plan/lib/layout-metrics";

const PROMPTS = [
  // Standard residential
  { tag: "P01 3BHK-N 35x40",       text: "3BHK 1200sqft north-facing 35x40 plot" },
  { tag: "P02 2BHK-E 800sqft",     text: "2BHK apartment 800sqft east-facing" },
  { tag: "P03 4BHK-W 50x45",       text: "4BHK villa 2000sqft west-facing 50x45" },
  { tag: "P04 1BHK studio",        text: "1BHK studio 500sqft 20x25 north" },
  { tag: "P05 5BHK bungalow",      text: "5BHK bungalow 2800sqft 60x55 north-facing with servant quarter" },
  // Detailed with dimensions
  { tag: "P06 3BHK detailed",      text: "3BHK 40x40 north-facing. Living 14x12, Kitchen 10x9, Master 13x11 with ensuite 7x5, Bedroom 2 12x10, Bedroom 3 11x9, Common bathroom 6x5, 4ft hallway" },
  { tag: "P07 4BHK detailed-E",    text: "4BHK 45x55 east-facing vastu. Living 18x14 NE, Kitchen 12x11 SE, Master 16x13 SW with ensuite and wardrobe, 3 more bedrooms, pooja room, utility, 4ft hallway NS" },
  // Vague prompts
  { tag: "P08 vague budget",       text: "nice 3bhk house under 20 lakh budget" },
  { tag: "P09 vague modern",       text: "modern villa with garden" },
  { tag: "P10 vague city",         text: "2 bedroom flat in pune" },
  // Hinglish
  { tag: "P11 Hinglish 3BHK",      text: "3BHK flat 1000sqft pooja room chahiye vastu north facing" },
  { tag: "P12 Hinglish 1RK",       text: "ek kamra aur rasoi 400sqft" },
  { tag: "P13 Hinglish 4BHK",      text: "4BHK villa bada sa master bedroom southwest corner mein" },
  // Edge cases
  { tag: "P14 tiny studio",        text: "studio apartment 300sqft single room with kitchenette and bathroom" },
  { tag: "P15 IMPOSSIBLE",         text: "4BHK on 20x20 plot 400sqft" },
  { tag: "P16 many rooms",         text: "3BHK with 3 attached bathrooms and 2 balconies and pooja and study and servant quarter" },
  { tag: "P17 ultra vague",        text: "house 1500sqft" },
  { tag: "P18 exclusions",         text: "south-facing 3BHK 35x45 no parking no balcony no pooja room" },
  // Non-standard
  { tag: "P19 open kitchen",       text: "3BHK with open kitchen and living combined 25x12ft north-facing 40x45" },
  { tag: "P20 south 2BHK",         text: "2BHK south-facing 30x35 900sqft with utility room" },
];

const TEMPERATURES = [0.2, 0.4, 0.6];

interface Result {
  tag: string;
  best: number;
  worst: number;
  range: number;
  doors: number;
  orphans: number;
  compact: number;
  rooms: number;
  lShape: boolean;
  retries: number;
  infeasible: boolean;
  error?: string;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error("OPENAI_API_KEY not found"); process.exit(1); }

  console.log("=".repeat(60));
  console.log("20-PROMPT STRESS TEST — MULTI-OPTION FLOOR PLAN");
  console.log(`${PROMPTS.length} prompts x ${TEMPERATURES.length} options = ${PROMPTS.length * TEMPERATURES.length} GPT-4o calls`);
  console.log("=".repeat(60) + "\n");

  const results: Result[] = [];
  let totalCalls = 0;
  const startAll = Date.now();

  for (const p of PROMPTS) {
    console.log(`\n-- ${p.tag} --`);
    console.log(`  "${p.text.slice(0, 65)}${p.text.length > 65 ? "..." : ""}"`);

    try {
      const t0 = Date.now();
      const parseRes = await parseConstraints(p.text, apiKey);
      console.log(`  Parse: ${Date.now() - t0}ms, ${parseRes.constraints.rooms.length} rooms`);

      // Quick feasibility check
      const plotW = parseRes.constraints.plot.width_ft ?? 40;
      const plotD = parseRes.constraints.plot.depth_ft ?? 50;
      const plotArea = plotW * plotD;
      const nonCirc = parseRes.constraints.rooms.filter(r => !r.is_circulation);
      const roomArea = nonCirc.reduce((s, r) => s + (r.dim_width_ft ?? 10) * (r.dim_depth_ft ?? 8), 0);

      if (roomArea > plotArea * 1.3 || plotArea < nonCirc.length * 25) {
        console.log(`  INFEASIBLE: rooms=${Math.round(roomArea)}sqft plot=${Math.round(plotArea)}sqft`);
        results.push({ tag: p.tag, best: 0, worst: 0, range: 0, doors: 0, orphans: 0, compact: 0, rooms: 0, lShape: false, retries: 0, infeasible: true });
        continue;
      }

      // Generate 3 options in parallel
      const optResults = await Promise.all(
        TEMPERATURES.map(async (temp, i) => {
          totalCalls++;
          try {
            const start = Date.now();
            const raw = await runLLMLayoutEngine(p.text, parseRes.constraints, apiKey, { temperature: temp });
            const filled = fillDoorMetrics(raw);
            const project = toFloorPlanProject(filled, parseRes.constraints);
            const metrics = computeLayoutMetrics(project, parseRes.constraints);
            const score = computeHonestScore(metrics);
            const hadRetry = raw.warnings.some(w => w.includes("retrying") || w.includes("Retry"));

            // Compactness from placed rooms
            const placed = filled.rooms.filter(r => r.placed);
            let compact = 1;
            if (placed.length > 0) {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, area = 0;
              for (const r of placed) {
                const pl = r.placed!;
                minX = Math.min(minX, pl.x); minY = Math.min(minY, pl.y);
                maxX = Math.max(maxX, pl.x + pl.width); maxY = Math.max(maxY, pl.y + pl.depth);
                area += pl.width * pl.depth;
              }
              const bbox = (maxX - minX) * (maxY - minY);
              compact = bbox > 0 ? area / bbox : 1;
            }

            console.log(
              `  Opt-${i} (t=${temp}): ${score.score}/${score.grade} doors=${metrics.door_coverage_pct}% ` +
              `orphans=${metrics.orphan_rooms.length} compact=${Math.round(compact * 100)}% ${Date.now() - start}ms` +
              `${hadRetry ? " [R]" : ""}`
            );

            return { score: score.score, grade: score.grade, doors: metrics.door_coverage_pct, orphans: metrics.orphan_rooms.length, compact: Math.round(compact * 100), rooms: project.floors[0]?.rooms.length ?? 0, lShape: compact < 0.75, retry: hadRetry ? 1 : 0 };
          } catch (err) {
            totalCalls++;
            console.log(`  Opt-${i} (t=${temp}): FAILED — ${(err as Error).message?.slice(0, 60)}`);
            return null;
          }
        })
      );

      const valid = optResults.filter((r): r is NonNullable<typeof r> => r !== null);
      if (valid.length === 0) {
        results.push({ tag: p.tag, best: 0, worst: 0, range: 0, doors: 0, orphans: 99, compact: 0, rooms: 0, lShape: false, retries: 0, infeasible: false, error: "all failed" });
        continue;
      }

      valid.sort((a, b) => b.score - a.score);
      const best = valid[0];
      const worst = valid[valid.length - 1];

      results.push({
        tag: p.tag, best: best.score, worst: worst.score,
        range: best.score - worst.score, doors: best.doors,
        orphans: best.orphans, compact: best.compact,
        rooms: best.rooms, lShape: best.lShape,
        retries: valid.reduce((s, v) => s + v.retry, 0),
        infeasible: false,
      });
    } catch (err) {
      console.log(`  ERROR: ${(err as Error).message?.slice(0, 80)}`);
      results.push({ tag: p.tag, best: 0, worst: 0, range: 0, doors: 0, orphans: 99, compact: 0, rooms: 0, lShape: false, retries: 0, infeasible: false, error: (err as Error).message });
    }
  }

  const totalMs = Date.now() - startAll;

  // ── Report ──
  console.log("\n\n" + "=".repeat(60));
  console.log("STRESS TEST RESULTS");
  console.log("=".repeat(60) + "\n");
  console.log("  Prompt                    Best  Worst Range Doors% Orphans Compact Rooms");
  console.log("  " + "-".repeat(76));

  let sumBest = 0;
  let pass50 = 0;
  let pass60 = 0;
  let lShapeCount = 0;
  let infeasibleCaught = 0;

  for (const r of results) {
    if (r.infeasible) {
      console.log(`  ${r.tag.padEnd(24)} INFEASIBLE (caught correctly)`);
      infeasibleCaught++;
      continue;
    }
    if (r.error) {
      console.log(`  ${r.tag.padEnd(24)} ERROR: ${r.error.slice(0, 40)}`);
      continue;
    }

    const pass = r.best >= 50 && r.doors >= 80 && r.orphans <= 2;
    const icon = pass ? "+" : "x";
    sumBest += r.best;
    if (r.best >= 50) pass50++;
    if (r.best >= 60) pass60++;
    if (r.lShape) lShapeCount++;

    console.log(
      `${icon} ${r.tag.padEnd(24)} ${String(r.best).padStart(4)}  ${String(r.worst).padStart(4)}  D${String(r.range).padStart(3)}  ${String(r.doors).padStart(5)}%  ${String(r.orphans).padStart(5)}  ${String(r.compact).padStart(6)}%  ${String(r.rooms).padStart(4)}`
    );
  }

  const scoredCount = results.filter(r => !r.infeasible && !r.error).length;
  const avgBest = scoredCount > 0 ? Math.round(sumBest / scoredCount) : 0;

  console.log("\n" + "-".repeat(60));
  console.log(`Prompts with best >= 50:  ${pass50}/${scoredCount} (${Math.round(pass50 / scoredCount * 100)}%)`);
  console.log(`Prompts with best >= 60:  ${pass60}/${scoredCount} (${Math.round(pass60 / scoredCount * 100)}%)`);
  console.log(`Average best score:       ${avgBest}/100`);
  console.log(`L-shaped best options:    ${lShapeCount}/${scoredCount}`);
  console.log(`Infeasibility caught:     ${infeasibleCaught}/1`);
  console.log(`Total GPT-4o calls:       ${totalCalls}`);
  console.log(`Total time:               ${Math.round(totalMs / 1000)}s (avg ${Math.round(totalMs / PROMPTS.length / 1000)}s/prompt)`);

  const passAll = pass50 >= Math.ceil(scoredCount * 0.85) && pass60 >= Math.ceil(scoredCount * 0.75) && avgBest >= 70 && lShapeCount === 0;
  console.log(`\nVERDICT: ${passAll ? "READY FOR PRODUCTION" : "ISSUES FOUND"}`);
  console.log("=".repeat(60));
}

main().catch(err => { console.error(err); process.exit(1); });
