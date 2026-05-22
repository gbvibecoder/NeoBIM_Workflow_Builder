-- ============================================================
-- Reconstruction of the missing migration that lives ON the
-- production / dev Neon DB but not in this folder.
-- ============================================================
--
-- Discovered via `prisma migrate status`:
--   "The migration from the database are not found locally in
--    prisma/migrations: 20260504060354_add_user_utm_attribution"
--
-- Authoritative ground truth: `prisma migrate diff --from-empty
-- --to-config-datasource --script` was run against Neon (read-only)
-- on 2026-05-18 to dump the live DDL. The `users` table CREATE
-- block on the live DB has 8 columns + 2 indexes that are absent
-- from the local schema's User model — those are reproduced below.
-- All columns are nullable, no DEFAULTs (matches "first-touch
-- attribution captured at signup" semantics — null means the user
-- predates UTM tracking or signed up without UTM params).
--
-- All statements use IF NOT EXISTS so this migration is safe to
-- apply against:
--   • the existing dev/prod DB that already has these columns
--     (idempotent — DDL is a no-op);
--   • any new test/CI DB where the migration runs fresh.
--
-- Sized as a separate migration (not folded into a follow-up) to
-- preserve historical accuracy — `prisma migrate resolve --applied
-- 20260504060354_add_user_utm_attribution` needs this exact folder
-- name to register the migration as already-applied without re-running.
-- ============================================================

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "acquisitionDate" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "landingPage" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referrer" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "utmContent" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "utmMedium" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "utmSource" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "utmTerm" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_utmCampaign_idx" ON "users"("utmCampaign");
CREATE INDEX IF NOT EXISTS "users_utmSource_idx" ON "users"("utmSource");
