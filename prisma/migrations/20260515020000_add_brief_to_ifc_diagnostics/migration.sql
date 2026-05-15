-- Brief-to-IFC v2 — Phase 3 self-heal diagnostics.
-- Additive only: 4 new nullable columns on `brief_to_ifc_jobs`.
-- No existing column touched, no enum changes, no indexes touched.
-- Apply with `npx prisma migrate deploy` (CLAUDE.md: never `db push`).

-- AlterTable
ALTER TABLE "brief_to_ifc_jobs"
    ADD COLUMN "errorTraceback" TEXT,
    ADD COLUMN "errorType" TEXT,
    ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "retryHistory" JSONB;
