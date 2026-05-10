/**
 * §T backfill — populate User.planChangedAt for existing paying subscribers
 * who pre-date the field. Read-only output (prints SQL to stdout — does NOT
 * execute). Manual review + apply via psql per the runbook below.
 *
 * Run:
 *   npx tsx scripts/backfill-plan-changed-at.ts > /tmp/backfill-pca.sql
 *   # review every UPDATE statement
 *   psql $DATABASE_URL < /tmp/backfill-pca.sql
 *
 * Idempotent: skips users whose planChangedAt is already populated.
 *
 * Backfill heuristic:
 *   • If user has a stripeCurrentPeriodEnd → estimate currentPeriodStart =
 *     stripeCurrentPeriodEnd - 30 days. Use max(thatStart, monthStart).
 *   • Otherwise → fall back to user.createdAt.
 *
 * Conservative bias: when in doubt, set planChangedAt to a value that is
 * EARLIER (further in the past). That way the count window is wider and
 * we don't accidentally exclude legitimate prior-month executions.
 *
 * Rollback:
 *   UPDATE users SET plan_changed_at = NULL
 *     WHERE plan_changed_at = '2026-05-10'::date  -- adjust date as needed
 *     AND legacy_limits IS NULL;
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface UserRow {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  stripeCurrentPeriodEnd: Date | null;
  planChangedAt: Date | null;
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function estimatePlanChangedAt(u: UserRow): Date {
  const candidates: Date[] = [];

  if (u.stripeCurrentPeriodEnd) {
    // Estimated currentPeriodStart = end - 30 days.
    const startEst = new Date(
      u.stripeCurrentPeriodEnd.getTime() - 30 * 24 * 60 * 60 * 1000,
    );
    candidates.push(startEst);
  }

  candidates.push(u.createdAt);

  // Conservative: pick the EARLIEST candidate. Wider window > narrower.
  return candidates.reduce(
    (min, d) => (d.getTime() < min.getTime() ? d : min),
    candidates[0],
  );
}

function buildUpdate(user: UserRow, value: Date): string {
  return [
    `-- ${user.email} (${user.role}, joined ${user.createdAt.toISOString().slice(0, 10)})`,
    `UPDATE users SET plan_changed_at = '${value.toISOString()}'::timestamptz`,
    ` WHERE id = '${escapeSqlString(user.id)}' AND plan_changed_at IS NULL;`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const candidates = await prisma.user.findMany({
    where: {
      role: { in: ["MINI", "STARTER", "PRO", "TEAM_ADMIN"] },
      planChangedAt: null,
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      stripeCurrentPeriodEnd: true,
      planChangedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const breakdown: Record<string, number> = {
    MINI: 0,
    STARTER: 0,
    PRO: 0,
    TEAM_ADMIN: 0,
    SKIPPED: 0,
  };
  const lines: string[] = [
    `-- §T planChangedAt backfill — generated ${new Date().toISOString()}`,
    "-- Inspect every UPDATE before piping into psql.",
    "",
    "BEGIN;",
    "",
  ];

  for (const u of candidates) {
    if (u.planChangedAt) {
      breakdown.SKIPPED += 1;
      continue;
    }
    const value = estimatePlanChangedAt(u);
    breakdown[u.role] = (breakdown[u.role] ?? 0) + 1;
    lines.push(buildUpdate(u, value));
  }

  lines.push("COMMIT;");
  lines.push("");
  lines.push("-- ─── Summary ──────────────────────────────────────────────────");
  lines.push(`-- MINI:       ${breakdown.MINI}`);
  lines.push(`-- STARTER:    ${breakdown.STARTER}`);
  lines.push(`-- PRO:        ${breakdown.PRO}`);
  lines.push(`-- TEAM_ADMIN: ${breakdown.TEAM_ADMIN}`);
  lines.push(`-- SKIPPED:    ${breakdown.SKIPPED} (already populated)`);
  lines.push(`-- TOTAL:      ${candidates.length}`);
  lines.push("");
  lines.push("-- Verify after apply:");
  lines.push("--   SELECT id, email, role, plan_changed_at FROM users WHERE plan_changed_at IS NOT NULL;");
  lines.push("");
  lines.push("-- Rollback (if needed):");
  lines.push("--   UPDATE users SET plan_changed_at = NULL WHERE plan_changed_at IS NOT NULL;");
  lines.push("");

  process.stdout.write(lines.join("\n"));
}

main()
  .catch((err) => {
    console.error("[backfill-plan-changed-at] failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
