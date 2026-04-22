// Phase 2.3 migration verification — read-only checks against Neon.
// Usage: node scripts/phase-2-3-verify-migration.mjs

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const envPath = path.resolve(".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (!process.env[k]) process.env[k] = v;
}

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, idle_timeout: 2 });

try {
  // 1. Columns on vip_jobs
  const columns = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vip_jobs'
    ORDER BY ordinal_position
  `;
  const expected = ["pausedAt", "pausedStage", "intermediateImage", "intermediateBrief", "userApproval"];
  const present = new Set(columns.map((c) => c.column_name));
  console.log("═══ Columns on vip_jobs (relevant new ones) ═══");
  for (const col of expected) {
    const found = columns.find((c) => c.column_name === col);
    if (found) {
      console.log(`  ✓ ${col.padEnd(20)} ${found.data_type.padEnd(30)} nullable=${found.is_nullable}`);
    } else {
      console.log(`  ✗ ${col} — MISSING`);
    }
  }

  // 2. VipJobStatus enum values
  const enumValues = await sql`
    SELECT e.enumlabel, e.enumsortorder
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'VipJobStatus'
    ORDER BY e.enumsortorder
  `;
  console.log("\n═══ VipJobStatus enum values ═══");
  for (const e of enumValues) {
    const marker = e.enumlabel === "AWAITING_APPROVAL" ? " ← NEW" : "";
    console.log(`  • ${e.enumlabel}${marker}`);
  }

  // 3. Summary
  const allColsPresent = expected.every((c) => present.has(c));
  const awaitingApprovalPresent = enumValues.some((e) => e.enumlabel === "AWAITING_APPROVAL");
  console.log("\n═══ SUMMARY ═══");
  console.log(`  All 5 new columns present: ${allColsPresent ? "YES ✓" : "NO ✗"}`);
  console.log(`  AWAITING_APPROVAL enum value present: ${awaitingApprovalPresent ? "YES ✓" : "NO ✗"}`);

  // 4. Migration registry row
  const migrations = await sql`
    SELECT migration_name, applied_steps_count, finished_at, rolled_back_at
    FROM _prisma_migrations
    WHERE migration_name = '20260421133614_add_vip_approval_gate'
  `;
  console.log("\n═══ Prisma migration record ═══");
  if (migrations[0]) {
    console.log(`  migration_name:      ${migrations[0].migration_name}`);
    console.log(`  applied_steps_count: ${migrations[0].applied_steps_count}`);
    console.log(`  finished_at:         ${migrations[0].finished_at}`);
    console.log(`  rolled_back_at:      ${migrations[0].rolled_back_at ?? "null (clean apply)"}`);
  } else {
    console.log("  ✗ migration record not found");
  }
} finally {
  await sql.end();
}
