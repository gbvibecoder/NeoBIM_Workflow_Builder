-- Phase 1 Slice 7 — DB-canonical persistence of the parametric BuildingModel.
-- Mirrors the Prisma model declared in prisma/schema.prisma. The TS-side
-- EX-001 handler writes one row per Execution that produces a parametric
-- IFC. R2 (r2Key) is a write-through replica; DB is the source of truth.

-- CreateTable
CREATE TABLE "building_models" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "graph" JSONB NOT NULL,
    "r2Key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "building_models_executionId_key" ON "building_models"("executionId");

-- CreateIndex
CREATE INDEX "building_models_executionId_idx" ON "building_models"("executionId");

-- AddForeignKey
ALTER TABLE "building_models" ADD CONSTRAINT "building_models_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
