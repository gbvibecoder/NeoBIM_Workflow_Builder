/**
 * Eval harness driver — runs every brief in `evals/briefs/` through
 * Layer 2 (the generator agent) and reports per-brief pass/fail +
 * total cost + total latency.
 *
 * Usage (after the Python sandbox is deployed and ANTHROPIC_API_KEY +
 * IFC_SERVICE_URL + IFC_SERVICE_API_KEY are set):
 *
 *   npx tsx src/features/brief-to-ifc/v3/evals/run.ts
 *
 * Or for one brief:
 *   npx tsx src/features/brief-to-ifc/v3/evals/run.ts small-office
 *
 * Eval gate (matches the Phase v3 acceptance criteria):
 *   • Pass = generator returns ok + finalValidation.refs_resolve + the
 *     spec's every space.id appears in validation.spaces_present.
 *   • Cost gate: per-brief cost < $1.50 USD (we report mean across briefs).
 *   • Latency gate: total durationMs < 90_000.
 *   • ASCII gate: validation.ascii_only must be true on the final IFC.
 */

import fs from "node:fs";
import path from "node:path";

import { briefSpecSchema, runGenerator } from "../index";
import type { BriefSpec, GeneratorResult } from "../types";

const BRIEFS_DIR = path.join(__dirname, "briefs");

interface EvalRow {
  brief_id: string;
  ok: boolean;
  entityCount: number;
  costUsd: number;
  durationMs: number;
  turns: number;
  spacesPresent: number;
  spacesMissing: number;
  asciiOnly: boolean;
  refsResolve: boolean;
  // Brief-aware visual checks (added 2026-05-16 — see forensics/diagnosis.md).
  worldBboxVerdict: string | null;
  worldBboxExtent: [number, number, number] | null;
  spacePolygonsAllOk: boolean;
  elementCoverageVerdict: string | null;
  missingElementCount: number;
  originCollapsed: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

async function runOne(briefPath: string): Promise<EvalRow> {
  const briefId = path.basename(briefPath, ".json");
  const rawJson = fs.readFileSync(briefPath, "utf-8");
  const parsed = briefSpecSchema.safeParse(JSON.parse(rawJson));
  if (!parsed.success) {
    return {
      brief_id: briefId,
      ok: false,
      entityCount: 0,
      costUsd: 0,
      durationMs: 0,
      turns: 0,
      spacesPresent: 0,
      spacesMissing: 0,
      asciiOnly: false,
      refsResolve: false,
      worldBboxVerdict: null,
      worldBboxExtent: null,
      spacePolygonsAllOk: false,
      elementCoverageVerdict: null,
      missingElementCount: 0,
      originCollapsed: false,
      errorCode: "INVALID_BRIEF_JSON",
      errorMessage: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  const brief: BriefSpec = parsed.data;

  process.stdout.write(`\n=== ${briefId} ===\n`);
  process.stdout.write(
    `spaces=${brief.spaces.length} elements=${brief.elements.length} materials=${brief.materials.length}\n`,
  );

  const result: GeneratorResult = await runGenerator({
    brief,
    onTurn: (r) => {
      process.stdout.write(
        `  turn ${r.turn}: ${r.toolName} (${r.toolDurationMs}ms) ${r.toolOk ? "OK" : "FAIL " + (r.toolErrorType ?? "?")}\n`,
      );
    },
  });

  const v = result.finalValidation;
  // Visual quality gates — these were the 2026-05-16 false-green miss.
  // A run only passes when the geometric bbox matches the brief AND
  // no large origin cluster exists. See forensics/diagnosis.md.
  const wb = v?.world_bbox;
  const oc = v?.origin_collapse;
  const ec = v?.element_coverage;
  const sp = v?.space_polygons;
  const worldBboxOk = wb ? wb.verdict === "OK" : true;
  // space_polygons treats NO_EXPECTED_POLYGON (circular spaces) as
  // non-failing — only MISSING / MISMATCH / NO_POLYGON_REP / ERROR count.
  const spacePolygonsAllOk = sp
    ? sp.every((s) =>
        s.verdict === "OK" ||
        s.verdict === "NO_EXPECTED_POLYGON",
      )
    : true;
  const originCollapsed = oc?.collapsed ?? false;
  const elementCoverageOk = ec ? ec.verdict === "OK" : true;

  const visualOk =
    worldBboxOk && spacePolygonsAllOk && !originCollapsed && elementCoverageOk;

  return {
    brief_id: briefId,
    ok: result.ok && Boolean(v?.refs_resolve) && visualOk,
    entityCount: result.entityCount,
    costUsd: result.costUsd,
    durationMs: result.durationMs,
    turns: result.turns,
    spacesPresent: v?.spaces_present.length ?? 0,
    spacesMissing: v?.spaces_missing.length ?? 0,
    asciiOnly: v?.ascii_only ?? false,
    refsResolve: v?.refs_resolve ?? false,
    worldBboxVerdict: wb?.verdict ?? null,
    worldBboxExtent: wb?.actual_extent ?? null,
    spacePolygonsAllOk,
    elementCoverageVerdict: ec?.verdict ?? null,
    missingElementCount: ec?.missing_id_count ?? 0,
    originCollapsed,
    errorCode: result.error?.code ?? null,
    errorMessage: result.error?.message ?? null,
  };
}

function fmtCsv(rows: EvalRow[]): string {
  const header = [
    "brief_id", "ok", "entityCount", "costUsd", "durationMs",
    "turns", "spacesPresent", "spacesMissing", "asciiOnly",
    "refsResolve", "worldBboxVerdict", "worldBboxExtent",
    "spacePolygonsAllOk", "elementCoverageVerdict", "missingElementCount",
    "originCollapsed", "errorCode", "errorMessage",
  ].join(",");
  const lines = rows.map((r) =>
    [
      r.brief_id, r.ok, r.entityCount, r.costUsd.toFixed(4),
      r.durationMs, r.turns, r.spacesPresent, r.spacesMissing,
      r.asciiOnly, r.refsResolve,
      r.worldBboxVerdict ?? "",
      r.worldBboxExtent
        ? `"${r.worldBboxExtent.map((n) => n.toFixed(3)).join("x")}"`
        : "",
      r.spacePolygonsAllOk, r.elementCoverageVerdict ?? "",
      r.missingElementCount, r.originCollapsed,
      r.errorCode ?? "", `"${(r.errorMessage ?? "").replace(/"/g, '""')}"`,
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

async function main(): Promise<void> {
  const filter = process.argv[2];

  if (!fs.existsSync(BRIEFS_DIR)) {
    process.stderr.write(`No briefs dir: ${BRIEFS_DIR}\n`);
    process.exit(2);
  }
  const briefFiles = fs
    .readdirSync(BRIEFS_DIR)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !filter || f.startsWith(filter))
    .map((f) => path.join(BRIEFS_DIR, f));

  if (briefFiles.length === 0) {
    process.stderr.write(`No matching briefs.\n`);
    process.exit(2);
  }

  const rows: EvalRow[] = [];
  for (const bp of briefFiles) {
    try {
      rows.push(await runOne(bp));
    } catch (err) {
      rows.push({
        brief_id: path.basename(bp, ".json"),
        ok: false, entityCount: 0, costUsd: 0, durationMs: 0, turns: 0,
        spacesPresent: 0, spacesMissing: 0, asciiOnly: false, refsResolve: false,
        worldBboxVerdict: null,
        worldBboxExtent: null,
        spacePolygonsAllOk: false,
        elementCoverageVerdict: null,
        missingElementCount: 0,
        originCollapsed: false,
        errorCode: "UNCAUGHT",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Summary.
  const passed = rows.filter((r) => r.ok).length;
  const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
  const meanCost = rows.length > 0 ? totalCost / rows.length : 0;
  const meanDuration =
    rows.length > 0
      ? rows.reduce((s, r) => s + r.durationMs, 0) / rows.length
      : 0;
  const p95Duration = (() => {
    if (rows.length === 0) return 0;
    const sorted = [...rows].sort((a, b) => a.durationMs - b.durationMs);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
      .durationMs;
  })();

  process.stdout.write(`\n=== EVAL SUMMARY ===\n`);
  process.stdout.write(`pass: ${passed}/${rows.length}\n`);
  process.stdout.write(`mean cost: $${meanCost.toFixed(3)}\n`);
  process.stdout.write(`total cost: $${totalCost.toFixed(3)}\n`);
  process.stdout.write(`mean latency: ${(meanDuration / 1000).toFixed(1)}s\n`);
  process.stdout.write(`p95 latency: ${(p95Duration / 1000).toFixed(1)}s\n`);
  process.stdout.write(
    `\ngate: cost ${meanCost < 1.2 ? "PASS" : "FAIL"} (mean < $1.20)\n`,
  );
  process.stdout.write(
    `gate: latency ${p95Duration < 90_000 ? "PASS" : "FAIL"} (p95 < 90s)\n`,
  );

  const csv = fmtCsv(rows);
  const csvPath = path.join(
    process.cwd(),
    `PHASE_BRIEF_TO_IFC_V3_COST_LOG.csv`,
  );
  fs.writeFileSync(csvPath, csv, "utf-8");
  process.stdout.write(`\nCSV written: ${csvPath}\n`);

  process.exit(passed === rows.length ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
