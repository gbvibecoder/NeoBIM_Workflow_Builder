-- Brief-to-IFC v3 — observability + lifecycle hardening (Phase v3 observability).
-- Additive only: 1 new enum + 2 new tables. No existing model touched.
-- Apply with `npx prisma migrate deploy` (CLAUDE.md: never `db push`).

-- CreateEnum
CREATE TYPE "BriefToIfcV3RunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "brief_to_ifc_v3_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT,
    "status" "BriefToIfcV3RunStatus" NOT NULL DEFAULT 'PENDING',
    "briefSpec" JSONB NOT NULL,
    "enrichmentCostUsd" DOUBLE PRECISION,
    "enrichmentMs" INTEGER,
    "generatorCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "generatorMs" INTEGER NOT NULL DEFAULT 0,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "ledger" JSONB NOT NULL DEFAULT '[]',
    "turnRecords" JSONB NOT NULL DEFAULT '[]',
    "ifcUrl" TEXT,
    "entityCount" INTEGER,
    "finalValidation" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "costCapUsd" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brief_to_ifc_v3_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brief_to_ifc_v3_runs_userId_createdAt_idx" ON "brief_to_ifc_v3_runs"("userId", "createdAt" DESC);
CREATE INDEX "brief_to_ifc_v3_runs_status_idx" ON "brief_to_ifc_v3_runs"("status");
CREATE INDEX "brief_to_ifc_v3_runs_workflowId_idx" ON "brief_to_ifc_v3_runs"("workflowId");
CREATE INDEX "brief_to_ifc_v3_runs_lastHeartbeatAt_idx" ON "brief_to_ifc_v3_runs"("lastHeartbeatAt");

-- CreateTable
CREATE TABLE "execution_logs" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "execution_logs_executionId_timestamp_idx" ON "execution_logs"("executionId", "timestamp");
