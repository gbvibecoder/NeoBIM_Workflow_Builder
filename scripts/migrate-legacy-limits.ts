/**
 * Pricing migration — snapshot old plan limits as legacyLimits on every user.
 *
 * Run: npx tsx scripts/migrate-legacy-limits.ts [--dry-run]
 *
 * Idempotent: skips users that already have legacyLimits set.
 * Rollback: UPDATE users SET legacy_limits = NULL, legacy_limits_set_at = NULL;
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

// Snapshot of STRIPE_PLANS limits BEFORE the pricing migration.
// These are the values users signed up under and should keep.
const OLD_LIMITS: Record<string, Record<string, number | boolean>> = {
  FREE: {
    runsPerMonth: 3,
    maxWorkflows: 3,
    maxNodesPerWorkflow: 10,
    videoPerMonth: 0,
    modelsPerMonth: 0,
    rendersPerMonth: 1,
    floorPlansPerMonth: 1,
    briefRendersPerMonth: 1,
  },
  MINI: {
    runsPerMonth: 10,
    maxWorkflows: 10,
    maxNodesPerWorkflow: 15,
    videoPerMonth: 0,
    modelsPerMonth: 0,
    rendersPerMonth: 3,
    floorPlansPerMonth: 1,
    briefRendersPerMonth: 2,
  },
  STARTER: {
    runsPerMonth: 30,
    maxWorkflows: 30,
    maxNodesPerWorkflow: 25,
    videoPerMonth: 3,
    modelsPerMonth: 3,
    rendersPerMonth: 10,
    floorPlansPerMonth: 5,
    briefRendersPerMonth: 5,
  },
  PRO: {
    runsPerMonth: 100,
    maxWorkflows: 100,
    maxNodesPerWorkflow: -1,
    videoPerMonth: 7,
    modelsPerMonth: 10,
    rendersPerMonth: 30,
    floorPlansPerMonth: 15,
    briefRendersPerMonth: 20,
  },
  TEAM: {
    runsPerMonth: -1,
    maxWorkflows: -1,
    maxNodesPerWorkflow: -1,
    teamMembers: 5,
    videoPerMonth: 15,
    modelsPerMonth: 30,
    rendersPerMonth: -1,
    floorPlansPerMonth: -1,
    briefRendersPerMonth: -1,
  },
};

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");

  const users = await prisma.user.findMany({
    where: { legacyLimits: { equals: null } },
    select: { id: true, email: true, role: true },
  });

  console.log(`Found ${users.length} users without legacyLimits.`);

  let migrated = 0;
  let skipped = 0;

  for (const user of users) {
    const roleKey = user.role === "TEAM_ADMIN" || user.role === "PLATFORM_ADMIN" ? "TEAM" : user.role;
    const oldLimits = OLD_LIMITS[roleKey];

    if (!oldLimits) {
      console.warn(`  SKIP: user ${user.id} (${user.email}) — unknown role: ${user.role}`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [dry] Would set legacyLimits for ${user.email} (${user.role}) → ${JSON.stringify(oldLimits)}`);
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          legacyLimits: oldLimits,
          legacyLimitsSetAt: new Date(),
        },
      });
    }
    migrated++;

    if (migrated % 100 === 0) {
      console.log(`  Progress: ${migrated}/${users.length}`);
    }
  }

  console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}Done.`);
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total: ${users.length}`);
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
