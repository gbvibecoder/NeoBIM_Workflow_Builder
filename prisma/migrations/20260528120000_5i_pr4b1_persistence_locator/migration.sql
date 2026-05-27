-- ============================================================
-- 5I PR 4b1 — Persistence + Locator.
-- ============================================================
-- Two additive nullable columns required by PR 4b2's UI reload-
-- hydration flow:
--
--   1. kos_messages.attachmentRefs (JSONB)
--      Holds the JSON array of drawing IDs the customer attached
--      in a given turn. Null for bot messages and for customer
--      messages with no attachments. Read on reload by PR 4b2's
--      conversation-messages endpoint to drive
--      useDrawingArtifactHydration so past ArtifactBubbles
--      re-render with working Download links.
--
--   2. kos_customers.currentConversationId (TEXT)
--      Soft pointer to the customer's most-recently-active
--      conversation. Updated best-effort after every customer
--      message is persisted in the bot orchestrator. Read on
--      page mount by the chat UI (PR 4b2) so reload knows which
--      conversation to load. Soft reference: no FK constraint
--      so a stale pointer to a deleted conversation is harmless
--      (read side treats it as "no history").
--
-- ADDITIVE ONLY. Both columns are nullable; no DROPs, no changes
-- to existing columns, no indexes, no FKs, no data backfill.
--
-- Hand-crafted (not `migrate dev`-generated) for the same reason
-- every prior KOS migration is hand-crafted: the live Neon DB
-- carries baseline migrations not represented in this folder, so
-- `migrate dev` would demand a destructive reset. See
-- prisma/migrations/0_baseline and the header block in
-- 20260521000000_kos_bim_infrastructure/migration.sql for context.
-- ============================================================

ALTER TABLE "kos_messages"
  ADD COLUMN "attachmentRefs" JSONB;

ALTER TABLE "kos_customers"
  ADD COLUMN "currentConversationId" TEXT;
