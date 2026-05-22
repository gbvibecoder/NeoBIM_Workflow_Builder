/**
 * scripts/lib/prisma-for-scripts.ts
 *
 * A SCRIPT-ONLY PrismaClient that uses the `pg` driver-adapter
 * instead of the WebSocket-based `@prisma/adapter-neon` adapter the
 * Next.js runtime ships with.
 *
 * WHY: the Neon WebSocket adapter relies on a request-scoped
 * environment (Next.js's web-fetch lifecycle, ws polyfills, etc.)
 * that does NOT initialise correctly under a plain tsx process.
 * Symptom: ALL queries — even `SELECT 1` — fail with an opaque
 * `prisma:error undefined` ErrorEvent whose `Object.keys(err)`
 * is just `['clientVersion']`. Diagnosed in the Stage A debug
 * pass; this file is the fix.
 *
 * The pg adapter uses raw TCP (with TLS), which is fully
 * supported by Neon and works identically under Node, tsx, and
 * any CLI/serverless environment. No protocol mystery, no
 * adapter mismatch.
 *
 * HARD RULE: only import from `scripts/`. Application code (under
 * `src/`) MUST continue to use `@/lib/db` so the Next.js runtime
 * keeps its WebSocket adapter — that one IS the right choice for
 * Vercel serverless requests.
 *
 * Side effect: this module sets `globalThis.prisma` to its own
 * instance. `src/lib/db.ts` reads `globalForPrisma.prisma ??
 * createPrismaClient()`, so any downstream import of `@/lib/db`
 * (e.g. via `retrieveChunks`) will pick up our pg-backed client
 * instead of constructing a fresh Neon one. The script entry-
 * point MUST import THIS module BEFORE any `@/features/...`
 * import for the side-effect ordering to hold.
 */

import path from "node:path";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// ─── Manual .env loader ───────────────────────────────────────────────
// tsx doesn't auto-load .env.local the way Next.js does. We mirror
// the seed-scripts pattern so a fresh checkout works without
// requiring the user to `export` every var by hand.
function loadEnvFromFile(): void {
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

// ─── Connection string selection ──────────────────────────────────────
// Prefer DIRECT_URL (Neon non-pooled endpoint) when available — pg
// over the pooler can run into PgBouncer transaction-mode quirks for
// scripts that don't fit into one transaction. Fall back to
// DATABASE_URL with a loud warning so the dev knows what's happening.
const connectionString =
  process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "[prisma-for-scripts] Neither DIRECT_URL nor DATABASE_URL is set. " +
      "Configure one in .env.local before running KOS scripts.",
  );
}

if (!process.env.DIRECT_URL) {
  console.warn(
    "[prisma-for-scripts] DIRECT_URL not set — falling back to DATABASE_URL. " +
      "Scripts may hit pooler issues; consider adding DIRECT_URL (the " +
      "non-pooled Neon connection string) to .env.local for clean " +
      "behaviour on migrations and long-running scripts.",
  );
}

// ─── Build the pg-backed client ───────────────────────────────────────
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

export const prismaForScripts = new PrismaClient({ adapter });

// ─── Side effect: register on globalThis so `@/lib/db` adopts us ─────
// `src/lib/db.ts` reads `globalForPrisma.prisma` at module load. By
// setting that property HERE — before the test-retrieval script
// imports `@/features/kos/services/rag-retriever` (which transitively
// imports `@/lib/db`) — we guarantee the retriever's `prisma`
// reference points at this pg-backed client instead of constructing
// a fresh Neon WebSocket one.
//
// This is why import ORDER in the script matters: import
// prisma-for-scripts FIRST, then the retriever.
(globalThis as unknown as { prisma?: PrismaClient }).prisma =
  prismaForScripts;
