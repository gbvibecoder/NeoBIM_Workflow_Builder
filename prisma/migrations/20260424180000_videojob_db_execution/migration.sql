-- Phase 2 durability: adds the DB Execution.id correlation column so the
-- QStash worker can patch Execution.tileResults when a VideoJob terminalizes.
-- Additive only (new nullable column + index). No data migration needed —
-- existing rows get NULL and the worker's patch gracefully no-ops when null.

-- AlterTable
ALTER TABLE "video_jobs" ADD COLUMN "dbExecutionId" TEXT;

-- CreateIndex
CREATE INDEX "video_jobs_dbExecutionId_idx" ON "video_jobs"("dbExecutionId");
