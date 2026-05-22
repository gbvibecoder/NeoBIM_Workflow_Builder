-- ============================================================
-- KOS BIM infrastructure (Week 5A)
-- ============================================================
-- 6 new tables + 3 enums backing the Dincel/Kalzen panel SKU
-- library. Source .rfa / .dwg files are translated to SVF2 +
-- a properties manifest via the Autodesk Platform Services
-- (APS) Model Derivative API; we persist the URN, the extracted
-- parameters, and geometry pointers here.
--
-- ADDITIVE ONLY. No existing table is altered except `kos_tenants`,
-- which gains NO new column — the `bimFamilies` relation lives on
-- the child table's foreign key. The migration is therefore safe to
-- `migrate deploy` against the live database without touching any
-- Stage A data.
--
-- This file is hand-crafted (not `migrate dev`-generated) for the same
-- reason as every prior KOS migration: the live DB carries an applied
-- migration not represented in this folder, so `migrate dev` would
-- demand a destructive reset. The SQL below mirrors Prisma's exact DDL
-- output so a future `migrate diff` stays clean.
-- ============================================================

-- CreateEnum
CREATE TYPE "KosBimApsStatus" AS ENUM ('PENDING', 'UPLOADING', 'TRANSLATING', 'READY', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "KosBimFamilyCategory" AS ENUM ('PANEL', 'ACCESSORY', 'ASSEMBLY', 'REFERENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "KosBimAccessoryType" AS ENUM ('TRACK', 'FINISH', 'VOID', 'CORNER', 'JOINER', 'END_CAP', 'STOP_END', 'SPACER', 'ANGLE', 'OTHER');

-- CreateTable
CREATE TABLE "kos_bim_families" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "sourceFolder" TEXT,
    "sourcePath" TEXT NOT NULL,
    "sourceFileHash" TEXT NOT NULL,
    "s3KeyOriginal" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "apsUrn" TEXT,
    "apsBucketKey" TEXT,
    "apsObjectKey" TEXT,
    "apsJobId" TEXT,
    "apsStatus" "KosBimApsStatus" NOT NULL DEFAULT 'PENDING',
    "apsError" TEXT,
    "apsCreditCost" INTEGER,
    "apsTranslatedAt" TIMESTAMP(3),
    "s3KeyManifest" TEXT,
    "rawMetadata" JSONB,
    "familyCategory" "KosBimFamilyCategory" NOT NULL,
    "displayName" TEXT NOT NULL,
    "metadata" JSONB,
    "ingestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kos_bim_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kos_bim_panel_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "widthMm" DECIMAL(65,30),
    "heightMm" DECIMAL(65,30),
    "thicknessMm" DECIMAL(65,30),
    "weightKg" DECIMAL(65,30),
    "material" TEXT,
    "ribPattern" TEXT,
    "fireRatingHours" DECIMAL(65,30),
    "acousticRw" INTEGER,
    "pricePerUnit" DECIMAL(65,30),
    "priceCurrency" TEXT,
    "priceUpdatedAt" TIMESTAMP(3),
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "sourceTypeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kos_bim_panel_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kos_bim_accessories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accessoryType" "KosBimAccessoryType" NOT NULL,
    "loadRatingKn" DECIMAL(65,30),
    "spanMinMm" DECIMAL(65,30),
    "spanMaxMm" DECIMAL(65,30),
    "weightKg" DECIMAL(65,30),
    "pricePerUnit" DECIMAL(65,30),
    "priceCurrency" TEXT,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kos_bim_accessories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kos_bim_assemblies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "assemblyCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "componentPanelSkus" TEXT[],
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kos_bim_assemblies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kos_bim_geometries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "panelTypeId" TEXT,
    "accessoryId" TEXT,
    "assemblyId" TEXT,
    "s3KeyMesh" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "vertexCount" INTEGER,
    "faceCount" INTEGER,
    "boundingBoxMm" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kos_bim_geometries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kos_bracing_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "wallHeightMinMm" DECIMAL(65,30) NOT NULL,
    "wallHeightMaxMm" DECIMAL(65,30) NOT NULL,
    "pourRateMin" DECIMAL(65,30),
    "pourRateMax" DECIMAL(65,30),
    "bracingAccessoryId" TEXT,
    "bracingSpacingMm" DECIMAL(65,30),
    "tieAccessoryId" TEXT,
    "tieSpacingHorizontalMm" DECIMAL(65,30),
    "tieSpacingVerticalMm" DECIMAL(65,30),
    "sourceDocument" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kos_bracing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kos_bim_families_apsUrn_key" ON "kos_bim_families"("apsUrn");

-- CreateIndex
CREATE INDEX "kos_bim_families_tenantId_apsStatus_idx" ON "kos_bim_families"("tenantId", "apsStatus");

-- CreateIndex
CREATE INDEX "kos_bim_families_tenantId_familyCategory_idx" ON "kos_bim_families"("tenantId", "familyCategory");

-- CreateIndex
CREATE UNIQUE INDEX "kos_bim_families_tenantId_sourceFileHash_key" ON "kos_bim_families"("tenantId", "sourceFileHash");

-- CreateIndex
CREATE UNIQUE INDEX "kos_bim_panel_types_tenantId_skuCode_key" ON "kos_bim_panel_types"("tenantId", "skuCode");

-- CreateIndex
CREATE INDEX "kos_bim_panel_types_tenantId_widthMm_heightMm_idx" ON "kos_bim_panel_types"("tenantId", "widthMm", "heightMm");

-- CreateIndex
CREATE UNIQUE INDEX "kos_bim_accessories_tenantId_skuCode_key" ON "kos_bim_accessories"("tenantId", "skuCode");

-- CreateIndex
CREATE INDEX "kos_bim_accessories_tenantId_accessoryType_idx" ON "kos_bim_accessories"("tenantId", "accessoryType");

-- CreateIndex
CREATE UNIQUE INDEX "kos_bim_assemblies_tenantId_assemblyCode_key" ON "kos_bim_assemblies"("tenantId", "assemblyCode");

-- CreateIndex
CREATE UNIQUE INDEX "kos_bim_geometries_panelTypeId_key" ON "kos_bim_geometries"("panelTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "kos_bim_geometries_accessoryId_key" ON "kos_bim_geometries"("accessoryId");

-- CreateIndex
CREATE UNIQUE INDEX "kos_bim_geometries_assemblyId_key" ON "kos_bim_geometries"("assemblyId");

-- CreateIndex
CREATE INDEX "kos_bim_geometries_tenantId_idx" ON "kos_bim_geometries"("tenantId");

-- CreateIndex
CREATE INDEX "kos_bracing_rules_tenantId_wallHeightMinMm_wallHeightMaxMm_idx" ON "kos_bracing_rules"("tenantId", "wallHeightMinMm", "wallHeightMaxMm");

-- AddForeignKey
ALTER TABLE "kos_bim_families" ADD CONSTRAINT "kos_bim_families_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "kos_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kos_bim_panel_types" ADD CONSTRAINT "kos_bim_panel_types_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "kos_bim_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kos_bim_accessories" ADD CONSTRAINT "kos_bim_accessories_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "kos_bim_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kos_bim_assemblies" ADD CONSTRAINT "kos_bim_assemblies_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "kos_bim_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kos_bim_geometries" ADD CONSTRAINT "kos_bim_geometries_panelTypeId_fkey" FOREIGN KEY ("panelTypeId") REFERENCES "kos_bim_panel_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kos_bim_geometries" ADD CONSTRAINT "kos_bim_geometries_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "kos_bim_accessories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kos_bim_geometries" ADD CONSTRAINT "kos_bim_geometries_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "kos_bim_assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kos_bracing_rules" ADD CONSTRAINT "kos_bracing_rules_bracingAccessoryId_fkey" FOREIGN KEY ("bracingAccessoryId") REFERENCES "kos_bim_accessories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kos_bracing_rules" ADD CONSTRAINT "kos_bracing_rules_tieAccessoryId_fkey" FOREIGN KEY ("tieAccessoryId") REFERENCES "kos_bim_accessories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
