/**
 * scripts/kos-drawing-parse-test.ts
 *
 * Week 5C-1 verification driver for the KOS DXF drawing parser. Hits the
 * deployed Railway sidecar's `/kos/parse-drawing` route against real
 * customer DXF files and writes a JSON result + debug PNG per file plus a
 * COMPARISON.md verdict.
 *
 * This is the *investigative* phase: prove whether ezdxf-based vector
 * parsing yields usable walls + title blocks on real drawings before we
 * invest in PDF parsing (5C-2) and a vision fallback (5C-3).
 *
 *   # default: parse every *.dxf in /tmp/oda_test with debug PNGs
 *   npm run kos:drawing-parse-test
 *
 *   # custom folder + filter
 *   npm run kos:drawing-parse-test -- --path=/abs/dir --filter="90VR-*.dxf"
 *
 * IMPORT ORDER: `./lib/load-env` MUST be first — it populates process.env
 * before `kos-drawing-constants` captures KOS_SIDECAR_URL at module load.
 */

// 1. Side-effect import: load .env.local → process.env.
import "./lib/load-env";

// 2. App-layer KOS client (safe now that env is populated).
import { parseDrawing } from "@/features/kos/services/kos-drawing-parser";
import { KOS_SIDECAR_URL } from "@/features/kos/lib/kos-drawing-constants";
import type { DrawingParseResult } from "@/features/kos/types/drawing";

import fs from "node:fs";
import path from "node:path";

const LOG = "[parse-test]";
const RESULTS_DIR = path.join(process.cwd(), "temp_folder", "drawing-parse-results");

// ─── CLI args ────────────────────────────────────────────────────────────
function parseArg(flag: string): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1).trim();
  }
  return null;
}
function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function defaultPath(): string {
  const oda = "/tmp/oda_test";
  if (fs.existsSync(oda)) return oda;
  return "/Users/govindbhujbal/Desktop/cust_input";
}

// Convert a simple glob ("*.dxf", "90VR-*.dxf") into a RegExp.
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

// ─── helpers ───────────────────────────────────────────────────────────
function fmtConf(n: number): string {
  return n.toFixed(2);
}

function safeName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

interface FileOutcome {
  filename: string;
  ok: boolean;
  error?: string;
  result?: DrawingParseResult;
}

// ─── health check ────────────────────────────────────────────────────────
async function checkHealth(): Promise<void> {
  const url = `${KOS_SIDECAR_URL}/health`;
  console.info(`${LOG} sidecar: ${KOS_SIDECAR_URL}`);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(url, { signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
    if (!res.ok) {
      throw new Error(`health returned ${res.status}`);
    }
    const body = (await res.json()) as { status?: string; version?: string };
    console.info(
      `${LOG} health OK — status=${body.status ?? "?"} version=${body.version ?? "?"}`,
    );
  } catch (err) {
    console.error(
      `${LOG} sidecar UNREACHABLE at ${url}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    console.error(
      `${LOG} deploy the Python sidecar to Railway and retry. Aborting.`,
    );
    process.exit(1);
  }
}

// ─── COMPARISON.md ─────────────────────────────────────────────────────
function buildComparison(outcomes: FileOutcome[]): string {
  const ok = outcomes.filter((o) => o.ok && o.result);
  const lines: string[] = [];
  const p = (s = "") => lines.push(s);

  p("# KOS Week 5C-1 — DXF Parse Comparison");
  p("");
  p(`Generated: ${new Date().toISOString()}`);
  p(`Sidecar: ${KOS_SIDECAR_URL}`);
  p(`Files tested: ${outcomes.length} (${ok.length} parsed, ${outcomes.length - ok.length} failed)`);
  p("");

  // ── Summary table ──
  p("## Summary");
  p("");
  p("| File | Type | Conf | Strategy | Walls | Junctions | Units | BOQ | Formwork | Shop | Duration |");
  p("|------|------|------|----------|-------|-----------|-------|-----|----------|------|----------|");
  for (const o of outcomes) {
    if (!o.ok || !o.result) {
      p(`| ${o.filename} | **PARSE FAILED** | — | — | — | — | — | — | — | — | — |`);
      continue;
    }
    const r = o.result;
    p(
      `| ${r.filename} | ${r.drawing_type} | ${fmtConf(r.overall_confidence)} | ` +
        `${r.detection_strategy_used} | ${r.walls.length} | ${r.junctions.length} | ` +
        `${r.units_detected} | ${r.downstream_ready.boq ? "✅" : "❌"} | ` +
        `${r.downstream_ready.formwork ? "✅" : "❌"} | ` +
        `${r.downstream_ready.shop_drawings ? "✅" : "❌"} | ${r.duration_ms}ms |`,
    );
  }
  p("");

  // ── Title block per file ──
  p("## Title Block Extraction");
  p("");
  for (const o of ok) {
    const tb = o.result!.title_block;
    p(`### ${o.result!.filename}`);
    p("");
    p(`- **source**: ${tb.source}`);
    p(`- project_name: ${tb.project_name ?? "—"}`);
    p(`- drawing_number: ${tb.drawing_number ?? "—"}`);
    p(`- drawing_title: ${tb.drawing_title ?? "—"}`);
    p(`- revision: ${tb.revision ?? "—"}`);
    p(`- scale: ${tb.scale ?? "—"}`);
    p(`- level: ${tb.level ?? "—"}`);
    p(`- date: ${tb.date ?? "—"} · sheet: ${tb.sheet ?? "—"} · client: ${tb.client ?? "—"}`);
    p(`- drawn_by: ${tb.drawn_by ?? "—"} · checked_by: ${tb.checked_by ?? "—"}`);
    if (tb.extraction_warnings.length) {
      p(`- ⚠️ warnings: ${tb.extraction_warnings.join("; ")}`);
    }
    p("");
  }

  // ── Layer analysis ──
  p("## Layer Analysis");
  p("");
  for (const o of ok) {
    const r = o.result!;
    p(`### ${r.filename}`);
    p("");
    p(`- ${r.layers_found.length} layers`);
    p(`- layers: ${r.layers_found.slice(0, 40).join(", ")}${r.layers_found.length > 40 ? " …" : ""}`);
    p(
      `- entities: total=${r.stats.total_entities} lines=${r.stats.lines} ` +
        `polylines=${r.stats.polylines} text=${r.stats.text} dims=${r.stats.dimensions} ` +
        `circles=${r.stats.circles} blocks=${r.stats.blocks}`,
    );
    p("");
  }

  // ── Detection strategy distribution ──
  p("## Detection Strategy Distribution");
  p("");
  const tierCounts: Record<string, number> = {};
  for (const o of ok) {
    const t = o.result!.detection_strategy_used;
    tierCounts[t] = (tierCounts[t] ?? 0) + 1;
  }
  for (const [tier, n] of Object.entries(tierCounts).sort()) {
    p(`- ${tier}: ${n} file(s)`);
  }
  p("");

  // ── Downstream readiness ──
  p("## Downstream Readiness");
  p("");
  const n = ok.length || 1;
  const boq = ok.filter((o) => o.result!.downstream_ready.boq).length;
  const fw = ok.filter((o) => o.result!.downstream_ready.formwork).length;
  const shop = ok.filter((o) => o.result!.downstream_ready.shop_drawings).length;
  p(`- **BOQ-ready**: ${boq} of ${ok.length}`);
  p(`- **Formwork-ready**: ${fw} of ${ok.length}`);
  p(`- **Shop-drawing-ready**: ${shop} of ${ok.length}`);
  p("");
  p("### Missing data (per file)");
  p("");
  for (const o of ok) {
    const md = o.result!.missing_data;
    p(`- **${o.result!.filename}**: ${md.length ? md.join("; ") : "nothing flagged"}`);
  }
  p("");

  // ── Warnings ──
  p("## Warnings Encountered");
  p("");
  let anyWarn = false;
  for (const o of ok) {
    const w = o.result!.warnings;
    if (w.length) {
      anyWarn = true;
      p(`- **${o.result!.filename}**:`);
      for (const line of w) p(`  - ${line}`);
    }
  }
  for (const o of outcomes) {
    if (!o.ok) {
      anyWarn = true;
      p(`- **${o.filename}** (FAILED): ${o.error}`);
    }
  }
  if (!anyWarn) p("- none");
  p("");

  // ── Recommendation ──
  const avg =
    ok.length > 0
      ? ok.reduce((s, o) => s + o.result!.overall_confidence, 0) / ok.length
      : 0;
  p("## Honest Recommendation");
  p("");
  p(`Average overall_confidence across ${ok.length} parsed file(s): **${fmtConf(avg)}**`);
  p("");
  if (ok.length === 0) {
    p(
      "> ❌ **No files parsed successfully.** The sidecar or DXF inputs are " +
        "broken — fix transport / inputs before drawing any conclusions.",
    );
  } else if (avg > 0.7) {
    p(
      "> ✅ **Proceed to 5C-2 (PDF parsing).** Vector DXF parsing is giving " +
        "high-confidence walls + metadata; the approach is validated.",
    );
  } else if (avg > 0.5) {
    p(
      "> ⚠️ **Fix detection heuristics first.** Medium confidence — tune the " +
        "wall-detection tiers (layer regex, thickness pairing, polygon edges) " +
        "and re-run before moving to PDF.",
    );
  } else {
    p(
      "> 🔴 **Reconsider the approach.** Low confidence suggests vector parsing " +
        "alone is insufficient on these drawings — consider jumping to a " +
        "vision-first pipeline (bring 5C-3 forward).",
    );
  }
  p("");
  return lines.join("\n");
}

// ─── main ────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const dirPath = parseArg("--path") ?? defaultPath();
  const filter = parseArg("--filter") ?? "*.dxf";
  // Debug defaults ON this phase — we want the overlay PNGs.
  const debug = hasFlag("--no-debug") ? false : true;

  if (!fs.existsSync(dirPath)) {
    console.error(`${LOG} path does not exist: ${dirPath}`);
    process.exit(1);
  }

  await checkHealth();

  const re = globToRegExp(filter);
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.toLowerCase().endsWith(".dxf") && re.test(f))
    .sort();

  if (files.length === 0) {
    console.error(`${LOG} no .dxf files matching "${filter}" in ${dirPath}`);
    process.exit(1);
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  console.info(`${LOG} found ${files.length} DXF file(s) in ${dirPath}`);
  console.info("");

  const outcomes: FileOutcome[] = [];
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    try {
      const result = await parseDrawing({
        filePath,
        format: "dxf",
        debug,
        filename: file,
      });

      // Persist JSON (omit the heavy base64 PNG from the JSON; save it
      // separately as a real PNG file).
      const { debug_png_base64, ...jsonNoPng } = result;
      fs.writeFileSync(
        path.join(RESULTS_DIR, `${safeName(file)}.json`),
        JSON.stringify(jsonNoPng, null, 2),
      );
      if (debug_png_base64) {
        fs.writeFileSync(
          path.join(RESULTS_DIR, `${safeName(file)}.debug.png`),
          Buffer.from(debug_png_base64, "base64"),
        );
      }

      console.info(
        `${LOG.replace("parse-test", "parse")} ${file} type=${result.drawing_type} ` +
          `walls=${result.walls.length} junctions=${result.junctions.length} ` +
          `confidence=${fmtConf(result.overall_confidence)} ` +
          `duration=${result.duration_ms}ms boq_ready=${result.downstream_ready.boq}`,
      );
      outcomes.push({ filename: file, ok: true, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[parse] ${file} FAILED: ${msg}`);
      outcomes.push({ filename: file, ok: false, error: msg });
    }
  }

  // COMPARISON.md
  const comparison = buildComparison(outcomes);
  fs.writeFileSync(path.join(RESULTS_DIR, "COMPARISON.md"), comparison);

  // Console summary.
  const ok = outcomes.filter((o) => o.ok && o.result);
  const high = ok.filter((o) => o.result!.overall_confidence > 0.7).length;
  const med = ok.filter(
    (o) =>
      o.result!.overall_confidence >= 0.5 && o.result!.overall_confidence <= 0.7,
  ).length;
  const low = ok.filter((o) => o.result!.overall_confidence < 0.5).length;
  const avg =
    ok.length > 0
      ? ok.reduce((s, o) => s + o.result!.overall_confidence, 0) / ok.length
      : 0;
  const boq = ok.filter((o) => o.result!.downstream_ready.boq).length;
  const fw = ok.filter((o) => o.result!.downstream_ready.formwork).length;
  const shop = ok.filter((o) => o.result!.downstream_ready.shop_drawings).length;

  console.info("");
  console.info(`${LOG} tested: ${outcomes.length}`);
  console.info(`${LOG}   high confidence (>0.7): ${high}`);
  console.info(`${LOG}   medium (0.5-0.7): ${med}`);
  console.info(`${LOG}   low (<0.5): ${low}`);
  console.info(`${LOG} avg confidence: ${fmtConf(avg)}`);
  console.info(
    `${LOG} downstream readiness: BOQ=${boq}/${ok.length}, formwork=${fw}/${ok.length}, shop=${shop}/${ok.length}`,
  );
  console.info(`${LOG} results: ${path.relative(process.cwd(), RESULTS_DIR)}/`);
}

main().catch((err) => {
  console.error(`${LOG} fatal:`, err);
  process.exitCode = 1;
});
