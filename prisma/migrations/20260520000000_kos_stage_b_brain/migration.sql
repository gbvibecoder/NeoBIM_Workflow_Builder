-- ============================================================
-- KOS Stage B — bot brain (Phase 3A)
-- ============================================================
-- Strictly additive. No column drops, no type changes, no enum
-- migrations. The spec's enum additions (kos_message_role,
-- kos_audit_event_type, plus alternative kos_conversation_status
-- values) intentionally REUSE existing types that already cover
-- the required cases:
--
--   • Spec's "role" on KosMessage → existing KosAuthorType column
--     `authorType` (CUSTOMER, BOT, BD_HUMAN, SYSTEM) — identical
--     enum values, no new column required.
--   • Spec's "ACTIVE|ESCALATED|CLOSED" on KosConversation →
--     existing KosConversationStatus values (BOT_ACTIVE,
--     AWAITING_HUMAN, CLOSED). The orchestrator maps semantically:
--     ACTIVE→BOT_ACTIVE, ESCALATED→AWAITING_HUMAN.
--   • Spec's "kos_audit_event_type" enum → existing
--     KosAuditLog.action (free-form String). Standard event names
--     (BOT_RETRIEVAL, BOT_RESPONSE, BOT_ESCALATION,
--     CUSTOMER_MESSAGE, CUSTOMER_SESSION_START) are constants in
--     application code; no enum needed.
--
-- Net additions:
--   • kos_customers: displayName, lastSeenAt, isAnonymous
--   • kos_conversations: escalationReason
--   • kos_messages: retrievalAuditId
--   • NEW table kos_customer_sessions (full row)
-- ============================================================

-- KosCustomer additions (Stage B identity surface).
ALTER TABLE "kos_customers"
    ADD COLUMN IF NOT EXISTS "displayName" TEXT;

ALTER TABLE "kos_customers"
    ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "kos_customers"
    ADD COLUMN IF NOT EXISTS "isAnonymous" BOOLEAN NOT NULL DEFAULT true;

-- KosConversation — escalation context captured by the bot.
ALTER TABLE "kos_conversations"
    ADD COLUMN IF NOT EXISTS "escalationReason" TEXT;

-- KosMessage — soft reference to the BOT_RETRIEVAL audit row that
-- produced the citations on this message.
ALTER TABLE "kos_messages"
    ADD COLUMN IF NOT EXISTS "retrievalAuditId" TEXT;

-- ============================================================
-- New table: kos_customer_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS "kos_customer_sessions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "kos_customer_sessions_pkey" PRIMARY KEY ("id")
);

-- Unique constraint + lookup indexes. Validation iterates active
-- sessions for a customer; the (customerId, expiresAt) composite
-- index lets the scan stay tight even at scale.
CREATE UNIQUE INDEX IF NOT EXISTS "kos_customer_sessions_tokenHash_key"
    ON "kos_customer_sessions"("tokenHash");

CREATE INDEX IF NOT EXISTS "kos_customer_sessions_tokenHash_idx"
    ON "kos_customer_sessions"("tokenHash");

CREATE INDEX IF NOT EXISTS "kos_customer_sessions_customerId_expiresAt_idx"
    ON "kos_customer_sessions"("customerId", "expiresAt");

-- Cascade on parent deletion — when a KosCustomer row is purged
-- (e.g. via GDPR delete) all sessions disappear with it.
ALTER TABLE "kos_customer_sessions"
    ADD CONSTRAINT "kos_customer_sessions_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "kos_customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
