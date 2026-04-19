/**
 * Barcode-prevention test — validates no room gets aspect ratio > 3.5:1
 * Run: npx tsx scripts/test-barcode.ts
 */
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(__dirname, "..", ".env.local");
const envContent = fs.readFileSync(envPath, "utf8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  if (!process.env[key]) process.env[key] = val;
}

const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req: string, parent: unknown) {
  if (req.startsWith("@/")) return origResolve.call(this, path.join(__dirname, "..", "src", req.slice(2)), parent);
  return origResolve.call(this, req, parent);
};

import { parseConstraints } from "../src/features/floor-plan/lib/structured-parser";
import { fillDoorMetrics } from "../src/features/floor-plan/lib/strip-pack/strip-pack-engine";
import { runLLMLayoutEngine } from "../src/features/floor-plan/lib/llm-layout-engine";
import { toFloorPlanProject } from "../src/features/floor-plan/lib/strip-pack/converter";
import { computeLayoutMetrics, computeHonestScore } from "../src/features/floor-plan/lib/layout-metrics";

const PROMPTS = [
  { tag: "South 4BHK 42x52", text: "A single-storey 4BHK residential house on a 42ft x 52ft south-facing plot with total built-up area of 1800 sq ft. Drawing room 16x14 SE. Family living 14x12. Dining 12x11. Kitchen 11x10 SW. Utility 6x5. Master 15x13 NE with ensuite 9x7 and wardrobe 6x4. Bedroom 2 13x11 NW with bathroom 7x5. Bedroom 3 12x10. Bedroom 4 11x10. Common bathroom 7x5. Pooja 6x5 NE. Store 5x4. 4ft hallway east-west." },
  { tag: "East 3BHK 38x48", text: "3BHK east-facing 38x48 1600sqft vastu. Living 15x13 NE. Kitchen 11x10 SE. Master 14x12 SW with ensuite 8x6. Bedroom 2 12x11 NW. Bedroom 3 11x10. Common bathroom 7x5. Pooja 5x5 NE. 4ft hallway." },
  { tag: "North 3BHK 40x40", text: "3BHK north-facing 40x40 1400sqft. Living 14x12, Kitchen 10x9, Master 13x11 southwest with ensuite 7x5, 2 bedrooms, common bathroom, utility, 4ft hallway." },
  { tag: "West 4BHK 50x45", text: "4BHK west-facing 50x45 2000sqft. Living 16x13 southwest. Kitchen 12x10 northwest. Master 15x12 southeast with ensuite. 3 more bedrooms, common bathroom, pooja, utility. 4ft hallway." },
  { tag: "Vague 3BHK", text: "3BHK house 1100 sqft north facing vastu" },
];

async function main() {
  const apiKey = process.env.OPENAI_API_KEY!;
  console.log("BARCODE PREVENTION TEST — 5 prompts x 1 option (variant 0)\n");

  for (const p of PROMPTS) {
    console.log(`-- ${p.tag} --`);
    const parseRes = await parseConstraints(p.text, apiKey);

    const raw = await runLLMLayoutEngine(p.text, parseRes.constraints, apiKey, { temperature: 0.3, variant: 0 });
    const filled = fillDoorMetrics(raw);
    const proj = toFloorPlanProject(filled, parseRes.constraints);
    const met = computeLayoutMetrics(proj, parseRes.constraints);
    const sc = computeHonestScore(met);

    // Check aspect ratios
    let maxAspect = 0;
    let worstRoom = "";
    for (const r of filled.rooms) {
      if (!r.placed) continue;
      const aspect = Math.max(r.placed.width, r.placed.depth) / Math.min(r.placed.width, r.placed.depth);
      if (aspect > maxAspect) { maxAspect = aspect; worstRoom = r.name; }
    }

    // Check inflation
    let inflated = 0;
    for (const r of filled.rooms) {
      if (!r.placed) continue;
      const pr = parseRes.constraints.rooms.find(p => p.name.toLowerCase() === r.name.toLowerCase());
      if (pr?.dim_width_ft && pr?.dim_depth_ft) {
        const req = pr.dim_width_ft * pr.dim_depth_ft;
        const got = r.placed.width * r.placed.depth;
        if (got > req * 1.5) inflated++;
      }
    }

    const pass = maxAspect <= 3.5 && sc.score >= 50;
    console.log(
      `  ${pass ? "PASS" : "FAIL"} score=${sc.score}/${sc.grade} doors=${met.door_coverage_pct}% orphans=${met.orphan_rooms.length} ` +
      `maxAspect=${maxAspect.toFixed(1)}:1 (${worstRoom}) inflated=${inflated} rooms=${proj.floors[0]?.rooms.length ?? 0}`
    );

    // List rooms with bad aspect ratios
    for (const r of filled.rooms) {
      if (!r.placed) continue;
      const aspect = Math.max(r.placed.width, r.placed.depth) / Math.min(r.placed.width, r.placed.depth);
      if (aspect > 2.5) {
        console.log(`    ${aspect > 3.5 ? "!!" : " >"} ${r.name}: ${r.placed.width.toFixed(1)}x${r.placed.depth.toFixed(1)}ft = ${Math.round(r.placed.width * r.placed.depth)}sqft (${aspect.toFixed(1)}:1)`);
      }
    }
    console.log();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
