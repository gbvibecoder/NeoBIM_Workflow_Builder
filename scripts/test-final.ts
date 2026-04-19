/**
 * Final 8-prompt regression test — validates scoring, room sizing, gaps, diversity.
 * Run: npx tsx scripts/test-final.ts
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
  { tag: "P1 4BHK-S detailed", text: "4BHK south-facing 42x52 1800sqft. Drawing room 16x14 SE. Family living 14x12 adjacent. Dining 12x11. Kitchen 11x10 SW. Utility 6x5. Master 15x13 NE with ensuite 9x7 and wardrobe 6x4. Bedroom 2 13x11 NW with bathroom 7x5. Bedroom 3 12x10. Bedroom 4 11x10 study. Common bathroom 7x5. Pooja 6x5 NE. Store 5x4. 4ft hallway east-west." },
  { tag: "P2 3BHK-E vastu", text: "3BHK east-facing 38x48 1600sqft vastu. Living 15x13 NE. Dining 12x11. Kitchen 11x10 SE. Pooja 5x5 NE. Utility 5x4. Master 14x12 SW with ensuite 8x6. Bedroom 2 12x11 NW. Bedroom 3 11x10 west. Common bathroom 7x5. Store 5x4. 4ft hallway." },
  { tag: "P3 3BHK vague", text: "3BHK house 1100 sqft with parking and sitout area, vastu preferred" },
  { tag: "P4 2BHK simple", text: "2BHK flat 800 sqft north facing simple design" },
  { tag: "P5 non-standard", text: "3BHK 36x44 north 1400sqft. Living cum dining 18x14. Modular kitchen 11x9. Master suite 16x13 SW with toilet 8x6 and dressing 6x5. Kids bedroom 12x10. Guest bedroom 11x10 NE. Common toilet 6x5. Wash area 5x4. Mandir 4x4 NE. Balcony 10x4 north." },
  { tag: "P6 1BHK studio", text: "1BHK studio 20x25 500sqft north. Bedroom, bathroom, kitchen, living." },
  { tag: "P7 5BHK large", text: "5BHK bungalow 55x50 2600sqft north vastu. 5 bedrooms, master with ensuite and wardrobe, pooja, servant quarter, utility, store, 4ft hallway." },
  { tag: "P8 Hinglish", text: "3BHK flat 1000sqft pooja room chahiye vastu north facing" },
];

const TEMPS = [0.2, 0.4, 0.6];

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error("No OPENAI_API_KEY"); process.exit(1); }

  console.log("=" .repeat(70));
  console.log("FINAL 8-PROMPT REGRESSION TEST");
  console.log("=" .repeat(70) + "\n");

  const rows: string[] = [];
  let allPass = true;

  for (const p of PROMPTS) {
    console.log(`\n-- ${p.tag} --`);
    const parseRes = await parseConstraints(p.text, apiKey);
    console.log(`  Parse: ${parseRes.constraints.rooms.length} rooms`);

    const opts = await Promise.all(TEMPS.map(async (temp, i) => {
      try {
        const raw = await runLLMLayoutEngine(p.text, parseRes.constraints, apiKey, { temperature: temp, variant: i });
        const filled = fillDoorMetrics(raw);
        const proj = toFloorPlanProject(filled, parseRes.constraints);
        const met = computeLayoutMetrics(proj, parseRes.constraints);
        const sc = computeHonestScore(met);

        // Check room inflation
        let inflated = 0;
        for (const room of filled.rooms) {
          if (!room.placed) continue;
          const pr = parseRes.constraints.rooms.find(r => r.name.toLowerCase() === room.name.toLowerCase());
          if (pr?.dim_width_ft && pr?.dim_depth_ft) {
            const req = pr.dim_width_ft * pr.dim_depth_ft;
            const got = room.placed.width * room.placed.depth;
            if (got > req * 1.5) inflated++;
          }
        }

        console.log(`  Opt-${i} t=${temp}: ${sc.score}/${sc.grade} doors=${met.door_coverage_pct}% orphans=${met.orphan_rooms.length} eff=${met.efficiency_pct}% rooms=${proj.floors[0]?.rooms.length ?? 0} inflated=${inflated}`);
        return { score: sc.score, grade: sc.grade, doors: met.door_coverage_pct, orphans: met.orphan_rooms.length, eff: met.efficiency_pct, rooms: proj.floors[0]?.rooms.length ?? 0, inflated };
      } catch (e) {
        console.log(`  Opt-${i} t=${temp}: FAILED`);
        return null;
      }
    }));

    const valid = opts.filter((o): o is NonNullable<typeof o> => o !== null);
    valid.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.orphans !== b.orphans) return a.orphans - b.orphans;
      return b.doors - a.doors;
    });

    if (valid.length === 0) {
      rows.push(`x ${p.tag.padEnd(22)} ALL FAILED`);
      allPass = false;
      continue;
    }

    const best = valid[0];
    const scores = valid.map(v => v.score);
    const diverse = new Set(scores).size > 1;
    const pass = best.score >= 50 && best.doors >= 80 && best.orphans <= 2 && best.inflated === 0;
    if (!pass) allPass = false;

    rows.push(
      `${pass ? "+" : "x"} ${p.tag.padEnd(22)} best=${best.score}/${best.grade} doors=${best.doors}% orphans=${best.orphans} eff=${best.eff}% rooms=${best.rooms} inflated=${best.inflated} scores=[${scores.join(",")}] diverse=${diverse ? "Y" : "N"}`
    );
  }

  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY\n");
  for (const r of rows) console.log("  " + r);
  console.log(`\n  VERDICT: ${allPass ? "ALL PASS" : "ISSUES FOUND"}`);
  console.log("=".repeat(70));
}

main().catch(e => { console.error(e); process.exit(1); });
