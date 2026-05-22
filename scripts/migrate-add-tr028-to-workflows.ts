/**
 * One-shot migration: insert TR-028 (Item Decomposer) between TR-025
 * and TR-026 in existing user workflows.
 *
 * Usage:
 *   npx tsx scripts/migrate-add-tr028-to-workflows.ts           # dry-run
 *   npx tsx scripts/migrate-add-tr028-to-workflows.ts --commit   # actually writes
 *
 * The script:
 *   1. Finds all workflows where tileGraph has a TR-025 node directly
 *      connected to a TR-026 node (no TR-028 in between).
 *   2. Inserts a TR-028 node between them.
 *   3. Rewires the edge: TR-025 → TR-028 → TR-026.
 *   4. Persists via Prisma (only with --commit).
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

// Load .env.local for DATABASE_URL
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    let val = trimmed.slice(eqIdx + 1);
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function createPrisma(): PrismaClient {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL ?? "",
  });
  return new PrismaClient({ adapter, log: ["error", "warn"] });
}

const prisma = createPrisma();
const COMMIT = process.argv.includes("--commit");

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

function hasTR028(graph: TileGraph): boolean {
  return graph.nodes.some((n) => n.data.catalogueId === "TR-028");
}

function findTR025toTR026Edge(graph: TileGraph): TileEdge | null {
  const tr025NodeIds = new Set(
    graph.nodes.filter((n) => n.data.catalogueId === "TR-025").map((n) => n.id),
  );
  const tr026NodeIds = new Set(
    graph.nodes.filter((n) => n.data.catalogueId === "TR-026").map((n) => n.id),
  );

  return (
    graph.edges.find(
      (e) => tr025NodeIds.has(e.source) && tr026NodeIds.has(e.target),
    ) ?? null
  );
}

function insertTR028(graph: TileGraph, bridgeEdge: TileEdge): TileGraph {
  const tr025Node = graph.nodes.find((n) => n.id === bridgeEdge.source)!;
  const tr026Node = graph.nodes.find((n) => n.id === bridgeEdge.target)!;

  // Position TR-028 midway between TR-025 and TR-026
  const midX = Math.round((tr025Node.position.x + tr026Node.position.x) / 2);
  const midY = tr025Node.position.y;

  // Shift TR-026 and all downstream nodes right by 260px to make room
  const shiftAmount = 260;
  const tr026X = tr026Node.position.x;
  const shiftedNodes = graph.nodes.map((n) => {
    if (n.position.x >= tr026X) {
      return { ...n, position: { ...n.position, x: n.position.x + shiftAmount } };
    }
    return n;
  });

  // Create TR-028 node
  const newNodeId = `n-tr028-${Date.now()}`;
  const tr028Node: TileNode = {
    id: newNodeId,
    type: "workflowNode",
    position: { x: midX, y: midY },
    data: {
      catalogueId: "TR-028",
      label: "Item Decomposer",
      category: "transform",
      status: "idle",
      inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }],
      outputs: [{ id: "spec-out", label: "BriefSpec (with parts)", type: "json" }],
      icon: "Wand2",
    },
  };

  // New edges: TR-025 → TR-028 → TR-026
  const newEdges = graph.edges.map((e) => {
    if (e.id === bridgeEdge.id) {
      // Replace old edge: TR-025 → TR-026 becomes TR-025 → TR-028
      return {
        ...e,
        id: `e-025-028-${Date.now()}`,
        target: newNodeId,
        targetHandle: "spec-in",
      };
    }
    return e;
  });

  // Add edge: TR-028 → TR-026
  newEdges.push({
    id: `e-028-026-${Date.now()}`,
    source: newNodeId,
    sourceHandle: "spec-out",
    target: bridgeEdge.target,
    targetHandle: bridgeEdge.targetHandle,
    type: bridgeEdge.type,
  });

  return {
    nodes: [...shiftedNodes, tr028Node],
    edges: newEdges,
  };
}

async function main(): Promise<void> {
  console.log(
    `\n=== TR-028 Migration (${COMMIT ? "COMMIT" : "DRY-RUN"}) ===\n`,
  );

  // Find all workflows with tileGraph JSON
  const workflows = await prisma.workflow.findMany({
    select: { id: true, name: true, tileGraph: true },
    where: { tileGraph: { not: undefined } },
  });

  console.log(`Found ${workflows.length} workflows with tileGraph.\n`);

  let wouldMigrate = 0;
  let alreadyHasTR028 = 0;
  let noEdge = 0;

  for (const wf of workflows) {
    const graph = wf.tileGraph as unknown as TileGraph | null;
    if (!graph || !graph.nodes || !graph.edges) continue;

    if (hasTR028(graph)) {
      alreadyHasTR028++;
      continue;
    }

    const bridgeEdge = findTR025toTR026Edge(graph);
    if (!bridgeEdge) {
      noEdge++;
      continue;
    }

    wouldMigrate++;
    console.log(
      `  [${COMMIT ? "MIGRATE" : "WOULD MIGRATE"}] ${wf.id} "${wf.name}" ` +
        `— edge ${bridgeEdge.id} (${bridgeEdge.source} → ${bridgeEdge.target})`,
    );

    if (COMMIT) {
      const updated = insertTR028(graph, bridgeEdge);
      await prisma.workflow.update({
        where: { id: wf.id },
        data: { tileGraph: updated as unknown as object },
      });
      console.log(`    ✓ Updated.`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Total workflows:      ${workflows.length}`);
  console.log(`  Already has TR-028:   ${alreadyHasTR028}`);
  console.log(`  No TR-025→TR-026:     ${noEdge}`);
  console.log(`  ${COMMIT ? "Migrated" : "Would migrate"}:        ${wouldMigrate}`);
  console.log(``);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
