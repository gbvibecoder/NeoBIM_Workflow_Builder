/**
 * Direct-generator CLI — bypasses HTTP / auth / DB / Pusher / QStash.
 *
 * Takes a raw brief text, runs Layer 1 enrichment + Layer 2 agent loop
 * in-process, fetches the resulting IFC from R2, saves all artifacts
 * to disk. This is the permanent autonomous-testing capability promised
 * in V7_FULL_FLEDGE_VERIFICATION (no cookie, no manual gate).
 *
 * Usage:
 *   IFC_SERVICE_API_KEY=$(cat /tmp/.bf_ifc_key) \
 *   npx tsx scripts/forensics/run-brief-direct.ts \
 *     --brief <path/to/brief.txt> \
 *     --out-dir <path/to/output-dir/> \
 *     --label <unique-name>
 *
 * Required env (loaded from .env.local + process.env):
 *   • ANTHROPIC_API_KEY      — enrichBrief + agent loop
 *   • IFC_SERVICE_URL        — Railway Python sandbox URL
 *   • IFC_SERVICE_API_KEY    — Bearer token for the sandbox
 *
 * Output (one set per `--label`):
 *   <out-dir>/<label>-briefspec.json     — Layer 1 BriefSpec snapshot
 *   <out-dir>/<label>-agent-turns.json   — per-turn agent trace
 *   <out-dir>/<label>-summary.json       — top-level run metrics
 *   <out-dir>/<label>.ifc                — final IFC2X3 file bytes
 */

import { config as loadDotenv } from "dotenv";
import path from "node:path";
import fs from "node:fs/promises";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local") });

// Bridge the CLI-supplied key into process.env BEFORE the v3 modules
// import their env-aware factories. The sandbox-client reads
// process.env.IFC_SERVICE_API_KEY at call time, so setting it here
// (after dotenv but before the dynamic imports below) is sufficient.
if (process.env.BUILDFLOW_IFC_KEY_FILE) {
  const fileKey = require("node:fs")
    .readFileSync(process.env.BUILDFLOW_IFC_KEY_FILE, "utf-8")
    .trim();
  if (fileKey) process.env.IFC_SERVICE_API_KEY = fileKey;
}

type ProjectType = "exhibition_booth" | "office" | "residential" | "retail";

interface CliArgs {
  briefPath: string;
  outDir: string;
  label: string;
  maxTurns?: number;
  costCapUsd?: number;
  projectType?: ProjectType;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const briefPath = get("--brief");
  const outDir = get("--out-dir");
  const label = get("--label");
  if (!briefPath || !outDir || !label) {
    process.stderr.write(
      "usage: run-brief-direct.ts --brief <txt> --out-dir <dir> --label <name> " +
        "[--max-turns 25] [--cost-cap 2.5]\n",
    );
    process.exit(2);
  }
  const maxTurnsRaw = get("--max-turns");
  const costCapRaw = get("--cost-cap");
  const projectTypeRaw = get("--project-type");
  const projectType =
    projectTypeRaw &&
    ["exhibition_booth", "office", "residential", "retail"].includes(projectTypeRaw)
      ? (projectTypeRaw as ProjectType)
      : undefined;
  return {
    briefPath,
    outDir,
    label,
    maxTurns: maxTurnsRaw ? parseInt(maxTurnsRaw, 10) : undefined,
    costCapUsd: costCapRaw ? parseFloat(costCapRaw) : undefined,
    projectType,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();

  for (const key of ["ANTHROPIC_API_KEY", "IFC_SERVICE_URL", "IFC_SERVICE_API_KEY"]) {
    if (!process.env[key]) {
      process.stderr.write(`missing required env: ${key}\n`);
      process.exit(3);
    }
  }

  await fs.mkdir(args.outDir, { recursive: true });
  const briefText = (await fs.readFile(args.briefPath, "utf-8")).trim();
  process.stdout.write(
    `→ ${args.label}: ${briefText.length} chars · ${args.briefPath}\n`,
  );

  // Late-import the v3 modules so dotenv has primed process.env first.
  const { enrichBrief } = await import("@/features/brief-to-ifc/v3/brief-enrichment");
  const { runGenerator } = await import("@/features/brief-to-ifc/v3/generator/driver");

  // ─── Layer 1 ──────────────────────────────────────────────────────
  const layer1Start = Date.now();
  process.stdout.write(`  Layer 1 (enrichBrief)…\n`);
  const enrich = await enrichBrief({
    brief: briefText,
    ...(args.projectType ? { projectType: args.projectType } : {}),
  });
  const layer1Ms = Date.now() - layer1Start;
  if (!enrich.ok || !enrich.brief) {
    const summary = {
      label: args.label,
      ok: false,
      stage: "ENRICHMENT",
      error: enrich.error,
      durationMs: layer1Ms,
      costUsd: enrich.costUsd,
    };
    await fs.writeFile(
      path.join(args.outDir, `${args.label}-summary.json`),
      JSON.stringify(summary, null, 2),
    );
    process.stderr.write(
      `  ✗ enrichment failed (${layer1Ms}ms): ${enrich.error?.code} — ${enrich.error?.message}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `  ✓ Layer 1 done · ${layer1Ms}ms · $${enrich.costUsd.toFixed(4)}\n`,
  );
  await fs.writeFile(
    path.join(args.outDir, `${args.label}-briefspec.json`),
    JSON.stringify(enrich.brief, null, 2),
  );

  // ─── Layer 2 ──────────────────────────────────────────────────────
  const layer2Start = Date.now();
  process.stdout.write(`  Layer 2 (runGenerator)…\n`);
  const turnRecords: unknown[] = [];
  const result = await runGenerator({
    brief: enrich.brief,
    maxTurns: args.maxTurns,
    costCapUsd: args.costCapUsd,
    onTurn: (r) => {
      turnRecords.push(r);
      process.stdout.write(
        `    turn ${r.turn}: ${r.toolName ?? "(none)"} (${r.toolDurationMs}ms) ` +
          `${r.toolOk ? "OK" : "FAIL"}${r.toolErrorType ? ` ${r.toolErrorType}` : ""}\n`,
      );
    },
  });
  const layer2Ms = Date.now() - layer2Start;

  await fs.writeFile(
    path.join(args.outDir, `${args.label}-agent-turns.json`),
    JSON.stringify({
      turns: turnRecords,
      ledger: result.ledger,
      finalValidation: result.finalValidation,
    }, null, 2),
  );

  if (!result.ok) {
    const summary = {
      label: args.label,
      ok: false,
      stage: "GENERATOR",
      error: result.error,
      layer1Ms,
      layer2Ms,
      totalCostUsd: enrich.costUsd + result.costUsd,
      turns: result.turns,
    };
    await fs.writeFile(
      path.join(args.outDir, `${args.label}-summary.json`),
      JSON.stringify(summary, null, 2),
    );
    process.stderr.write(
      `  ✗ generator failed (${layer2Ms}ms, ${result.turns} turns): ` +
        `${result.error?.code} — ${result.error?.message}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `  ✓ Layer 2 done · ${layer2Ms}ms · ${result.turns} turns · ` +
      `$${result.costUsd.toFixed(4)} · ${result.entityCount} entities\n`,
  );

  // ─── Fetch IFC bytes from R2 ──────────────────────────────────────
  if (!result.ifcUrl) {
    process.stderr.write(`  ✗ generator returned no ifcUrl\n`);
    process.exit(1);
  }
  process.stdout.write(`  ⬇ downloading IFC…\n`);
  const ifcRes = await fetch(result.ifcUrl, {
    headers: { "User-Agent": "buildflow-forensics/1.0" },
  });
  if (!ifcRes.ok) {
    process.stderr.write(`  ✗ IFC fetch failed: HTTP ${ifcRes.status}\n`);
    process.exit(1);
  }
  const ifcBytes = Buffer.from(await ifcRes.arrayBuffer());
  const ifcPath = path.join(args.outDir, `${args.label}.ifc`);
  await fs.writeFile(ifcPath, ifcBytes);
  process.stdout.write(`  ✓ saved ${ifcPath} (${ifcBytes.length} bytes)\n`);

  // ─── Summary ──────────────────────────────────────────────────────
  const summary = {
    label: args.label,
    ok: true,
    layer1Ms,
    layer2Ms,
    totalDurationMs: layer1Ms + layer2Ms,
    enrichmentCostUsd: enrich.costUsd,
    generatorCostUsd: result.costUsd,
    totalCostUsd: enrich.costUsd + result.costUsd,
    turns: result.turns,
    entityCount: result.entityCount,
    ifcUrl: result.ifcUrl,
    ifcPath,
    ifcSizeBytes: ifcBytes.length,
    siteBoundsM: enrich.brief.site?.bounds_m,
    spaceCount: enrich.brief.spaces.length,
    elementCount: enrich.brief.elements.length,
    irregularPolygons: enrich.brief.spaces
      .filter((s) => Array.isArray(s.polygon_world_m) && s.polygon_world_m.length > 4)
      .map((s) => ({ id: s.id, vertexCount: s.polygon_world_m!.length })),
    doorElementCount: enrich.brief.elements.filter((e) => e.type === "door").length,
    windowElementCount: enrich.brief.elements.filter((e) => e.type === "window").length,
    finalValidation: result.finalValidation
      ? {
          refsResolve: result.finalValidation.refs_resolve,
          asciiOnly: result.finalValidation.ascii_only,
          worldBboxVerdict: result.finalValidation.world_bbox?.verdict ?? null,
          worldBboxExtent: result.finalValidation.world_bbox?.actual_extent ?? null,
          spacesPresent: result.finalValidation.spaces_present.length,
          spacesMissing: result.finalValidation.spaces_missing.length,
          originCollapsed: result.finalValidation.origin_collapse?.collapsed ?? false,
        }
      : null,
  };
  await fs.writeFile(
    path.join(args.outDir, `${args.label}-summary.json`),
    JSON.stringify(summary, null, 2),
  );

  process.stdout.write(
    `\n✓ ${args.label}: ${result.entityCount} entities · ` +
      `bbox ${summary.finalValidation?.worldBboxExtent ?? "n/a"} · ` +
      `${(summary.totalDurationMs / 1000).toFixed(1)}s · ` +
      `$${summary.totalCostUsd.toFixed(4)}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
