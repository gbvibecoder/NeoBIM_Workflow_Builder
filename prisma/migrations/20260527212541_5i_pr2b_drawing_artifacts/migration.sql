-- ============================================================
-- 5I PR 2b — BOQ and Formwork artifact S3 key columns on
-- kos_customer_drawings.
-- ============================================================
-- ADDITIVE ONLY. Two new nullable TEXT columns; no DROPs, no
-- changes to existing columns, no indexes, no FKs.
--
-- Background: PR 2b's `generate_boq` and `generate_formwork` bot
-- tools persist the sidecar JSON output to the tenant's S3 bucket
-- (since the JSON is multi-MB and not appropriate for JSONB).
-- These columns hold the resulting S3 keys so the chat UI (PR 4)
-- can resolve them to download URLs.
--
-- Hand-crafted (not `migrate dev`-generated) for the same reason
-- every prior KOS migration is hand-crafted: the live Neon DB
-- carries an applied migration (20260504060354) not represented
-- in this folder, so `migrate dev` would demand a destructive
-- reset. See prisma/migrations/0_baseline + the comment block at
-- the top of 20260521000000_kos_bim_infrastructure/migration.sql
-- for context.
-- ============================================================

ALTER TABLE "kos_customer_drawings"
  ADD COLUMN "boqResultS3Key"      TEXT,
  ADD COLUMN "formworkResultS3Key" TEXT;
