/**
 * Phase 2.10 — end-to-end measurement script.
 *
 * Runs the VIP pipeline (Stages 1 → 6) directly against the real
 * Anthropic + OpenAI APIs for a single locked prompt:
 *
 *   "3BHK 40x40 north facing vastu pooja room"
 *
 * Bypasses the DB-backed VIPLogger + QStash job queue — each stage
 * is invoked with no logger, so nothing persists to `vip_jobs`. All
 * measurement is captured in-process and written to:
 *
 *   docs/phase-2-10-e2e-measurement.md         — human-readable report
 *   experiments/outputs/phase-2-10-e2e/        — raw artefacts:
 *     run.json                                   — per-stage metrics
 *     stage2-image.png                           — generated floor plan
 *     stage4-extraction.json                     — ExtractedRooms
 *     stage5-project.json                        — FloorPlanProject
 *     stage6-verdict.json                        — QualityVerdict
 *
 * Pre-Phase-2.10 baseline: score 52-65 / 100.
 * Phase 2.10 target: score 70-78 / 100.
 *
 * Usage: `tsx scripts/run-phase-2-10-e2e.ts`
 */

/* eslint-disable no-console */

import * as fs from "node:fs";
import * as path from "node:path";

// .env.local loader
(function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

import { parseConstraints } from "../src/features/floor-plan/lib/structured-parser";
import { runStage1PromptIntelligence } from "../src/features/floor-plan/lib/vip-pipeline/stage-1-prompt";
import { runStage2ParallelImageGen } from "../src/features/floor-plan/lib/vip-pipeline/stage-2-images";
import { runStage4RoomExtraction } from "../src/features/floor-plan/lib/vip-pipeline/stage-4-extract";
import { runStage5Synthesis } from "../src/features/floor-plan/lib/vip-pipeline/stage-5-synthesis";
import { runStage6QualityGate } from "../src/features/floor-plan/lib/vip-pipeline/stage-6-quality";

const PROMPT = "3BHK 40x40 north facing vastu pooja room";
const OUT_DIR = path.resolve(process.cwd(), "experiments/outputs/phase-2-10-e2e");
const REPORT_PATH = path.resolve(process.cwd(), "docs/phase-2-10-e2e-measurement.md");
const BASELINE_MIN = 52;
const BASELINE_MAX = 65;
const TARGET_MIN = 70;
const TARGET_MAX = 78;

interface StageMetrics {
  name: string;
  durationMs: number;
  costUsd?: number;
  error?: string;
}

async function main(): Promise<void> {
  console.log("─".repeat(64));
  console.log(`Phase 2.10 — E2E measurement`);
  console.log(`Prompt: "${PROMPT}"`);
  console.log("─".repeat(64));

  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
    if (!process.env[key]) {
      console.error(`[fatal] ${key} missing — cannot run E2E`);
      process.exit(1);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const runStartMs = Date.now();
  const stageMetrics: StageMetrics[] = [];
  let totalCost = 0;

  // ── Parse ──
  console.log(`\n[parse] parseConstraints`);
  const tParse = Date.now();
  const parseResult = await parseConstraints(PROMPT);
  const parseMs = Date.now() - tParse;
  stageMetrics.push({ name: "parse", durationMs: parseMs });
  console.log(`  rooms=${parseResult.constraints.rooms.length} plot=${parseResult.constraints.plot.width_ft}×${parseResult.constraints.plot.depth_ft} ${parseMs}ms`);

  // ── Stage 1 ──
  console.log(`\n[stage1] runStage1PromptIntelligence`);
  const t1 = Date.now();
  const { output: s1Out, metrics: s1m } = await runStage1PromptIntelligence({
    prompt: PROMPT,
    parsedConstraints: parseResult.constraints,
  });
  const s1Ms = Date.now() - t1;
  totalCost += s1m.costUsd;
  stageMetrics.push({ name: "stage1", durationMs: s1Ms, costUsd: s1m.costUsd });
  console.log(`  brief.roomList (${s1Out.brief.roomList.length}): ${s1Out.brief.roomList.map((r) => r.name).join(", ")}`);
  console.log(`  imagePrompts: ${s1Out.imagePrompts.length}  cost=$${s1m.costUsd.toFixed(4)}  ${s1Ms}ms`);
  const hasLabelBlock = s1Out.imagePrompts[0]?.prompt.includes("CRITICAL LABEL REQUIREMENTS:");
  console.log(`  [2.10.3] CRITICAL LABEL REQUIREMENTS present: ${hasLabelBlock ? "YES" : "NO"}`);

  // ── Stage 2 ──
  console.log(`\n[stage2] runStage2ParallelImageGen`);
  const t2 = Date.now();
  const { output: s2Out, metrics: s2m } = await runStage2ParallelImageGen({
    imagePrompts: s1Out.imagePrompts,
  });
  const s2Ms = Date.now() - t2;
  totalCost += s2m.totalCostUsd;
  stageMetrics.push({ name: "stage2", durationMs: s2Ms, costUsd: s2m.totalCostUsd });
  const gptImage = s2Out.images.find((i) => i.model === "gpt-image-1.5");
  if (!gptImage?.base64) {
    console.error(`[fatal] stage 2 produced no gpt-image-1.5 output`);
    process.exit(1);
  }
  const s2ImagePath = path.join(OUT_DIR, "stage2-image.png");
  fs.writeFileSync(s2ImagePath, Buffer.from(gptImage.base64, "base64"));
  console.log(`  image: ${gptImage.width}×${gptImage.height}  cost=$${s2m.totalCostUsd.toFixed(4)}  ${s2Ms}ms`);
  console.log(`  saved: ${path.relative(process.cwd(), s2ImagePath)}`);

  // ── Stage 4 ──
  console.log(`\n[stage4] runStage4RoomExtraction`);
  const t4 = Date.now();
  const { output: s4Out, metrics: s4m } = await runStage4RoomExtraction({
    image: gptImage,
    brief: s1Out.brief,
  });
  const s4Ms = Date.now() - t4;
  totalCost += s4m.costUsd;
  stageMetrics.push({ name: "stage4", durationMs: s4Ms, costUsd: s4m.costUsd });
  const ext = s4Out.extraction;
  console.log(`  rooms: ${ext.rooms.length} (brief expected ${s1Out.brief.roomList.length})`);
  console.log(`  missing: [${ext.expectedRoomsMissing.join(", ")}]`);
  console.log(`  unexpected: [${ext.unexpectedRoomsFound.join(", ")}]`);
  console.log(`  issues: ${ext.issues.length}`);
  for (const m of ext.issues) console.log(`    - ${m}`);
  console.log(`  dedupRenames: ${ext.dedupRenames?.length ?? 0}`);
  if (ext.dedupRenames) for (const r of ext.dedupRenames) console.log(`    - ${r.from} → ${r.to}: ${r.reason}`);
  console.log(`  drift: ${ext.driftMetrics ? `${ext.driftMetrics.severity} (ratio ${ext.driftMetrics.driftRatio.toFixed(3)})` : "(not computed)"}`);
  console.log(`  cost=$${s4m.costUsd.toFixed(4)}  ${s4Ms}ms`);
  fs.writeFileSync(path.join(OUT_DIR, "stage4-extraction.json"), JSON.stringify(s4Out, null, 2));

  // ── Stage 5 ──
  console.log(`\n[stage5] runStage5Synthesis`);
  const t5 = Date.now();
  const { output: s5Out, metrics: s5m } = await runStage5Synthesis({
    extraction: ext,
    plotWidthFt: s1Out.brief.plotWidthFt,
    plotDepthFt: s1Out.brief.plotDepthFt,
    facing: s1Out.brief.facing,
    parsedConstraints: parseResult.constraints,
    municipality: s1Out.brief.municipality,
    adjacencies: s1Out.brief.adjacencies,
    brief: s1Out.brief,
    userPrompt: PROMPT,
  });
  const s5Ms = Date.now() - t5;
  stageMetrics.push({ name: "stage5", durationMs: s5Ms, costUsd: 0 });
  console.log(`  path: ${s5m.path ?? "strip-pack"}`);
  console.log(`  rooms=${s5m.roomCount} walls=${s5m.wallCount} doors=${s5m.doorCount} windows=${s5m.windowCount}`);
  console.log(`  issues: ${s5Out.issues.length}`);
  for (const m of s5Out.issues) console.log(`    - ${m}`);
  console.log(`  ${s5Ms}ms`);
  fs.writeFileSync(path.join(OUT_DIR, "stage5-project.json"), JSON.stringify(s5Out.project, null, 2));

  // ── Stage 6 ──
  console.log(`\n[stage6] runStage6QualityGate`);
  const t6 = Date.now();
  const { output: s6Out, metrics: s6m } = await runStage6QualityGate({
    project: s5Out.project,
    brief: s1Out.brief,
    parsedConstraints: parseResult.constraints,
    driftMetrics: ext.driftMetrics,
  });
  const s6Ms = Date.now() - t6;
  totalCost += s6m.costUsd;
  stageMetrics.push({ name: "stage6", durationMs: s6Ms, costUsd: s6m.costUsd });
  const verdict = s6Out.verdict;
  console.log(`  score: ${verdict.score} / 100  recommendation: ${verdict.recommendation}`);
  console.log(`  dimensions:`);
  for (const [dim, val] of Object.entries(verdict.dimensions)) console.log(`    ${dim.padEnd(24)} ${val}/10`);
  console.log(`  weakAreas: [${verdict.weakAreas.join(", ")}]`);
  console.log(`  reasoning: ${verdict.reasoning}`);
  console.log(`  cost=$${s6m.costUsd.toFixed(4)}  ${s6Ms}ms`);
  fs.writeFileSync(path.join(OUT_DIR, "stage6-verdict.json"), JSON.stringify(s6Out, null, 2));

  const totalMs = Date.now() - runStartMs;

  // ── Deltas vs baseline ──
  const inBaseline = verdict.score >= BASELINE_MIN && verdict.score <= BASELINE_MAX;
  const inTarget = verdict.score >= TARGET_MIN && verdict.score <= TARGET_MAX;
  const aboveTarget = verdict.score > TARGET_MAX;
  const belowBaseline = verdict.score < BASELINE_MIN;
  const status = aboveTarget
    ? "ABOVE TARGET"
    : inTarget
      ? "IN TARGET"
      : inBaseline
        ? "STILL IN BASELINE BAND"
        : belowBaseline
          ? "BELOW BASELINE"
          : "BETWEEN BASELINE AND TARGET";

  console.log("\n" + "─".repeat(64));
  console.log(`[summary] score=${verdict.score}/100 → ${status}`);
  console.log(`          baseline=${BASELINE_MIN}-${BASELINE_MAX}  target=${TARGET_MIN}-${TARGET_MAX}`);
  console.log(`          totalCost=$${totalCost.toFixed(4)}  totalMs=${totalMs}`);

  // ── Dump run.json ──
  const runJson = {
    prompt: PROMPT,
    timestamp: new Date().toISOString(),
    totalMs,
    totalCostUsd: Number(totalCost.toFixed(4)),
    stageMetrics,
    brief: s1Out.brief,
    imagePromptIncludesLabelBlock: hasLabelBlock,
    extraction: {
      roomCount: ext.rooms.length,
      rooms: ext.rooms.map((r) => ({ name: r.name, confidence: r.confidence, area: r.rectPx.w * r.rectPx.h })),
      missing: ext.expectedRoomsMissing,
      unexpected: ext.unexpectedRoomsFound,
      issues: ext.issues,
      dedupRenames: ext.dedupRenames ?? [],
      driftMetrics: ext.driftMetrics ?? null,
    },
    synthesis: {
      path: s5m.path ?? "strip-pack",
      roomCount: s5m.roomCount,
      wallCount: s5m.wallCount,
      doorCount: s5m.doorCount,
      windowCount: s5m.windowCount,
      issues: s5Out.issues,
      enhancement: s5m.enhancement ?? null,
    },
    quality: {
      score: verdict.score,
      recommendation: verdict.recommendation,
      dimensions: verdict.dimensions,
      weakAreas: verdict.weakAreas,
      reasoning: verdict.reasoning,
    },
    status,
  };
  fs.writeFileSync(path.join(OUT_DIR, "run.json"), JSON.stringify(runJson, null, 2));

  // ── Markdown report ──
  writeReport({
    runJson,
    status,
    inBaseline,
    inTarget,
    aboveTarget,
    belowBaseline,
  });

  console.log(`\n[done] artefacts=${path.relative(process.cwd(), OUT_DIR)}`);
  console.log(`       report=${path.relative(process.cwd(), REPORT_PATH)}`);
}

interface ReportInput {
  runJson: Record<string, unknown>;
  status: string;
  inBaseline: boolean;
  inTarget: boolean;
  aboveTarget: boolean;
  belowBaseline: boolean;
}

function writeReport(r: ReportInput): void {
  const lines: string[] = [];
  const rj = r.runJson as Record<string, unknown>;
  const quality = rj.quality as { score: number; recommendation: string; dimensions: Record<string, number>; weakAreas: string[]; reasoning: string };
  const extraction = rj.extraction as {
    roomCount: number;
    missing: string[];
    unexpected: string[];
    issues: string[];
    dedupRenames: Array<{ from: string; to: string; reason: string }>;
    driftMetrics: { severity: string; driftRatio: number } | null;
  };
  const synthesis = rj.synthesis as {
    path: string;
    roomCount: number;
    wallCount: number;
    doorCount: number;
    windowCount: number;
    issues: string[];
  };
  const brief = rj.brief as { roomList: Array<{ name: string; type: string }> };
  const stageMetrics = rj.stageMetrics as StageMetrics[];

  lines.push("# Phase 2.10 — End-to-End Quality Measurement");
  lines.push("");
  lines.push(`**Date:** ${String(rj.timestamp)}`);
  lines.push(`**Branch:** \`feat/phase-2-10-accuracy-patches\` (after all 4 steps committed)`);
  lines.push(`**Prompt:** "${String(rj.prompt)}"`);
  lines.push("");

  const emoji = r.aboveTarget ? "🚀" : r.inTarget ? "✅" : r.belowBaseline ? "❌" : "⚠️";
  lines.push(`## 1. Executive summary`);
  lines.push("");
  lines.push(`${emoji} **Score: ${quality.score} / 100** — ${r.status.toLowerCase()}.`);
  lines.push(`**Recommendation:** ${quality.recommendation}`);
  lines.push(`**Baseline band:** 52–65 (pre-Phase-2.10). **Target band:** 70–78.`);
  const delta = quality.score - 58; // midpoint 58 of baseline band
  lines.push(`**Delta vs baseline midpoint (58):** ${delta >= 0 ? "+" : ""}${delta}`);
  lines.push("");

  lines.push(`## 2. Phase 2.10 change-specific observations`);
  lines.push("");
  lines.push(`- **Label block injection (2.10.3):** ${rj.imagePromptIncludesLabelBlock ? "✅ present in Stage 1 image prompt" : "❌ NOT present"}`);
  lines.push(`- **Dedup renames (2.10.3):** ${extraction.dedupRenames.length} applied`);
  for (const d of extraction.dedupRenames) lines.push(`  - \`${d.from}\` → \`${d.to}\` (${d.reason})`);
  lines.push(`- **Drift metrics (2.10.2):** ${extraction.driftMetrics ? `${extraction.driftMetrics.severity} (ratio ${extraction.driftMetrics.driftRatio.toFixed(3)})` : "not computed"}`);
  const driftPenalty = extraction.driftMetrics?.severity === "severe" ? -10 : extraction.driftMetrics?.severity === "moderate" ? -5 : 0;
  lines.push(`- **Drift penalty applied on dimensionPlausibility:** ${driftPenalty}`);
  const phantomDrops = extraction.issues.filter((s) => s.startsWith("phantom:"));
  lines.push(`- **Phantom drops (2.10.4):** ${phantomDrops.length} — threshold now 16 sqft`);
  for (const p of phantomDrops) lines.push(`  - ${p}`);
  lines.push("");

  lines.push(`## 3. Quality verdict breakdown`);
  lines.push("");
  lines.push("| Dimension | Score (1–10) |");
  lines.push("|---|---:|");
  for (const [dim, val] of Object.entries(quality.dimensions)) {
    lines.push(`| ${dim} | ${val} |`);
  }
  lines.push("");
  lines.push(`**weakAreas** (score < 6): ${quality.weakAreas.length > 0 ? quality.weakAreas.map((w) => `\`${w}\``).join(", ") : "none"}`);
  lines.push("");
  lines.push(`**Reasoning:** ${quality.reasoning}`);
  lines.push("");

  lines.push(`## 4. Extraction detail`);
  lines.push("");
  lines.push(`- Extracted rooms: **${extraction.roomCount}** / brief expected: **${brief.roomList.length}**`);
  lines.push(`- Missing (not in extraction): [${extraction.missing.join(", ") || "none"}]`);
  lines.push(`- Unexpected (in extraction, not in brief): [${extraction.unexpected.join(", ") || "none"}]`);
  lines.push(`- Stage 4 issues: ${extraction.issues.length}`);
  for (const m of extraction.issues) lines.push(`  - ${m}`);
  lines.push("");

  lines.push(`## 5. Synthesis (Stage 5) detail`);
  lines.push("");
  lines.push(`- Path: **${synthesis.path}**`);
  lines.push(`- Rooms / walls / doors / windows: ${synthesis.roomCount} / ${synthesis.wallCount} / ${synthesis.doorCount} / ${synthesis.windowCount}`);
  lines.push(`- Stage 5 issues: ${synthesis.issues.length}`);
  for (const m of synthesis.issues) lines.push(`  - ${m}`);
  lines.push("");

  lines.push(`## 6. Timing + cost breakdown`);
  lines.push("");
  lines.push(`- Total wall-clock: ${rj.totalMs} ms`);
  lines.push(`- Total cost: $${String(rj.totalCostUsd)}`);
  lines.push("");
  lines.push("| Stage | Duration (ms) | Cost (USD) |");
  lines.push("|---|---:|---:|");
  for (const s of stageMetrics) {
    lines.push(`| ${s.name} | ${s.durationMs} | ${s.costUsd !== undefined ? `$${s.costUsd.toFixed(4)}` : "—"} |`);
  }
  lines.push("");

  lines.push(`## 7. Artefacts`);
  lines.push("");
  lines.push(`- \`${path.relative(process.cwd(), path.join(OUT_DIR, "stage2-image.png"))}\` — generated floor plan (1024×1024 PNG)`);
  lines.push(`- \`${path.relative(process.cwd(), path.join(OUT_DIR, "stage4-extraction.json"))}\` — ExtractedRooms payload`);
  lines.push(`- \`${path.relative(process.cwd(), path.join(OUT_DIR, "stage5-project.json"))}\` — FloorPlanProject payload`);
  lines.push(`- \`${path.relative(process.cwd(), path.join(OUT_DIR, "stage6-verdict.json"))}\` — QualityVerdict payload`);
  lines.push(`- \`${path.relative(process.cwd(), path.join(OUT_DIR, "run.json"))}\` — aggregated metrics`);
  lines.push("");

  lines.push(`## 8. Interpretation`);
  lines.push("");
  if (r.aboveTarget) {
    lines.push(`Score **${quality.score}** exceeds the Phase 2.10 target band (70–78). Phase 2.10 has delivered more than the projected ceiling on this prompt.`);
  } else if (r.inTarget) {
    lines.push(`Score **${quality.score}** lands in the Phase 2.10 target band (70–78). The four-step patch set moved the prompt out of the Phase 2.9 baseline and into the new ceiling.`);
  } else if (r.inBaseline) {
    lines.push(`Score **${quality.score}** still falls inside the Phase 2.9 baseline band (52–65). Phase 2.10's patches did not move this particular prompt. Possible reasons: (a) per-prompt variance — one sample is not a trend; (b) the weakAreas driving the score are outside Phase 2.10's scope (e.g., vastu compliance, bedroom privacy); (c) the image generation hit a known GPT-Image failure mode unrelated to label uniqueness.`);
  } else if (r.belowBaseline) {
    lines.push(`Score **${quality.score}** is below the Phase 2.9 baseline (52–65). This is a regression signal and warrants investigation before Phase 2.10 is merged.`);
  } else {
    lines.push(`Score **${quality.score}** is between the baseline (52–65) and the target (70–78). Directional improvement without fully reaching the new ceiling. One sample only — a multi-prompt rollup is the right way to judge the landing.`);
  }
  lines.push("");
  lines.push(`**Note:** this is a single-prompt measurement. Phase 2.10's accuracy claim should be validated across 10+ prompts before declaring a production-ready ceiling shift.`);
  lines.push("");

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join("\n"));
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
