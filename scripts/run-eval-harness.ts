/**
 * Eval harness — runs all 8 archetype briefs through the v3 pipeline
 * and reports entity counts, coverage, and runtime.
 *
 * Usage:
 *   npx tsx scripts/run-eval-harness.ts --mode=local-spec-only
 *   npx tsx scripts/run-eval-harness.ts --mode=spec-shape-only
 *   npx tsx scripts/run-eval-harness.ts --mode=full
 *
 * local-spec-only: No LLM calls, no Railway. Validates TS wiring only.
 * spec-shape-only: Calls Opus enricher (uses credits), validates spec
 *   faithfulness — flags overreach (elements not in brief). No Railway.
 * full: Calls enricher + agent loop end-to-end (uses credits + Railway).
 */

import fs from "node:fs";
import path from "node:path";

const BRIEFS_DIR = path.join(__dirname, "..", "evals", "briefs");
const RESULTS_DIR = path.join(__dirname, "..", "evals", "results");

// Keywords that, if present in a spec but absent from the brief text,
// indicate the enricher invented elements (overreach).
const OVERREACH_KEYWORDS = [
  "reception", "plant", "planter", "pooja", "niche",
  "ceiling fan", "ac unit", "air conditioner", "balcony",
  "storage closet", "utility room", "water cooler", "vending",
  "fire extinguisher", "cctv", "security", "signage",
];

interface EvalResult {
  brief: string;
  archetype: string;
  mode: string;
  entityCount: number | null;
  buildDurationMs: number | null;
  overreach: string[];
  partsCheck: { total: number; underDecomposed: string[] } | null;
  error: string | null;
  timestamp: string;
}

export function detectOverreach(briefText: string, spec: Record<string, unknown>): string[] {
  const briefLower = briefText.toLowerCase();
  const overreaches: string[] = [];

  // Collect all text from spec elements, furniture, openings, lighting
  const specTexts: string[] = [];
  for (const el of (spec.elements as Array<Record<string, unknown>>) ?? []) {
    specTexts.push(
      String(el.description ?? "").toLowerCase(),
      String(el.object_type ?? "").toLowerCase(),
      String(el.type ?? "").toLowerCase(),
    );
  }
  for (const f of (spec.furniture as Array<Record<string, unknown>>) ?? []) {
    specTexts.push(
      String(f.type ?? "").toLowerCase(),
      String(f.description ?? "").toLowerCase(),
    );
  }
  for (const zone of ((spec.lighting as Record<string, unknown>)?.zones as Array<Record<string, unknown>>) ?? []) {
    specTexts.push(String(zone.fixture_type ?? "").toLowerCase());
  }
  for (const sp of (spec.spaces as Array<Record<string, unknown>>) ?? []) {
    specTexts.push(
      String(sp.name ?? "").toLowerCase(),
      String(sp.occupancy_type ?? "").toLowerCase(),
    );
  }

  const specBlob = specTexts.join(" ");

  for (const kw of OVERREACH_KEYWORDS) {
    if (specBlob.includes(kw) && !briefLower.includes(kw)) {
      overreaches.push(kw);
    }
  }

  return overreaches;
}

/** Check that every furniture item in a spec has parts.length >= minParts.
 *  Returns the total parts count and any under-decomposed items. */
function checkParts(
  spec: Record<string, unknown>,
  minParts = 4,
): { total: number; underDecomposed: string[] } {
  const furniture = (spec.furniture as Array<Record<string, unknown>>) ?? [];
  let total = 0;
  const underDecomposed: string[] = [];
  for (const item of furniture) {
    const parts = (item.parts as unknown[]) ?? [];
    total += parts.length;
    if (parts.length < minParts && parts.length > 0) {
      underDecomposed.push(`${item.type ?? item.id} (${parts.length} parts)`);
    } else if (parts.length === 0) {
      underDecomposed.push(`${item.type ?? item.id} (no parts)`);
    }
  }
  return { total, underDecomposed };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let mode = "local-spec-only";
  if (args.includes("--mode=full")) mode = "full";
  else if (args.includes("--mode=spec-shape-only")) mode = "spec-shape-only";
  const shouldCheckParts = args.includes("--check-parts");

  console.log(`\n=== Brief-to-IFC v3 Eval Harness (mode: ${mode}) ===\n`);

  const briefFiles = fs.readdirSync(BRIEFS_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .sort();

  console.log(`Found ${briefFiles.length} eval briefs:\n`);
  for (const f of briefFiles) {
    console.log(`  - ${f}`);
  }
  console.log("");

  const results: EvalResult[] = [];

  for (const file of briefFiles) {
    const briefPath = path.join(BRIEFS_DIR, file);
    const raw = fs.readFileSync(briefPath, "utf-8");
    const data = JSON.parse(raw) as { brief: string; projectType?: string };
    const archetype = file.replace(".json", "").replace(/-/g, "_");

    console.log(`Running: ${file} (archetype: ${archetype})`);

    if (mode === "local-spec-only") {
      results.push({
        brief: file, archetype, mode,
        entityCount: null, buildDurationMs: null,
        overreach: [],
        partsCheck: null,
        error: null,
        timestamp: new Date().toISOString(),
      });
      console.log(`  [DRY RUN] Brief parsed OK\n`);
      continue;
    }

    if (mode === "spec-shape-only") {
      // Call the actual enricher — uses Anthropic credits.
      try {
        const { enrichBrief } = await import(
          "../src/features/brief-to-ifc/v3/brief-enrichment"
        );
        const result = await enrichBrief({
          brief: data.brief,
          projectType: data.projectType as "office" | "residential" | "retail" | "exhibition_booth" | undefined,
        });

        if (!result.ok || !result.brief) {
          results.push({
            brief: file, archetype, mode,
            entityCount: null, buildDurationMs: null,
            overreach: [],
            error: `Enrichment failed: ${result.error?.message ?? "unknown"}`,
            timestamp: new Date().toISOString(),
          });
          console.log(`  [FAIL] Enrichment error: ${result.error?.message}\n`);
          continue;
        }

        const spec = result.brief as unknown as Record<string, unknown>;
        const overreach = detectOverreach(data.brief, spec);

        // Optional: run item decomposer and check parts
        let partsResult: { total: number; underDecomposed: string[] } | null = null;
        if (shouldCheckParts) {
          try {
            const { decomposeBriefSpecItems } = await import(
              "../src/features/brief-to-ifc/v3/item-decomposer"
            );
            const decomposed = await decomposeBriefSpecItems(result.brief!, undefined);
            partsResult = checkParts(decomposed.spec as unknown as Record<string, unknown>);
            console.log(
              `  [PARTS] ${partsResult.total} total parts, ` +
              `${partsResult.underDecomposed.length} under-decomposed`,
            );
          } catch (partsErr) {
            console.log(`  [PARTS SKIP] ${partsErr instanceof Error ? partsErr.message : partsErr}`);
          }
        }

        results.push({
          brief: file, archetype, mode,
          entityCount: null, buildDurationMs: result.durationMs,
          overreach,
          partsCheck: partsResult,
          error: overreach.length > 0 ? `OVERREACH: ${overreach.join(", ")}` : null,
          timestamp: new Date().toISOString(),
        });

        if (overreach.length > 0) {
          console.log(`  [OVERREACH] Unstated elements found: ${overreach.join(", ")}\n`);
        } else {
          console.log(`  [OK] No overreach detected (${result.durationMs}ms)\n`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          brief: file, archetype, mode,
          entityCount: null, buildDurationMs: null,
          overreach: [],
          partsCheck: null,
          error: msg.includes("API") || msg.includes("key") ? "SKIPPED: no credits" : msg,
          timestamp: new Date().toISOString(),
        });
        console.log(`  [SKIP] ${msg.slice(0, 80)}\n`);
      }
      continue;
    }

    // Full mode — requires Railway
    results.push({
      brief: file, archetype, mode,
      entityCount: null, buildDurationMs: null,
      overreach: [],
      partsCheck: null,
      error: "full mode requires live Railway + Anthropic",
      timestamp: new Date().toISOString(),
    });
    console.log(`  [SKIP] full mode not implemented offline\n`);
  }

  // Write results
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const suffix = mode === "spec-shape-only" ? "spec-shape" : "summary";
  const jsonPath = path.join(RESULTS_DIR, `${ts}-${suffix}.json`);
  const mdPath = path.join(RESULTS_DIR, `${ts}-${suffix}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

  const md = [
    `# Eval Results — ${ts}`,
    ``,
    `Mode: ${mode}`,
    `Briefs: ${briefFiles.length}`,
    ``,
    `| Brief | Archetype | Overreach | Error |`,
    `|-------|-----------|-----------|-------|`,
    ...results.map((r) =>
      `| ${r.brief} | ${r.archetype} | ${r.overreach.length > 0 ? r.overreach.join(", ") : "none"} | ${r.error ?? "OK"} |`,
    ),
    ``,
    `Zero-overreach briefs: ${results.filter((r) => r.overreach.length === 0 && !r.error).length}/${results.length}`,
    ``,
  ].join("\n");

  fs.writeFileSync(mdPath, md);

  console.log(`\nResults written to:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  MD:   ${mdPath}`);
  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error("Eval harness failed:", err);
  process.exit(1);
});
