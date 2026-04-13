-- CreateTable
CREATE TABLE "material_price_cache" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "materialCode" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_price_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_price_cache_city_materialCode_fetchedAt_idx" ON "material_price_cache"("city", "materialCode", "fetchedAt");

-- CreateIndex
CREATE INDEX "material_price_cache_state_materialCode_fetchedAt_idx" ON "material_price_cache"("state", "materialCode", "fetchedAt");

-- CreateIndex
CREATE INDEX "material_price_cache_materialCode_fetchedAt_idx" ON "material_price_cache"("materialCode", "fetchedAt");
