/**
 * Cost query — reads BriefToIfcV3Run rows from the last 30 days,
 * computes per-run cost statistics from the `ledger` JSON column.
 *
 * Usage:
 *   npx tsx scripts/cost-query.ts
 *
 * WARNING: Uses DATABASE_URL from .env.local. If that points to
 * production, review the output carefully and do not commit it.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

interface LedgerEntry {
  turn: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
}

async function main(): Promise<void> {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL ?? "",
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const runs = await prisma.briefToIfcV3Run.findMany({
      where: {
        status: "COMPLETED",
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        id: true,
        generatorCostUsd: true,
        enrichmentCostUsd: true,
        ledger: true,
        turns: true,
        entityCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (runs.length === 0) {
      console.log("No completed BriefToIfcV3Run rows in the last 30 days.");
      return;
    }

    // Compute per-run total cost from ledger entries
    const costs: number[] = runs.map((run) => {
      const ledger = run.ledger as LedgerEntry[] | null;
      if (Array.isArray(ledger) && ledger.length > 0) {
        return ledger.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0)
          + (run.enrichmentCostUsd ?? 0);
      }
      // Fallback to the stored generatorCostUsd + enrichmentCostUsd
      return (run.generatorCostUsd ?? 0) + (run.enrichmentCostUsd ?? 0);
    });

    costs.sort((a, b) => a - b);

    const mean = costs.reduce((s, c) => s + c, 0) / costs.length;
    const median = costs.length % 2 === 0
      ? (costs[costs.length / 2 - 1] + costs[costs.length / 2]) / 2
      : costs[Math.floor(costs.length / 2)];
    const p95Idx = Math.min(Math.ceil(costs.length * 0.95) - 1, costs.length - 1);
    const p95 = costs[p95Idx];
    const max = costs[costs.length - 1];

    // Distribution buckets
    const buckets = [
      { label: "<$0.10", min: 0, max: 0.10 },
      { label: "$0.10-0.25", min: 0.10, max: 0.25 },
      { label: "$0.25-0.50", min: 0.25, max: 0.50 },
      { label: "$0.50-1.00", min: 0.50, max: 1.00 },
      { label: "$1.00-2.00", min: 1.00, max: 2.00 },
      { label: "$2.00+", min: 2.00, max: Infinity },
    ];
    const distribution = buckets.map((b) => ({
      label: b.label,
      count: costs.filter((c) => c >= b.min && c < b.max).length,
    }));

    console.log("=== BriefToIfcV3Run Cost Analysis (last 30 days) ===\n");
    console.log(`  Runs in last 30d: ${costs.length}`);
    console.log(`  Mean cost/run:    $${mean.toFixed(4)}`);
    console.log(`  Median:           $${median.toFixed(4)}`);
    console.log(`  P95:              $${p95.toFixed(4)}`);
    console.log(`  Max:              $${max.toFixed(4)}`);
    console.log("\n  Distribution:");
    for (const d of distribution) {
      const bar = "#".repeat(Math.min(d.count, 40));
      console.log(`    ${d.label.padEnd(12)} ${String(d.count).padStart(3)} ${bar}`);
    }

    // Per-run detail
    console.log("\n  Per-run detail (most recent first):");
    console.log(
      "  " +
        "ID".padEnd(28) +
        "Cost".padStart(10) +
        "Turns".padStart(8) +
        "Entities".padStart(10) +
        "  Date",
    );
    for (let i = 0; i < Math.min(runs.length, 20); i++) {
      const run = runs[i];
      const cost = costs[costs.length - 1 - i]; // runs are desc, costs are asc
      console.log(
        "  " +
          run.id.padEnd(28) +
          `$${(cost ?? 0).toFixed(4)}`.padStart(10) +
          String(run.turns).padStart(8) +
          String(run.entityCount ?? 0).padStart(10) +
          `  ${run.createdAt.toISOString().slice(0, 10)}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Cost query failed:", err);
  process.exit(1);
});
