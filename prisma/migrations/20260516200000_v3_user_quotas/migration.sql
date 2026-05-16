-- Per-user monthly quota counters for Brief-to-IFC v3.
--
-- Lazy-reset semantics: application logic in `quota.ts` checks
-- `currentMonthStart` on each call and resets `runsThisMonth` /
-- `costThisMonthUsd` when the wall clock crosses into a new month.
-- No cron job required.
--
-- Strictly additive: new table, no FK constraints to existing tables
-- (userId is a plain string column matching the codebase convention).
-- Safe to roll back via DROP TABLE.

CREATE TABLE "brief_to_ifc_v3_user_quotas" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentMonthStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runsThisMonth" INTEGER NOT NULL DEFAULT 0,
    "costThisMonthUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brief_to_ifc_v3_user_quotas_pkey" PRIMARY KEY ("id")
);

-- One quota row per user (upserts key off userId).
CREATE UNIQUE INDEX "brief_to_ifc_v3_user_quotas_userId_key"
    ON "brief_to_ifc_v3_user_quotas"("userId");
