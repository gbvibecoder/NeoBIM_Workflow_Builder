-- Phase δ.3 — per-iteration QStash chaining state on BriefToIfcV3Run.
--
-- Three new columns. All have defaults so existing PENDING/RUNNING rows
-- get sensible values without backfill (currentIteration=0 matches the
-- pre-δ.3 "iteration 1 has not started yet" state; iterationHistory=[]
-- matches "no iterations have completed yet"; bestIteration NULL means
-- "no iteration result is the best yet").
--
-- Strictly additive — no column drops, no constraint changes, no index
-- removal. Safe to roll back (DROP COLUMN) without data loss because
-- the columns are populated only by δ.3+ code paths.
--
-- currentIteration is the atomic check-and-set counter that serialises
-- QStash hops. Each worker invocation only proceeds if it can advance
-- the counter from N-1 to N via a conditional updateMany — duplicate
-- QStash deliveries fail the update and become no-ops.
--
-- iterationHistory carries per-iteration results across hops:
--   [{ iteration: 1, qualityScore: 62, ifcUrl: "https://r2.../...ifc",
--      entityCount: 1400, costUsd: 0.42, durationMs: 180_000,
--      verifierSummary: "...", visionSummary: "...",
--      finalValidation: <SandboxValidateResult> }, ...]
--
-- bestIteration is the 1-based iteration number of the best result
-- (matches iterationHistory[i].iteration). Authoritative for which
-- iteration's IFC/entityCount got written into the COMPLETED row's
-- user-facing fields.

ALTER TABLE "brief_to_ifc_v3_runs"
  ADD COLUMN "currentIteration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "iterationHistory" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "bestIteration" INTEGER;
