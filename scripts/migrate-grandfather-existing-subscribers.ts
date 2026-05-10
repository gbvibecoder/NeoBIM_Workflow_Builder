/**
 * 1:1 cutover grandfathering migration — preview script (READ-ONLY OUTPUT).
 *
 * Run: npx tsx scripts/migrate-grandfather-existing-subscribers.ts
 *
 * Behavior:
 *   1. Finds all paying subscribers (MINI/STARTER/PRO/TEAM) created before
 *      the cutover date who DO NOT yet have legacyLimits.runsPerMonth set.
 *   2. Builds an UPDATE statement per user that snapshots their PRE-cutover
 *      plan limits onto User.legacyLimits, so the helper's getEffectiveLimits
 *      grandfathers them at their old caps.
 *   3. Prints all UPDATE statements to stdout. **Does NOT execute.**
 *   4. Prints a summary (per-plan counts) and a runbook footer.
 *
 * Run manually after review:
 *   npx tsx scripts/migrate-grandfather-existing-subscribers.ts > /tmp/migration.sql
 *   psql $DATABASE_URL < /tmp/migration.sql
 *
 * Rollback:
 *   UPDATE users SET legacy_limits = NULL, legacy_limits_set_at = NULL
 *     WHERE legacy_limits->>'reason' = 'pre-1:1-spec migration 2026-05-10';
 *
 * Idempotent: skips users whose legacyLimits.runsPerMonth is already populated.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Cutover timestamp — paying subscribers created BEFORE this point are
// grandfathered. Update if you re-deploy.
const CUTOVER = new Date("2026-05-10T00:00:00Z");
const REASON = "pre-1:1-spec migration 2026-05-10";

// Pre-cutover plan limits — the values these users signed up / paid under.
// Mirror src/features/billing/lib/plan-data.ts AS IT WAS BEFORE this PR.
const PRE_CUTOVER_LIMITS: Record<string, { runsPerMonth: number; maxWorkflows: number }> = {
  MINI:    { runsPerMonth: 6,   maxWorkflows: 3 },
  STARTER: { runsPerMonth: 30,  maxWorkflows: 15 },
  PRO:     { runsPerMonth: 100, maxWorkflows: 45 },
  TEAM:    { runsPerMonth: 300, maxWorkflows: -1 }, // -1 = unlimited (legacy)
};

interface UserRow {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  legacyLimits: unknown;
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function buildUpdate(user: UserRow, snapshot: typeof PRE_CUTOVER_LIMITS[string]): string {
  const json = JSON.stringify({
    runsPerMonth: snapshot.runsPerMonth,
    maxWorkflows: snapshot.maxWorkflows,
    grandfatheredAt: CUTOVER.toISOString().slice(0, 10),
    reason: REASON,
  });
  // Comment includes user email + role for human review of the SQL output.
  return [
    `-- ${user.email} (${user.role}, joined ${user.createdAt.toISOString().slice(0, 10)})`,
    `UPDATE users SET legacy_limits = '${escapeSqlString(json)}'::jsonb,`,
    `                 legacy_limits_set_at = NOW()`,
    ` WHERE id = '${escapeSqlString(user.id)}'`,
    `   AND (legacy_limits IS NULL OR NOT (legacy_limits ? 'runsPerMonth'));`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const candidates = await prisma.user.findMany({
    where: {
      role: { in: ["MINI", "STARTER", "PRO"] },
      // TEAM is treated separately because TEAM users are typically explicitly
      // contracted; reaching out manually is preferable. Comment in/out as needed.
      createdAt: { lt: CUTOVER },
    },
    select: { id: true, email: true, role: true, createdAt: true, legacyLimits: true },
    orderBy: { createdAt: "asc" },
  });

  const breakdown: Record<string, number> = { MINI: 0, STARTER: 0, PRO: 0, SKIPPED: 0 };
  const lines: string[] = [
    `-- 1:1 cutover grandfathering migration — generated ${new Date().toISOString()}`,
    `-- Cutover: ${CUTOVER.toISOString()}`,
    "-- Inspect every UPDATE statement before piping into psql.",
    "",
    "BEGIN;",
    "",
  ];

  for (const u of candidates) {
    // Skip users whose legacyLimits already includes runsPerMonth (idempotent).
    const ll = u.legacyLimits as { runsPerMonth?: number } | null;
    if (ll && typeof ll.runsPerMonth === "number") {
      breakdown.SKIPPED += 1;
      continue;
    }
    const snapshot = PRE_CUTOVER_LIMITS[u.role];
    if (!snapshot) {
      breakdown.SKIPPED += 1;
      continue;
    }
    breakdown[u.role] = (breakdown[u.role] ?? 0) + 1;
    lines.push(buildUpdate(u, snapshot));
  }

  lines.push("COMMIT;");
  lines.push("");
  lines.push("-- ─── Summary ──────────────────────────────────────────────────");
  lines.push(`-- MINI:    ${breakdown.MINI}`);
  lines.push(`-- STARTER: ${breakdown.STARTER}`);
  lines.push(`-- PRO:     ${breakdown.PRO}`);
  lines.push(`-- SKIPPED: ${breakdown.SKIPPED} (already grandfathered or unknown role)`);
  lines.push(`-- TOTAL:   ${candidates.length}`);
  lines.push("");
  lines.push("-- ─── Runbook ──────────────────────────────────────────────────");
  lines.push("-- 1. Review every UPDATE above (one per user, by email).");
  lines.push("-- 2. Save to file:  npx tsx scripts/migrate-grandfather-existing-subscribers.ts > /tmp/migration.sql");
  lines.push("-- 3. Apply:         psql $DATABASE_URL < /tmp/migration.sql");
  lines.push("-- 4. Verify:        SELECT id, email, role, legacy_limits->>'reason' FROM users WHERE legacy_limits->>'reason' = '" + REASON + "';");
  lines.push("-- 5. Rollback (if needed):");
  lines.push("--    UPDATE users SET legacy_limits = NULL, legacy_limits_set_at = NULL");
  lines.push("--      WHERE legacy_limits->>'reason' = '" + REASON + "';");
  lines.push("");

  // Print to stdout — no DB writes from this script.
  process.stdout.write(lines.join("\n"));
}

main()
  .catch((err) => {
    console.error("[migrate-grandfather-existing-subscribers] failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
