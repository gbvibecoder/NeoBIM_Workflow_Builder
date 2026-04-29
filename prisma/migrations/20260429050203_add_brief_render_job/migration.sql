-- CreateEnum
CREATE TYPE "BriefRenderJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "brief_render_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "briefUrl" TEXT NOT NULL,
    "status" "BriefRenderJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStage" TEXT,
    "specResult" JSONB,
    "shots" JSONB,
    "pdfUrl" TEXT,
    "errorMessage" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "userApproval" TEXT,
    "stageLog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brief_render_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brief_render_jobs_requestId_key" ON "brief_render_jobs"("requestId");

-- CreateIndex
CREATE INDEX "brief_render_jobs_userId_createdAt_idx" ON "brief_render_jobs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "brief_render_jobs_status_idx" ON "brief_render_jobs"("status");

-- AddForeignKey
ALTER TABLE "brief_render_jobs" ADD CONSTRAINT "brief_render_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
