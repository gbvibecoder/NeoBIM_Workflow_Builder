-- CreateTable
CREATE TABLE "user_surveys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discoverySource" TEXT,
    "discoveryOther" TEXT,
    "profession" TEXT,
    "professionOther" TEXT,
    "teamSize" TEXT,
    "pricingAction" TEXT,
    "completedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "skippedAtScene" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_surveys_userId_key" ON "user_surveys"("userId");

-- CreateIndex
CREATE INDEX "user_surveys_userId_idx" ON "user_surveys"("userId");

-- CreateIndex
CREATE INDEX "user_surveys_completedAt_idx" ON "user_surveys"("completedAt");

-- CreateIndex
CREATE INDEX "user_surveys_createdAt_idx" ON "user_surveys"("createdAt");

-- AddForeignKey
ALTER TABLE "user_surveys" ADD CONSTRAINT "user_surveys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
