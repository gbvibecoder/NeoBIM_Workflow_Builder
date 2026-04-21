-- CreateEnum
CREATE TYPE "VipJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "vip_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" "VipJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStage" TEXT,
    "resultProject" JSONB,
    "errorMessage" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vip_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vip_jobs_requestId_key" ON "vip_jobs"("requestId");

-- CreateIndex
CREATE INDEX "vip_jobs_userId_createdAt_idx" ON "vip_jobs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "vip_jobs_status_idx" ON "vip_jobs"("status");

-- AddForeignKey
ALTER TABLE "vip_jobs" ADD CONSTRAINT "vip_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
