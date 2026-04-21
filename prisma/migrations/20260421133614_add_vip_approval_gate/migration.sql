-- AlterEnum
ALTER TYPE "VipJobStatus" ADD VALUE 'AWAITING_APPROVAL';

-- AlterTable
ALTER TABLE "vip_jobs" ADD COLUMN     "intermediateBrief" JSONB,
ADD COLUMN     "intermediateImage" TEXT,
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "pausedStage" INTEGER,
ADD COLUMN     "userApproval" TEXT;
