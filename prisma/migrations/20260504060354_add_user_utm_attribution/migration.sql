-- AlterTable
ALTER TABLE "users" ADD COLUMN     "acquisitionDate" TIMESTAMP(3),
ADD COLUMN     "landingPage" TEXT,
ADD COLUMN     "referrer" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmTerm" TEXT;

-- CreateIndex
CREATE INDEX "users_utmSource_idx" ON "users"("utmSource");

-- CreateIndex
CREATE INDEX "users_utmCampaign_idx" ON "users"("utmCampaign");
