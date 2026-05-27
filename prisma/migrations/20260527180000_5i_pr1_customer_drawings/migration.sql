-- ============================================================
-- 5I PR 1 — Customer-uploaded drawings.
-- ============================================================
-- One new enum (KosDrawingStatus) and one new table
-- (kos_customer_drawings) for the customer-side drawing-attach
-- pipeline. Anonymous customers upload via the chat composer; this
-- table tracks each drawing through the AWAITING_UPLOAD → UPLOADED
-- lifecycle (PR 1) and later PARSING → PARSED / FAILED (PR 2 wires
-- the bot's process_drawing tool).
--
-- The direct customerId FK is the C2 (cross-customer ownership)
-- safety boundary: even if a customer guesses a drawingId, the
-- confirm-upload route's findFirst() requires { id, tenantId,
-- customerId } match, returning 404 (not 403) on miss to avoid
-- leaking existence.
--
-- ADDITIVE ONLY. No existing table is altered — the reverse
-- relation fields on KosTenant / KosCustomer / KosConversation
-- (added in schema.prisma) live on this table's foreign keys; the
-- parent tables gain no columns.
--
-- This file is hand-crafted (not `migrate dev`-generated) for the
-- same reason as every prior KOS migration: the live DB carries
-- applied migrations not represented in this folder, so `migrate
-- dev` would demand a destructive reset. The SQL below mirrors
-- Prisma's exact DDL output so a future `migrate diff` stays clean.
-- ============================================================

-- CreateEnum
CREATE TYPE "KosDrawingStatus" AS ENUM ('AWAITING_UPLOAD', 'UPLOADED', 'PARSING', 'PARSED', 'FAILED');

-- CreateTable
CREATE TABLE "kos_customer_drawings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "filename" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "actualSizeBytes" INTEGER,
    "s3Key" TEXT NOT NULL,
    "status" "KosDrawingStatus" NOT NULL DEFAULT 'AWAITING_UPLOAD',
    "parseResult" JSONB,
    "fullParseResultS3Key" TEXT,
    "parserVersion" TEXT,
    "errorCode" TEXT,
    "errorText" TEXT,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kos_customer_drawings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kos_customer_drawings_tenantId_customerId_idx" ON "kos_customer_drawings"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "kos_customer_drawings_tenantId_conversationId_idx" ON "kos_customer_drawings"("tenantId", "conversationId");

-- CreateIndex
CREATE INDEX "kos_customer_drawings_tenantId_status_idx" ON "kos_customer_drawings"("tenantId", "status");

-- CreateIndex
CREATE INDEX "kos_customer_drawings_tenantId_createdAt_idx" ON "kos_customer_drawings"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "kos_customer_drawings" ADD CONSTRAINT "kos_customer_drawings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "kos_tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kos_customer_drawings" ADD CONSTRAINT "kos_customer_drawings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "kos_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kos_customer_drawings" ADD CONSTRAINT "kos_customer_drawings_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "kos_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
