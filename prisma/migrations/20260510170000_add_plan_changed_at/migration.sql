-- Add plan_changed_at to users so paid-tier execution counts can be
-- scoped to "since last role change" instead of "since calendar month
-- start" — fixes the P0 bug where pre-upgrade FREE-tier executions were
-- polluting post-upgrade MINI/STARTER/PRO quotas.
--
-- Null for users who have never changed plans (FREE since signup) and
-- for already-existing paid users until backfilled. The count helper
-- handles null safely (falls back to calendar-month for paid).
--
-- Set by both Razorpay and Stripe webhook handlers on every role-change
-- event (upgrade or downgrade), and by the manual-override admin path.

ALTER TABLE "users" ADD COLUMN "plan_changed_at" TIMESTAMP(3);
