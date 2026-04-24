-- CreateTable
CREATE TABLE "video_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "pipeline" TEXT NOT NULL,
    "isRenovation" BOOLEAN NOT NULL DEFAULT false,
    "isFloorPlan" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "failureReason" TEXT,
    "segments" JSONB NOT NULL,
    "pollAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastPolledAt" TIMESTAMP(3),
    "firstSubmittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalDurationSeconds" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "buildingDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "video_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_jobs_userId_idx" ON "video_jobs"("userId");

-- CreateIndex
CREATE INDEX "video_jobs_executionId_idx" ON "video_jobs"("executionId");

-- CreateIndex
CREATE INDEX "video_jobs_nodeId_idx" ON "video_jobs"("nodeId");

-- CreateIndex
CREATE INDEX "video_jobs_status_idx" ON "video_jobs"("status");

-- CreateIndex
CREATE INDEX "video_jobs_status_lastPolledAt_idx" ON "video_jobs"("status", "lastPolledAt");

-- AddForeignKey
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
