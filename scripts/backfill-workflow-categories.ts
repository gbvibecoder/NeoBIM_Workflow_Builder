/**
 * Populates Workflow.category from name heuristic.
 * Same logic as resolveCategory() but writes to the database.
 *
 * Idempotent: skips workflows that already have category set.
 * Run with: npx tsx scripts/backfill-workflow-categories.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function inferCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("pdf") || n.includes("report") || n.includes("document")) return "pdf";
  if (n.includes("floor plan") || n.includes("floorplan") || n.includes("2d")) return "floorplan";
  if (n.includes("render") || n.includes("concept") || n.includes("image")) return "render";
  if (n.includes("full pipeline") || n.includes("complete")) return "pipeline";
  if (n.includes("3d") || n.includes("massing") || n.includes("model")) return "3d";
  return "custom";
}

async function main() {
  const workflows = await prisma.workflow.findMany({
    where: {
      deletedAt: null,
      category: null,
    },
    select: { id: true, name: true },
  });

  console.log(`Backfilling category for ${workflows.length} workflows...`);

  const stats: Record<string, number> = {};
  for (const wf of workflows) {
    const cat = inferCategory(wf.name);
    stats[cat] = (stats[cat] ?? 0) + 1;
    await prisma.workflow.update({
      where: { id: wf.id },
      data: { category: cat },
    });
  }

  console.log("Distribution:", stats);
  console.log("Done.");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
