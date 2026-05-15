-- Brief-to-IFC v2 — Phase 2 queued AI IFC-creation pipeline.
-- Additive only: a new enum + a new table. No existing model touched,
-- no foreign key (the table uses a plain `userId` column).
-- Apply with `npx prisma migrate deploy` (CLAUDE.md: never `db push`).

-- CreateEnum
CREATE TYPE "BriefToIfcJobStatus" AS ENUM ('QUEUED', 'RUNNING_ENRICH', 'RUNNING_ARCHITECT', 'RUNNING_GENERATE', 'COMPLETED', 'FAILED', 'AWAITING_RETRY');

-- CreateTable
CREATE TABLE "brief_to_ifc_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "executionId" TEXT,
    "status" "BriefToIfcJobStatus" NOT NULL DEFAULT 'QUEUED',
    "briefFileR2Key" TEXT NOT NULL,
    "briefSourceFormat" TEXT,
    "enrichedSpec" TEXT,
    "architectScript" TEXT,
    "ifcR2Url" TEXT,
    "ifcEntityCount" INTEGER,
    "ifcAudit" JSONB,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStage" TEXT,
    "stageLog" JSONB,
    "error" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brief_to_ifc_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brief_to_ifc_jobs_userId_createdAt_idx" ON "brief_to_ifc_jobs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "brief_to_ifc_jobs_status_idx" ON "brief_to_ifc_jobs"("status");
