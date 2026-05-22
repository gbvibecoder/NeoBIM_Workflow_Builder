/**
 * One-shot migration: upgrade existing user workflows from the 6-node
 * post-alpha topology to the 11-node Beta 2 topology.
 *
 * The old topology (post-alpha, 6 or 7 nodes):
 *   IN-009 → TR-025 → TR-028 → TR-026 → TR-027 → EX-007
 *
 * The target topology (Beta 2, 11 nodes):
 *   IN-009 → TR-025 → TR-029 → [TR-028 | TR-030 | TR-031] → TR-034
 *     → TR-026 → TR-027 → TR-032 → EX-007
 *
 * Usage:
 *   npx tsx scripts/migrate-add-beta2-nodes-to-workflows.ts           # dry-run
 *   npx tsx scripts/migrate-add-beta2-nodes-to-workflows.ts --commit   # actually writes
 *
 * Idempotency: if the workflow already has ≥11 nodes including all five
 * new Beta 2 node types (TR-029, TR-030, TR-031, TR-032, TR-034), it is
 * skipped as "already up-to-date".
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

// ─── Env loading ─────────────────────────────────────────────────────────────

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    let val = trimmed.slice(eqIdx + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface TileNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    catalogueId: string;
    label: string;
    category: string;
    status: string;
    inputs: Array<{ id: string; label: string; type: string }>;
    outputs: Array<{ id: string; label: string; type: string }>;
    icon: string;
    [key: string]: unknown;
  };
}

interface TileEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  type?: string;
  [key: string]: unknown;
}

interface TileGraph {
  nodes: TileNode[];
  edges: TileEdge[];
}

// ─── Beta 2 node IDs ────────────────────────────────────────────────────────

const BETA2_NEW_CATALOGUE_IDS = new Set([
  "TR-029", "TR-030", "TR-031", "TR-032", "TR-034",
]);

/** All catalogue IDs expected in the 11-node Beta 2 template. */
const BETA2_ALL_CATALOGUE_IDS = new Set([
  "IN-009", "TR-025", "TR-029", "TR-028", "TR-030", "TR-031",
  "TR-034", "TR-026", "TR-027", "TR-032", "EX-007",
]);

// ─── Detection ───────────────────────────────────────────────────────────────

/** Check if workflow is a brief-to-ifc v3 pipeline (has IN-009 and TR-025). */
export function isBriefToIfcV3Pipeline(graph: TileGraph): boolean {
  const ids = new Set(graph.nodes.map(n => n.data.catalogueId));
  return ids.has("IN-009") && ids.has("TR-025");
}

/** Check if workflow already has all Beta 2 nodes. */
export function isAlreadyMigrated(graph: TileGraph): boolean {
  const ids = new Set(graph.nodes.map(n => n.data.catalogueId));
  for (const needed of BETA2_NEW_CATALOGUE_IDS) {
    if (!ids.has(needed)) return false;
  }
  return true;
}

// ─── Migration logic ─────────────────────────────────────────────────────────

/**
 * Build the target 11-node graph while preserving the user's brief
 * text stored in the IN-009 node.
 */
export function buildTargetGraph(currentGraph: TileGraph): TileGraph {
  if (!currentGraph?.nodes || !Array.isArray(currentGraph.nodes)) {
    throw new Error("buildTargetGraph: invalid graph — nodes array missing");
  }
  // Find the IN-009 node and preserve its data (user's brief text).
  const existingIN009 = currentGraph.nodes.find(
    n => n.data.catalogueId === "IN-009",
  );
  // Preserve user brief text from all known field names
  const briefText = existingIN009?.data?.briefText
    ?? existingIN009?.data?.value
    ?? existingIN009?.data?.text
    ?? existingIN009?.data?.content;

  // Target node positions (matching prebuilt-workflows.ts layout)
  const nodes: TileNode[] = [
    { id: "n1", type: "workflowNode", position: { x: 100, y: 300 }, data: { catalogueId: "IN-009", label: "Brief", category: "input", status: "idle", inputs: [], outputs: [{ id: "brief-out", label: "Brief Text", type: "text" }], icon: "FileText", ...(briefText !== undefined ? { briefText, value: briefText } : {}) } },
    { id: "n2", type: "workflowNode", position: { x: 400, y: 300 }, data: { catalogueId: "TR-025", label: "Brief Enricher", category: "transform", status: "idle", inputs: [{ id: "brief-in", label: "Brief Text", type: "text" }], outputs: [{ id: "spec-out", label: "BriefSpec", type: "json" }], icon: "Wand2" } },
    { id: "n3", type: "workflowNode", position: { x: 680, y: 300 }, data: { catalogueId: "TR-029", label: "Architectural Reasoner", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec (with rationale)", type: "json" }], icon: "Compass" } },
    { id: "n4a", type: "workflowNode", position: { x: 960, y: 160 }, data: { catalogueId: "TR-028", label: "Item Decomposer", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec (with parts)", type: "json" }], icon: "Wand2" } },
    { id: "n4b", type: "workflowNode", position: { x: 960, y: 300 }, data: { catalogueId: "TR-030", label: "Trim Specifier", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec (with trim)", type: "json" }], icon: "Wrench" } },
    { id: "n4c", type: "workflowNode", position: { x: 960, y: 440 }, data: { catalogueId: "TR-031", label: "Material Resolver", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec (resolved)", type: "json" }], icon: "Palette" } },
    { id: "n5", type: "workflowNode", position: { x: 1240, y: 300 }, data: { catalogueId: "TR-034", label: "Spec Validator", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec (validated)", type: "json" }], icon: "ShieldCheck" } },
    { id: "n6", type: "workflowNode", position: { x: 1520, y: 300 }, data: { catalogueId: "TR-026", label: "IFC Agent Builder", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "ifc-out", label: "IFC File", type: "ifc" }, { id: "kpi-out", label: "Stats", type: "json" }], icon: "Bot" } },
    { id: "n7", type: "workflowNode", position: { x: 1800, y: 300 }, data: { catalogueId: "TR-027", label: "Geometric Validator", category: "transform", status: "idle", inputs: [{ id: "ifc-in", label: "IFC File", type: "ifc" }], outputs: [{ id: "verdict-out", label: "Verdict", type: "json" }, { id: "ifc-out", label: "IFC File", type: "ifc" }], icon: "ShieldCheck" } },
    { id: "n8", type: "workflowNode", position: { x: 2080, y: 300 }, data: { catalogueId: "TR-032", label: "Vision Inspector", category: "transform", status: "idle", inputs: [{ id: "ifc-in", label: "IFC File", type: "ifc" }], outputs: [{ id: "report-out", label: "Quality Report", type: "json" }, { id: "ifc-out", label: "IFC File", type: "ifc" }], icon: "Eye" } },
    { id: "n9", type: "workflowNode", position: { x: 2360, y: 300 }, data: { catalogueId: "EX-007", label: "IFC Export", category: "export", status: "idle", inputs: [{ id: "ifc-in", label: "Validated IFC", type: "ifc" }], outputs: [{ id: "ifc-out", label: "IFC File", type: "ifc" }], icon: "FileBox" } },
  ];

  const edges: TileEdge[] = [
    { id: "e1-2", source: "n1", sourceHandle: "brief-out", target: "n2", targetHandle: "brief-in", type: "animatedEdge" },
    { id: "e2-3", source: "n2", sourceHandle: "spec-out", target: "n3", targetHandle: "spec-in", type: "animatedEdge" },
    { id: "e3-4a", source: "n3", sourceHandle: "spec-out", target: "n4a", targetHandle: "spec-in", type: "animatedEdge" },
    { id: "e3-4b", source: "n3", sourceHandle: "spec-out", target: "n4b", targetHandle: "spec-in", type: "animatedEdge" },
    { id: "e3-4c", source: "n3", sourceHandle: "spec-out", target: "n4c", targetHandle: "spec-in", type: "animatedEdge" },
    { id: "e4a-5", source: "n4a", sourceHandle: "spec-out", target: "n5", targetHandle: "spec-in", type: "animatedEdge" },
    { id: "e4b-5", source: "n4b", sourceHandle: "spec-out", target: "n5", targetHandle: "spec-in", type: "animatedEdge" },
    { id: "e4c-5", source: "n4c", sourceHandle: "spec-out", target: "n5", targetHandle: "spec-in", type: "animatedEdge" },
    { id: "e5-6", source: "n5", sourceHandle: "spec-out", target: "n6", targetHandle: "spec-in", type: "animatedEdge" },
    { id: "e6-7", source: "n6", sourceHandle: "ifc-out", target: "n7", targetHandle: "ifc-in", type: "animatedEdge" },
    { id: "e7-8", source: "n7", sourceHandle: "ifc-out", target: "n8", targetHandle: "ifc-in", type: "animatedEdge" },
    { id: "e8-9", source: "n8", sourceHandle: "ifc-out", target: "n9", targetHandle: "ifc-in", type: "animatedEdge" },
  ];

  return { nodes, edges };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function createPrisma(): PrismaClient {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL ?? "",
  });
  return new PrismaClient({ adapter, log: ["error", "warn"] });
}

async function main(): Promise<void> {
  const COMMIT = process.argv.includes("--commit");
  console.log(
    `\n=== Beta 2 Migration (${COMMIT ? "COMMIT" : "DRY-RUN"}) ===\n`,
  );

  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL not set. Run after deploy or provide .env.local.\n");
    console.log("--- Summary ---");
    console.log("  Total workflows scanned: 0");
    console.log(`  ${COMMIT ? "Migrated" : "Would migrate"}:         0`);
    console.log("  Already up-to-date:      0");
    console.log("  Errors:                  0");
    return;
  }

  const prisma = createPrisma();

  try {
    const workflows = await prisma.workflow.findMany({
      select: { id: true, name: true, tileGraph: true },
      where: { deletedAt: null },
    });

    let totalScanned = 0;
    let wouldMigrate = 0;
    let alreadyUpToDate = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (const wf of workflows) {
      totalScanned++;
      try {
        const graph = wf.tileGraph as unknown as TileGraph | null;
        if (!graph || !graph.nodes || !graph.edges) {
          continue; // Not a tile-graph workflow — skip silently
        }

        if (!isBriefToIfcV3Pipeline(graph)) {
          continue; // Not a brief-to-ifc-v3 workflow
        }

        if (isAlreadyMigrated(graph)) {
          alreadyUpToDate++;
          continue;
        }

        wouldMigrate++;
        const nodeCount = graph.nodes.length;
        const catalogueIds = graph.nodes.map(n => n.data.catalogueId).join(", ");
        console.log(
          `  [${COMMIT ? "MIGRATE" : "WOULD MIGRATE"}] ${wf.id} "${wf.name}" ` +
          `(${nodeCount} nodes: ${catalogueIds})`,
        );

        if (COMMIT) {
          const targetGraph = buildTargetGraph(graph);
          await prisma.workflow.update({
            where: { id: wf.id },
            data: { tileGraph: targetGraph as unknown as object },
          });
          console.log(`    -> Updated to 11-node Beta 2 topology.`);
        }
      } catch (err) {
        errors++;
        const errMsg = err instanceof Error ? err.message : String(err);
        errorDetails.push(`${wf.id} "${wf.name}": ${errMsg}`);
        console.error(`  [ERROR] ${wf.id} "${wf.name}": ${errMsg}`);
      }
    }

    console.log(`\n--- Summary ---`);
    console.log(`  Total workflows scanned: ${totalScanned}`);
    console.log(`  ${COMMIT ? "Migrated" : "Would migrate"}:         ${wouldMigrate}`);
    console.log(`  Already up-to-date:      ${alreadyUpToDate}`);
    console.log(`  Errors:                  ${errors}`);
    if (errorDetails.length > 0) {
      console.log(`\n  Error details:`);
      for (const detail of errorDetails) {
        console.log(`    - ${detail}`);
      }
    }
    console.log(``);

    await prisma.$disconnect();
  } catch (err) {
    console.error("Migration failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Only run CLI when invoked directly via `npx tsx` (not when imported by tests).
// Check process.argv for the script name — compatible with both CJS and ESM.
const isDirectRun = process.argv[1]?.includes("migrate-add-beta2-nodes-to-workflows");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
