/**
 * Populates Workflow.thumbnail for existing workflows.
 * Scans tileResults JSON from the most recent SUCCESS execution
 * per workflow, picks the first IMAGE artifact with a URL.
 *
 * Idempotent: skips workflows that already have a thumbnail.
 * Run with: npx tsx scripts/backfill-workflow-thumbnails.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const workflows = await prisma.workflow.findMany({
    where: {
      deletedAt: null,
      thumbnail: null,
    },
    select: { id: true, name: true },
  });

  console.log(`Backfilling thumbnails for ${workflows.length} workflows...`);
  let populated = 0;
  let skipped = 0;

  for (const wf of workflows) {
    const lastSuccess = await prisma.execution.findFirst({
      where: {
        workflowId: wf.id,
        status: "SUCCESS",
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
      select: { id: true, tileResults: true },
    });

    if (!lastSuccess) {
      skipped++;
      continue;
    }

    const tileResults = Array.isArray(lastSuccess.tileResults)
      ? lastSuccess.tileResults
      : [];

    let thumbUrl: string | null = null;
    for (const result of tileResults as Record<string, unknown>[]) {
      const type = (result.type as string)?.toLowerCase();
      if (type !== "image") continue;
      const data = result.data as Record<string, unknown> | undefined;
      const url =
        (data?.imageUrl as string) ??
        (data?.url as string) ??
        (data?.dataUri as string) ??
        null;
      if (url && typeof url === "string" && url.startsWith("http")) {
        thumbUrl = url;
        break;
      }
    }

    if (!thumbUrl) {
      skipped++;
      continue;
    }

    await prisma.workflow.update({
      where: { id: wf.id },
      data: { thumbnail: thumbUrl },
    });
    populated++;
    console.log(`  \u2713 ${wf.name.slice(0, 50)}`);
  }

  console.log(`Done. Populated: ${populated}, Skipped: ${skipped}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
