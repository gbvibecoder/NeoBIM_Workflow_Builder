-- CreateEnum
CREATE TYPE "VipGenerationStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FALL_THROUGH', 'FAILED');

-- CreateTable
CREATE TABLE "vip_generations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" "VipGenerationStatus" NOT NULL DEFAULT 'RUNNING',
    "pipelineUsed" TEXT,
    "stageTimings" JSONB,
    "stageCosts" JSONB,
    "stageErrors" JSONB,
    "finalScore" INTEGER,
    "totalDurationMs" INTEGER,
    "totalCostUsd" DOUBLE PRECISION,
    "fallThroughReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vip_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vip_generations_requestId_key" ON "vip_generations"("requestId");

-- CreateIndex
CREATE INDEX "vip_generations_userId_createdAt_idx" ON "vip_generations"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "vip_generations_status_idx" ON "vip_generations"("status");

-- AddForeignKey
ALTER TABLE "vip_generations" ADD CONSTRAINT "vip_generations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
