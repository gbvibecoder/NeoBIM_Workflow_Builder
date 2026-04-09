-- AlterTable
ALTER TABLE "workflows" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "workflows_deletedAt_idx" ON "workflows"("deletedAt");
