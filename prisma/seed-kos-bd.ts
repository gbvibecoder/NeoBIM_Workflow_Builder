/**
 * KOS BD user seed (Week 2).
 *
 * Idempotently upserts a single KosBdUser for tenant slug="kalzen"
 * with role=BD. Re-running with the same email is a no-op aside
 * from refreshing the password hash to the env var's current value.
 *
 * Reads credentials from env:
 *   KOS_BD_SEED_EMAIL      — login email
 *   KOS_BD_SEED_PASSWORD   — plaintext password (>= 8 chars)
 *
 * NOT auto-run by build / migrate. Invoke explicitly:
 *
 *   npm run seed:kos-bd
 *
 * Govind uses this to create test BD accounts manually.
 */

import path from "node:path";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const KALZEN_TENANT_SLUG = "kalzen";

function loadEnvFromFile(): void {
  // Mirror seed-kos.ts: tsx doesn't load .env.local automatically,
  // so do a minimal parse to populate the seed-relevant vars.
  for (const file of [".env.local", ".env"]) {
    try {
      const content = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const line of content.split("\n")) {
        const m = line.match(/^([A-Z0-9_]+)=["']?([^"'\r\n]+)["']?/);
        if (!m) continue;
        const [, key, value] = m;
        if (process.env[key]) continue; // existing env wins
        process.env[key] = value.trim();
      }
    } catch {
      // file missing — keep looking
    }
  }
}

loadEnvFromFile();

const email = process.env.KOS_BD_SEED_EMAIL?.trim().toLowerCase();
const password = process.env.KOS_BD_SEED_PASSWORD;

if (!email || !password) {
  console.error(
    "[seed-kos-bd] KOS_BD_SEED_EMAIL and KOS_BD_SEED_PASSWORD must be set " +
      "in your environment or .env.local. Aborting without changes.",
  );
  process.exit(1);
}

if (password.length < 8) {
  console.error(
    `[seed-kos-bd] KOS_BD_SEED_PASSWORD must be at least 8 characters (got ${password.length}). Aborting.`,
  );
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[seed-kos-bd] DATABASE_URL is not set. Aborting.");
  process.exit(1);
}

const adapter = new PrismaNeon({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: KALZEN_TENANT_SLUG },
  });
  if (!tenant) {
    throw new Error(
      `[seed-kos-bd] tenant "${KALZEN_TENANT_SLUG}" not found. ` +
        "Run `npm run seed:kos` first to create the Kalzen tenant row.",
    );
  }

  const passwordHash = await bcrypt.hash(password!, 12);

  const upserted = await prisma.kosBdUser.upsert({
    where: {
      tenantId_email: { tenantId: tenant.id, email: email! },
    },
    create: {
      tenantId: tenant.id,
      email: email!,
      name: email!.split("@")[0] || "BD User",
      role: "BD",
      passwordHash,
      active: true,
    },
    update: {
      // Refresh the password hash on re-run so a forgotten password
      // can be reset by re-seeding with a new value.
      passwordHash,
      active: true,
    },
  });

  console.info(
    `[seed-kos-bd] upserted bd user email=${upserted.email} role=${upserted.role}`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-kos-bd] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
