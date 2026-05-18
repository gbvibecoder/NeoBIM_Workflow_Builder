/**
 * One-shot migration: upgrade existing user workflows from the 11-node
 * Beta 2 topology to the 13-node Beta 3 topology (adds TR-035 + TR-033).
 *
 * Usage:
 *   npx tsx scripts/migrate-add-beta3-nodes-to-workflows.ts           # dry-run
 *   npx tsx scripts/migrate-add-beta3-nodes-to-workflows.ts --commit   # writes
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

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

interface TileNode { id: string; type: string; position: { x: number; y: number }; data: { catalogueId: string; label: string; category: string; status: string; inputs: Array<{ id: string; label: string; type: string }>; outputs: Array<{ id: string; label: string; type: string }>; icon: string; [key: string]: unknown } }
interface TileEdge { id: string; source: string; sourceHandle: string; target: string; targetHandle: string; type?: string; [key: string]: unknown }
interface TileGraph { nodes: TileNode[]; edges: TileEdge[] }

const BETA3_NODE_IDS = new Set(["TR-033", "TR-035"]);

export function isBriefToIfcV3Pipeline(graph: TileGraph): boolean {
  const ids = new Set(graph.nodes.map(n => n.data.catalogueId));
  return ids.has("IN-009") && ids.has("TR-025") && ids.has("TR-026");
}

export function isAlreadyMigrated(graph: TileGraph): boolean {
  const ids = new Set(graph.nodes.map(n => n.data.catalogueId));
  return ids.has("TR-033") && ids.has("TR-035");
}

export function buildBeta3Graph(currentGraph: TileGraph): TileGraph {
  if (!currentGraph?.nodes || !Array.isArray(currentGraph.nodes)) {
    throw new Error("buildBeta3Graph: invalid graph — nodes array missing");
  }
  const existingIN009 = currentGraph.nodes.find(n => n.data.catalogueId === "IN-009");
  const briefText = existingIN009?.data?.briefText ?? existingIN009?.data?.value ?? existingIN009?.data?.text ?? existingIN009?.data?.content;

  // Use the same 13-node template from prebuilt-workflows.ts
  const nodes: TileNode[] = [
    { id: "n1", type: "workflowNode", position: { x: 100, y: 300 }, data: { catalogueId: "IN-009", label: "Brief", category: "input", status: "idle", inputs: [], outputs: [{ id: "brief-out", label: "Brief Text", type: "text" }], icon: "FileText", ...(briefText !== undefined ? { briefText, value: briefText } : {}) } },
    { id: "n2", type: "workflowNode", position: { x: 400, y: 300 }, data: { catalogueId: "TR-025", label: "Brief Enricher", category: "transform", status: "idle", inputs: [{ id: "brief-in", label: "Brief Text", type: "text" }], outputs: [{ id: "spec-out", label: "BriefSpec", type: "json" }], icon: "Wand2" } },
    { id: "n3", type: "workflowNode", position: { x: 680, y: 300 }, data: { catalogueId: "TR-029", label: "Architectural Reasoner", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec (with rationale)", type: "json" }], icon: "Compass" } },
    { id: "n4a", type: "workflowNode", position: { x: 960, y: 160 }, data: { catalogueId: "TR-028", label: "Item Decomposer", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec (with parts)", type: "json" }], icon: "Wand2" } },
    { id: "n4b", type: "workflowNode", position: { x: 960, y: 300 }, data: { catalogueId: "TR-030", label: "Trim Specifier", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec (with trim)", type: "json" }], icon: "Wrench" } },
    { id: "n4c", type: "workflowNode", position: { x: 960, y: 440 }, data: { catalogueId: "TR-031", label: "Material Resolver", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec (resolved)", type: "json" }], icon: "Palette" } },
    { id: "n5", type: "workflowNode", position: { x: 1240, y: 300 }, data: { catalogueId: "TR-034", label: "Spec Validator", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec (validated)", type: "json" }], icon: "ShieldCheck" } },
    { id: "n6", type: "workflowNode", position: { x: 1520, y: 300 }, data: { catalogueId: "TR-026", label: "IFC Agent Builder", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "ifc-out", label: "IFC File", type: "ifc" }, { id: "kpi-out", label: "Stats", type: "json" }], icon: "Bot" } },
    { id: "n6b", type: "workflowNode", position: { x: 1660, y: 300 }, data: { catalogueId: "TR-035", label: "Hard Verifier", category: "transform", status: "idle", inputs: [{ id: "ifc-in", label: "IFC File", type: "ifc" }], outputs: [{ id: "report-out", label: "Verifier Report", type: "json" }, { id: "ifc-out", label: "IFC File", type: "ifc" }], icon: "ShieldCheck" } },
    { id: "n7", type: "workflowNode", position: { x: 1800, y: 300 }, data: { catalogueId: "TR-027", label: "Geometric Validator", category: "transform", status: "idle", inputs: [{ id: "ifc-in", label: "IFC File", type: "ifc" }], outputs: [{ id: "verdict-out", label: "Verdict", type: "json" }, { id: "ifc-out", label: "IFC File", type: "ifc" }], icon: "ShieldCheck" } },
    { id: "n8", type: "workflowNode", position: { x: 2080, y: 300 }, data: { catalogueId: "TR-032", label: "Vision Inspector", category: "transform", status: "idle", inputs: [{ id: "ifc-in", label: "IFC File", type: "ifc" }], outputs: [{ id: "report-out", label: "Quality Report", type: "json" }, { id: "ifc-out", label: "IFC File", type: "ifc" }], icon: "Eye" } },
    { id: "n8b", type: "workflowNode", position: { x: 2220, y: 300 }, data: { catalogueId: "TR-033", label: "Spec Patcher", category: "transform", status: "idle", inputs: [{ id: "report-in", label: "Reports", type: "json" }], outputs: [{ id: "spec-out", label: "Patched Spec", type: "json" }, { id: "ifc-out", label: "Best IFC", type: "ifc" }], icon: "Wrench" } },
    { id: "n9", type: "workflowNode", position: { x: 2400, y: 300 }, data: { catalogueId: "EX-007", label: "IFC Export", category: "export", status: "idle", inputs: [{ id: "ifc-in", label: "Validated IFC", type: "ifc" }], outputs: [{ id: "ifc-out", label: "IFC File", type: "ifc" }], icon: "FileBox" } },
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
    { id: "e6-6b", source: "n6", sourceHandle: "ifc-out", target: "n6b", targetHandle: "ifc-in", type: "animatedEdge" },
    { id: "e6b-7", source: "n6b", sourceHandle: "ifc-out", target: "n7", targetHandle: "ifc-in", type: "animatedEdge" },
    { id: "e7-8", source: "n7", sourceHandle: "ifc-out", target: "n8", targetHandle: "ifc-in", type: "animatedEdge" },
    { id: "e8-8b", source: "n8", sourceHandle: "ifc-out", target: "n8b", targetHandle: "report-in", type: "animatedEdge" },
    { id: "e8b-9", source: "n8b", sourceHandle: "ifc-out", target: "n9", targetHandle: "ifc-in", type: "animatedEdge" },
  ];
  return { nodes, edges };
}

async function main(): Promise<void> {
  const COMMIT = process.argv.includes("--commit");
  console.log(`\n=== Beta 3 Migration (${COMMIT ? "COMMIT" : "DRY-RUN"}) ===\n`);

  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL not set.\n");
    console.log("--- Summary ---");
    console.log("  Total workflows scanned: 0");
    console.log(`  ${COMMIT ? "Migrated" : "Would migrate"}:         0`);
    console.log("  Already up-to-date:      0");
    console.log("  Errors:                  0");
    return;
  }

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL ?? "" });
  const prisma = new PrismaClient({ adapter, log: ["error", "warn"] });

  try {
    const workflows = await prisma.workflow.findMany({
      select: { id: true, name: true, tileGraph: true },
      where: { deletedAt: null },
    });

    let totalScanned = 0, wouldMigrate = 0, alreadyUpToDate = 0, errors = 0;

    for (const wf of workflows) {
      totalScanned++;
      try {
        const graph = wf.tileGraph as unknown as TileGraph | null;
        if (!graph?.nodes?.length) continue;
        if (!isBriefToIfcV3Pipeline(graph)) continue;

        if (isAlreadyMigrated(graph)) {
          alreadyUpToDate++;
          continue;
        }

        wouldMigrate++;
        console.log(`  [${COMMIT ? "MIGRATE" : "WOULD MIGRATE"}] ${wf.id} "${wf.name}" (${graph.nodes.length} nodes)`);

        if (COMMIT) {
          const target = buildBeta3Graph(graph);
          await prisma.workflow.update({ where: { id: wf.id }, data: { tileGraph: target as unknown as object } });
          console.log("    -> Updated to 13-node Beta 3 topology.");
        }
      } catch (err) {
        errors++;
        console.error(`  [ERROR] ${wf.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    console.log(`\n--- Summary ---`);
    console.log(`  Total workflows scanned: ${totalScanned}`);
    console.log(`  ${COMMIT ? "Migrated" : "Would migrate"}:         ${wouldMigrate}`);
    console.log(`  Already up-to-date:      ${alreadyUpToDate}`);
    console.log(`  Errors:                  ${errors}\n`);

    await prisma.$disconnect();
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]?.includes("migrate-add-beta3-nodes-to-workflows");
if (isDirectRun) {
  main().catch((err) => { console.error("Migration failed:", err); process.exit(1); });
}
