-- AlterTable
ALTER TABLE "material_price_cache" ADD COLUMN     "confidenceScore" DOUBLE PRECISION,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "rawResponse" JSONB,
ADD COLUMN     "sourceUrl" TEXT;
