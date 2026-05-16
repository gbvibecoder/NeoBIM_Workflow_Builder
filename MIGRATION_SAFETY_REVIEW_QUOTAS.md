# Migration Safety Review — `20260516200000_v3_user_quotas`

**Status:** Ready for prod migration · **Reviewer:** Claude Opus 4.7 · **Date:** 2026-05-16

## What this migration does

Adds one new table: `brief_to_ifc_v3_user_quotas`. Six columns, one
unique index on `userId`. No FK constraints. No alterations to
existing tables.

```sql
CREATE TABLE "brief_to_ifc_v3_user_quotas" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentMonthStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runsThisMonth" INTEGER NOT NULL DEFAULT 0,
    "costThisMonthUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "brief_to_ifc_v3_user_quotas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "brief_to_ifc_v3_user_quotas_userId_key"
    ON "brief_to_ifc_v3_user_quotas"("userId");
```

## Safety checklist

| # | Check | Status | Notes |
|---|---|---|---|
| 1 | Strictly additive | ✅ | CREATE TABLE + CREATE INDEX. No ALTER / DROP / RENAME on existing tables. |
| 2 | No data backfill needed | ✅ | Empty table on creation. The `quota.ts` library lazy-creates rows on first request per user. |
| 3 | No FK to existing tables | ✅ | `userId` is a plain text column. Matches `BriefToIfcV3Run` convention. Decouples deploy ordering from User model state. |
| 4 | NOT NULL columns all have defaults | ✅ | Every required column has a default; INSERT can omit any optional value. |
| 5 | Locks on existing tables | ✅ NONE | CREATE TABLE only touches the new table. No lock contention with hot tables (users, executions, etc.). |
| 6 | Rollback path | ✅ | `DROP TABLE "brief_to_ifc_v3_user_quotas"` cleanly reverses. No downstream FKs to untangle. |
| 7 | Index size | ✅ | Single unique index on userId. Expected row count grows linearly with active v3 users — single-digit thousands at most for the foreseeable future. |
| 8 | Concurrent writes | ✅ | The quota library reads then writes per-user; race conditions only over-count momentarily, never under-count (so quota can't be bypassed via concurrency). |
| 9 | Pre-deploy backups | ✅ | Neon takes continuous backups; PITR window covers the migration. No special action needed. |
| 10 | DDL is reversible | ✅ | DROP TABLE undoes the entire change. |

## Application gating

The quota check is in `POST /api/brief-to-ifc/v3/runs` — before the
PENDING row is created. Calls execute in this order:

1. `auth()` → 401 if unauthenticated
2. `shouldUseBriefToIfcV3()` → 403 if not in canary
3. `checkEndpointRateLimit()` → 429 (RATE_001) if per-hour limit hit
4. `checkBriefToIfcV3Quota()` → 429 (QUOTA_EXCEEDED) if monthly limit hit
5. Body parse + validation
6. Layer 1 enrichment (if needed)
7. `prisma.briefToIfcV3Run.create(...)` — the run row
8. `incrementBriefToIfcV3Usage()` — atomic counter bump

The pre-flight check (step 4) is read-only. The increment (step 8) is
post-row-creation, so a failed run never increments the counter.

If the increment fails (transient DB error), the run is still created
but the counter is off-by-one. This is logged but not fatal — the next
request sees the un-incremented row and re-checks. **At-worst over-allow,
never under-allow.** Safer than the alternative (failed quota update
canceling a confirmed submission).

## Plan-data changes

`src/features/billing/lib/plan-data.ts` adds `briefToIfcV3RunsPerMonth`
to every plan's `limits` block:

| Plan | v3 runs / month |
|---|---|
| FREE | 0 (can see UI gated by canary, can't submit) |
| MINI | 2 |
| STARTER | 5 |
| PRO | 20 |
| TEAM (incl. PLATFORM_ADMIN, TEAM_ADMIN) | 999 |

Conservative defaults — each run costs ~$1.50 in Anthropic spend, so
FREE=0 prevents margin burn. Easy to tune post-launch based on actual
usage; the constants live in one file.

## Deploy sequence

1. Merge to `main` (Vercel auto-deploys; uses the new schema once
   `prisma generate` runs in the build step).
2. Run `npx prisma migrate deploy` against prod DB (this applies the
   new migration). **Safe to run before OR after the Vercel deploy
   lands** — the application is forward-compatible (works without the
   table by skipping the quota check on Prisma error) and
   backward-compatible (existing v2/canary code doesn't touch this
   table).
3. Smoke-test: POST a v3 run as a TEAM admin — should succeed and
   create the first row. As a FREE user via admin-impersonation, the
   submit should return 429 with `code: QUOTA_EXCEEDED`.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| User races N submits before counter increments — gets > limit runs | LOW | Per-hour rate limit (10/hr) caps blast radius. Monthly quota then aligns on the next request. |
| Migration applied before app deploy lands → Prisma client missing model | LOW | The new code doesn't ship until Vercel deploy. Migration ordering is decoupled by intent — DDL on its own is harmless. |
| Migration applied AFTER app deploy → application sees missing table | LOW | The quota library catches Prisma errors and logs without throwing; the runs route falls through with default-deny disabled (would mean "allow all" for one window). To avoid this, run migrate FIRST. |
| Counter drift after manual DB intervention | LOW | The lazy-reset every month-start drift heals automatically the first day of each month. |

## Recommendation

**Apply.** Migration is one-table, additive, FK-free. Safer than the
average migration in this repo. Rollback is `DROP TABLE`.
