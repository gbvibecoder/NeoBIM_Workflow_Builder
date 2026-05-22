/**
 * KOS — Kalzen tenant seed (Week 1).
 *
 * Idempotently inserts the single Kalzen tenant row that every KOS
 * surface looks up via `Tenant.slug = "kalzen"`. Safe to re-run; the
 * branding / config blobs are upserted on every invocation so updates
 * to this file flow to the DB the next time the seed runs.
 *
 * Run: `npm run seed:kos`
 *
 * IMPORTANT: All credential fields here store env-var NAMES (the *Ref
 * convention), never the actual secrets. The runtime resolves the value
 * via `process.env[ref]` at use time — secrets must never land in DB rows.
 */

import path from "node:path";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

// ─── Manual .env loader ──────────────────────────────────────────────
// tsx doesn't auto-load .env.local the way Next.js does. Mirror the
// shape of `prisma.config.ts` so this script picks up DATABASE_URL the
// same way Prisma CLI does.
function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    try {
      const content = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const line of content.split("\n")) {
        const m = line.match(/^DATABASE_URL=["']?([^"'\r\n]+)["']?/);
        if (m) return m[1].trim();
      }
    } catch {
      // file missing — keep looking
    }
  }
  throw new Error(
    "[seed-kos] DATABASE_URL is not set and could not be read from .env.local or .env. " +
      "Set it in your environment or in .env.local before running this seed.",
  );
}

const databaseUrl = loadDatabaseUrl();
const adapter = new PrismaNeon({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const KALZEN_TENANT_SLUG = "kalzen";

// Placeholder branding — Karthik will provide the real logo URL and final
// colours during Week 2 UAT. The KOS layout reads these via CSS variables.
const KALZEN_BRANDING = {
  displayName: "Kalzen",
  primaryColor: "#0a3d2e",
  secondaryColor: "#c9a55a",
  logoUrl: null as string | null,
  supportPhone: null as string | null,
};

// AiSensy WhatsApp Business Solution Provider — chosen over direct Meta
// to skip the ~7-day Business Manager verification. Every *Ref points to
// an env var name; secrets stay in the env layer.
const KALZEN_WHATSAPP_CONFIG = {
  provider: "aisensy",
  phoneNumberRef: "WHATSAPP_PHONE_NUMBER_KALZEN",
  apiKeyRef: "AISENSY_API_KEY_KALZEN",
  webhookVerifyTokenRef: "AISENSY_WEBHOOK_VERIFY_TOKEN_KALZEN",
};

// Frappe lead stages are stored verbatim so a tenant whose CRM uses
// custom stage names can override here without code changes (the spec
// calls this out — "Frappe stage names mismatch" risk in §15).
const KALZEN_FRAPPE_CONFIG = {
  baseUrl: null as string | null,
  apiKeyRef: "FRAPPE_API_KEY_KALZEN",
  apiSecretRef: "FRAPPE_API_SECRET_KALZEN",
  leadStages: {
    inquiry: "Inquiry",
    drawingReceived: "Drawing received",
    boqGenerated: "BOQ generated",
    siteVisit: "Site visit scheduled",
    commercial: "Commercial discussion",
    won: "Won",
    lost: "Lost",
  },
};

const KALZEN_S3_CONFIG = {
  bucket: "kalzen-kos-dev",
  region: "ap-south-1",
  accessKeyRef: "KOS_S3_ACCESS_KEY_ID",
  secretKeyRef: "KOS_S3_SECRET_ACCESS_KEY",
};

async function main() {
  console.info(`[seed-kos] upserting tenant slug="${KALZEN_TENANT_SLUG}"…`);

  const tenant = await prisma.tenant.upsert({
    where: { slug: KALZEN_TENANT_SLUG },
    update: {
      name: "Kalzen Realty",
      customDomain: "kalzen.trybuildflow.in",
      branding: KALZEN_BRANDING,
      whatsappConfig: KALZEN_WHATSAPP_CONFIG,
      frappeConfig: KALZEN_FRAPPE_CONFIG,
      s3Config: KALZEN_S3_CONFIG,
    },
    create: {
      slug: KALZEN_TENANT_SLUG,
      name: "Kalzen Realty",
      customDomain: "kalzen.trybuildflow.in",
      branding: KALZEN_BRANDING,
      whatsappConfig: KALZEN_WHATSAPP_CONFIG,
      frappeConfig: KALZEN_FRAPPE_CONFIG,
      s3Config: KALZEN_S3_CONFIG,
    },
  });

  console.info(
    `[seed-kos] ok — tenant.id=${tenant.id} slug=${tenant.slug} customDomain=${tenant.customDomain ?? "(none)"}`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-kos] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
