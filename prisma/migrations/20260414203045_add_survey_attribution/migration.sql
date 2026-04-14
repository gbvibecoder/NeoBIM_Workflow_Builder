-- AlterTable
ALTER TABLE "user_surveys" ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "deviceType" TEXT,
ADD COLUMN     "referrer" TEXT,
ADD COLUMN     "userAgent" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT,
ADD COLUMN     "utmTerm" TEXT;

-- CreateIndex
CREATE INDEX "user_surveys_utmSource_idx" ON "user_surveys"("utmSource");

-- CreateIndex
CREATE INDEX "user_surveys_country_idx" ON "user_surveys"("country");
