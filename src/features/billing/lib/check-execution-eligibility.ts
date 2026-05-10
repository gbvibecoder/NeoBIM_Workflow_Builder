/**
 * Centralized plan-cap eligibility check — single source of truth for every
 * execution-like endpoint (check-execution-eligibility, execute-node,
 * generate-floor-plan, parse-ifc).
 *
 * Invariants:
 *   • One filter for "completed runs": status ∈ {SUCCESS, PARTIAL}.
 *     RUNNING is intentionally excluded so in-flight nodes within a single
 *     workflow do not self-block (and so the new-execution row created at
 *     workflow start does not pre-empt the cap check on the FIRST node call).
 *   • One limit source: getEffectiveLimits(role, legacyLimits) — honors the
 *     legacy snapshot for grandfathered users.
 *   • Referral-bonus consumption is opt-in via options.consumeBonusOnCap.
 *     Pre-check passes false (preview); execute-node / generate-floor-plan /
 *     parse-ifc pass true (authoritative gate).
 *   • DB role wins over JWT role (JWT can be stale up to 15s after a
 *     subscription change). The helper reads User.role+legacyLimits from DB
 *     in parallel with the execution count.
 */
import { prisma } from "@/lib/db";
import {
  consumeReferralBonus,
  getReferralBonus,
  isAdminUser,
  redis,
  redisConfigured,
} from "@/lib/rate-limit";
import {
  STRIPE_PLANS,
  VIDEO_NODES,
  MODEL_3D_NODES,
  RENDER_NODES,
} from "./plan-data";
import {
  getEffectiveLimits,
  toPlanKey,
  type LegacyLimits,
  type PlanKey,
} from "./plan-helpers";
import type { Prisma } from "@prisma/client";

// ── Public types ──────────────────────────────────────────────────────────────

export type EligibilityIntent =
  | { kind: "workflow-run"; catalogueIds?: string[]; workflowId?: string | null }
  | { kind: "floor-plan" }
  | { kind: "ifc-parse" }
  | { kind: "brief-render" };

export interface EligibilityBlock {
  type: "plan_limit" | "node_limit" | "workflow_already_executed";
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
  /** Optional secondary CTA (used by workflow_already_executed). */
  secondaryAction?: string;
  secondaryActionUrl?: string;
}

export interface EligibilityCommonFields {
  remaining: number;
  limit: number;
  used: number;
  emailVerified: boolean;
  role: PlanKey;
  bonusRemaining: number;
}

export interface EligibilityOk extends EligibilityCommonFields {
  canExecute: true;
  /** True iff the helper consumed a referral bonus to reach this allow state. */
  usedReferralBonus: boolean;
}

export interface EligibilityBlocked extends EligibilityCommonFields {
  canExecute: false;
  usedReferralBonus: false;
  blocks: EligibilityBlock[];
}

export type EligibilityResult = EligibilityOk | EligibilityBlocked;

export interface CheckOptions {
  /** Atomically consume one referral bonus when the user is at cap. */
  consumeBonusOnCap?: boolean;
}

export interface CheckArgs {
  userId: string;
  /** Role from the JWT — used as a fast-path; DB role overrides if it differs. */
  userRole: string;
  userEmail?: string | null;
  emailVerified: boolean;
  intent: EligibilityIntent;
  options?: CheckOptions;
}

// ── Implementation ────────────────────────────────────────────────────────────

const MAX_INT = Number.MAX_SAFE_INTEGER;

function adminBypass(role: PlanKey, emailVerified: boolean): EligibilityOk {
  return {
    canExecute: true,
    remaining: MAX_INT,
    limit: -1,
    used: 0,
    emailVerified,
    role,
    bonusRemaining: 0,
    usedReferralBonus: false,
  };
}

function monthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

const SCRATCH_WORKFLOW_NAME_LITERAL = "__standalone_tools__";

/**
 * Has the given workflow been executed before (any prior SUCCESS/PARTIAL/
 * RUNNING/PENDING execution row)? Drives the "no double execution" lock.
 *
 * Status semantics:
 *   • SUCCESS / PARTIAL → workflow LOCKED, no re-run
 *   • RUNNING / PENDING → workflow LOCKED (race protection — concurrent re-start blocked)
 *   • FAILED            → workflow UNLOCKED, retry allowed (failure doesn't burn slot)
 *   • CANCELLED         → workflow UNLOCKED, retry allowed
 *
 * The check is skipped for the per-user `__standalone_tools__` scratch
 * workflow (which is shared across many runs by design — floor-plan,
 * cinematic, video, brief-renders, unsaved-canvas, etc).
 *
 * Optionally accepts a Prisma transaction client so the call can be made
 * inside the atomic createExecutionWithCapCheck transaction (must use the
 * same tx that holds the advisory lock to avoid races).
 */
export async function hasWorkflowBeenExecuted(
  workflowId: string,
  client?: Prisma.TransactionClient,
): Promise<{ executed: boolean; lastStatus: string | null; isScratch: boolean }> {
  const c = client ?? prisma;

  // Scratch workflow is exempt from the lock (always allowed).
  const wf = await c.workflow.findUnique({
    where: { id: workflowId },
    select: { name: true },
  });
  if (!wf) return { executed: false, lastStatus: null, isScratch: false };
  if (wf.name === SCRATCH_WORKFLOW_NAME_LITERAL) {
    return { executed: false, lastStatus: null, isScratch: true };
  }

  const row = await c.execution.findFirst({
    where: {
      workflowId,
      status: { in: ["SUCCESS", "PARTIAL", "RUNNING", "PENDING"] },
    },
    select: { status: true },
    orderBy: { createdAt: "desc" },
  });
  return {
    executed: !!row,
    lastStatus: row?.status ?? null,
    isScratch: false,
  };
}

function makeWorkflowAlreadyExecutedBlock(): EligibilityBlock {
  return {
    type: "workflow_already_executed",
    title: "Workflow already executed",
    message:
      "Each saved workflow can be run once. Create a new workflow to execute again, or upgrade your plan for more workflow slots.",
    action: "Create new workflow",
    actionUrl: "/dashboard",
    secondaryAction: "Upgrade plan",
    secondaryActionUrl: "/dashboard/billing",
  };
}

/** Inline ₹ formatter — kept local to avoid a cross-feature import from
 *  `@/features/boq/components/recalc-engine`. Plan prices are ≤ 5 digits
 *  so the simple grouping-locale toLocaleString is enough; we don't need
 *  the L/Cr suffixes the BOQ helper produces. */
function formatINRPrice(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function makeCapBlock(role: PlanKey, limit: number): EligibilityBlock {
  // Tier-specific upgrade copy with concrete pricing from STRIPE_PLANS SSOT.
  // Each tier shows: title (current state) + body (target plan + price) +
  // primary CTA with price suffix + tertiary "View all plans" link.
  if (role === "FREE") {
    const target = STRIPE_PLANS.MINI;
    return {
      type: "plan_limit",
      title: "You've used your free workflow",
      message: `Upgrade to Mini for ${target.limits.runsPerMonth} workflows + ${target.limits.runsPerMonth} executions/month at just ${formatINRPrice(target.price)}.`,
      action: `Upgrade to Mini — ${formatINRPrice(target.price)}/month`,
      actionUrl: "/dashboard/billing?plan=MINI",
      secondaryAction: "View all plans",
      secondaryActionUrl: "/dashboard/billing",
    };
  }
  if (role === "MINI") {
    const target = STRIPE_PLANS.STARTER;
    return {
      type: "plan_limit",
      title: `You've used all ${limit} Mini executions this month`,
      message: `Upgrade to Starter for ${target.limits.runsPerMonth} workflows + executions/month at ${formatINRPrice(target.price)}.`,
      action: `Upgrade to Starter — ${formatINRPrice(target.price)}/month`,
      actionUrl: "/dashboard/billing?plan=STARTER",
      secondaryAction: "View all plans",
      secondaryActionUrl: "/dashboard/billing",
    };
  }
  if (role === "STARTER") {
    const target = STRIPE_PLANS.PRO;
    return {
      type: "plan_limit",
      title: `You've used all ${limit} Starter executions this month`,
      message: `Upgrade to Pro for ${target.limits.runsPerMonth} workflows + executions/month at ${formatINRPrice(target.price)}.`,
      action: `Upgrade to Pro — ${formatINRPrice(target.price)}/month`,
      actionUrl: "/dashboard/billing?plan=PRO",
      secondaryAction: "View all plans",
      secondaryActionUrl: "/dashboard/billing",
    };
  }
  if (role === "PRO") {
    const target = STRIPE_PLANS.TEAM;
    return {
      type: "plan_limit",
      title: `You've used all ${limit} Pro executions this month`,
      message: `Upgrade to Team for ${target.limits.runsPerMonth} workflows + executions/month at ${formatINRPrice(target.price)}.`,
      action: `Upgrade to Team — ${formatINRPrice(target.price)}/month`,
      actionUrl: "/dashboard/billing?plan=TEAM",
      secondaryAction: "View all plans",
      secondaryActionUrl: "/dashboard/billing",
    };
  }
  // TEAM at cap — no plan above; route to support.
  return {
    type: "plan_limit",
    title: `You've used all ${limit} Team executions this month`,
    message:
      "Reach out to support to discuss enterprise plans, or wait until next month's reset.",
    action: "Contact support",
    actionUrl: "mailto:support@buildflow.app",
  };
}

async function getNodeTypeBlocks(
  userId: string,
  role: PlanKey,
  catalogueIds: string[],
): Promise<EligibilityBlock[]> {
  if (!redisConfigured || catalogueIds.length === 0) return [];

  // Widen literal-typed limit values to `number` so the `>= 0` future-proof
  // check (-1 = unlimited) compiles cleanly. The literals in STRIPE_PLANS
  // happen to all be ≥ 0 today, but new plans could introduce -1.
  const rawLimits = STRIPE_PLANS[role]?.limits;
  if (!rawLimits) return [];
  const limits: { videoPerMonth: number; modelsPerMonth: number; rendersPerMonth: number } = {
    videoPerMonth: rawLimits.videoPerMonth,
    modelsPerMonth: rawLimits.modelsPerMonth,
    rendersPerMonth: rawLimits.rendersPerMonth,
  };

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const blocks: EligibilityBlock[] = [];

  const hasVideo = catalogueIds.some((id) => VIDEO_NODES.has(id));
  const has3D = catalogueIds.some((id) => MODEL_3D_NODES.has(id));
  const hasRender = catalogueIds.some((id) => RENDER_NODES.has(id));

  if (hasVideo && limits.videoPerMonth >= 0) {
    const used = (await redis.get<number>(`node-limit:${userId}:video:${monthKey}`)) ?? 0;
    if (limits.videoPerMonth === 0) {
      blocks.push({
        type: "node_limit",
        title: "Video not available",
        message:
          "Video walkthroughs are not available on your current plan. Upgrade to Starter or higher to generate video walkthroughs.",
        action: "Upgrade Plan",
        actionUrl: "/dashboard/billing",
      });
    } else if (used >= limits.videoPerMonth) {
      blocks.push({
        type: "node_limit",
        title: "Video limit reached",
        message: `You've used all ${limits.videoPerMonth} video generations this month.`,
        action: "Upgrade Plan",
        actionUrl: "/dashboard/billing",
      });
    }
  }

  if (has3D && limits.modelsPerMonth >= 0) {
    const used = (await redis.get<number>(`node-limit:${userId}:3d:${monthKey}`)) ?? 0;
    if (limits.modelsPerMonth === 0) {
      blocks.push({
        type: "node_limit",
        title: "3D models not available",
        message:
          "3D model generation is not available on your current plan. Upgrade to Starter or higher.",
        action: "Upgrade Plan",
        actionUrl: "/dashboard/billing",
      });
    } else if (used >= limits.modelsPerMonth) {
      blocks.push({
        type: "node_limit",
        title: "3D model limit reached",
        message: `You've used all ${limits.modelsPerMonth} 3D model generations this month.`,
        action: "Upgrade Plan",
        actionUrl: "/dashboard/billing",
      });
    }
  }

  if (hasRender && limits.rendersPerMonth >= 0) {
    const used = (await redis.get<number>(`node-limit:${userId}:render:${monthKey}`)) ?? 0;
    if (limits.rendersPerMonth === 0) {
      blocks.push({
        type: "node_limit",
        title: "Renders not available",
        message: "Concept renders are not available on your current plan.",
        action: "Upgrade Plan",
        actionUrl: "/dashboard/billing",
      });
    } else if (used >= limits.rendersPerMonth) {
      blocks.push({
        type: "node_limit",
        title: "Render limit reached",
        message: `You've used all ${limits.rendersPerMonth} concept renders this month.`,
        action: "Upgrade Plan",
        actionUrl: "/dashboard/billing",
      });
    }
  }

  return blocks;
}

export async function checkExecutionEligibility(
  args: CheckArgs,
): Promise<EligibilityResult> {
  const isAdminEmail = isAdminUser(args.userEmail ?? undefined);
  const isAdminRole =
    args.userRole === "PLATFORM_ADMIN" || args.userRole === "TEAM_ADMIN";

  if (isAdminEmail || isAdminRole) {
    return adminBypass(toPlanKey(args.userRole), args.emailVerified);
  }

  // Read DB role + legacyLimits + completed-execution count in parallel.
  // DB role wins over JWT role (JWT can be stale up to 15s after a sub change).
  const completedWhere: Prisma.ExecutionWhereInput = {
    userId: args.userId,
    status: { in: ["SUCCESS", "PARTIAL"] },
  };

  // For paid plans we only count this calendar month (monthly cap).
  // For FREE we count lifetime (no created-at filter).
  const jwtPlanKey = toPlanKey(args.userRole);
  const isJwtPaid = jwtPlanKey !== "FREE";
  if (isJwtPaid) {
    completedWhere.createdAt = { gte: monthStart() };
  }

  const [dbUser, completedCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: args.userId },
      select: { role: true, legacyLimits: true, email: true },
    }),
    prisma.execution.count({ where: completedWhere }),
  ]);

  // DB-canonical role check (defends against JWT staleness for both
  // upgrade-just-happened and downgrade-just-happened windows).
  const dbRoleRaw = dbUser?.role ?? args.userRole;
  if (dbRoleRaw === "PLATFORM_ADMIN" || dbRoleRaw === "TEAM_ADMIN") {
    return adminBypass(toPlanKey(dbRoleRaw), args.emailVerified);
  }
  const effectiveRole = toPlanKey(dbRoleRaw);

  // If the JWT role disagreed with DB and we counted with the wrong window
  // (paid → FREE, or FREE → paid), recount with the correct filter.
  let trueCount = completedCount;
  const isDbPaid = effectiveRole !== "FREE";
  if (isDbPaid !== isJwtPaid) {
    const recountWhere: Prisma.ExecutionWhereInput = {
      userId: args.userId,
      status: { in: ["SUCCESS", "PARTIAL"] },
    };
    if (isDbPaid) recountWhere.createdAt = { gte: monthStart() };
    trueCount = await prisma.execution.count({ where: recountWhere });
  }

  const effectiveLimits = getEffectiveLimits(
    effectiveRole,
    (dbUser?.legacyLimits as LegacyLimits | null) ?? null,
  );
  const limit = effectiveLimits.runsPerMonth;
  const remaining =
    limit < 0 ? MAX_INT : Math.max(0, limit - trueCount);

  const blocks: EligibilityBlock[] = [];
  let usedReferralBonus = false;
  let bonusRemaining = await getReferralBonus(args.userId);

  if (limit >= 0 && trueCount >= limit) {
    if (args.options?.consumeBonusOnCap) {
      const consumed = await consumeReferralBonus(args.userId);
      if (consumed) {
        usedReferralBonus = true;
        bonusRemaining = Math.max(0, bonusRemaining - 1);
      } else {
        blocks.push(makeCapBlock(effectiveRole, limit));
      }
    } else {
      blocks.push(makeCapBlock(effectiveRole, limit));
    }
  }

  // Workflow-already-executed lock — if the workflow-run intent carries a
  // workflowId AND that workflow has been run before (any non-FAILED prior
  // execution), short-circuit with a hard block. Scratch workflow is exempt.
  if (
    args.intent.kind === "workflow-run" &&
    args.intent.workflowId &&
    typeof args.intent.workflowId === "string"
  ) {
    const lock = await hasWorkflowBeenExecuted(args.intent.workflowId);
    if (lock.executed && !lock.isScratch) {
      blocks.push(makeWorkflowAlreadyExecutedBlock());
    }
  }

  // Per-node-type limits — only relevant for workflow-run intent.
  if (args.intent.kind === "workflow-run") {
    const nodeBlocks = await getNodeTypeBlocks(
      args.userId,
      effectiveRole,
      args.intent.catalogueIds ?? [],
    );
    blocks.push(...nodeBlocks);
  }

  if (blocks.length > 0) {
    return {
      canExecute: false,
      blocks,
      remaining,
      limit,
      used: trueCount,
      emailVerified: args.emailVerified,
      role: effectiveRole,
      bonusRemaining,
      usedReferralBonus: false,
    };
  }

  return {
    canExecute: true,
    remaining,
    limit,
    used: trueCount,
    emailVerified: args.emailVerified,
    role: effectiveRole,
    bonusRemaining,
    usedReferralBonus,
  };
}

// ── Atomic Execution-row creation with cap check ─────────────────────────────
//
// Wraps eligibility + Execution-row creation in a single Postgres transaction
// guarded by `pg_advisory_xact_lock(hashtext(userId))`. Two simultaneous Run
// clicks from the same user serialize through this lock, so exactly one
// succeeds and the other gets a 429 + plan-limit block. Closes the
// concurrent-tab race that the read-only `checkExecutionEligibility()` helper
// can't address (since count + create are non-atomic without serialization).
//
// The cap query inside the lock uses a "slot-reservation" filter — it counts
// completed runs PLUS recent in-flight rows (PENDING/RUNNING within the last
// 2 hours) so concurrent attempts see each other's reservations. This is
// distinct from the per-node defensive recheck filter (SUCCESS+PARTIAL only),
// which excludes the workflow's own RUNNING row so mid-flight nodes don't
// self-block. Stale in-flight rows (older than 2 h) are ignored to prevent
// abandoned workflows from permanently blocking the user.

const INFLIGHT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export type ExecutionInitialStatus = "PENDING" | "RUNNING" | "SUCCESS" | "PARTIAL";

export interface CreateExecutionArgs {
  userId: string;
  userRole: string;
  userEmail?: string | null;
  emailVerified: boolean;
  intent: EligibilityIntent;
  /** If provided + valid, attaches to this workflow. If absent or invalid,
   *  falls back to the per-user `__standalone_tools__` scratch workflow. */
  workflowId?: string | null;
  /** Initial status. Use RUNNING for ongoing workflow runs, SUCCESS for
   *  one-shot tools that have already completed their work atomically. */
  initialStatus: ExecutionInitialStatus;
  /** Persisted alongside the row — typically `{ tool: "floor-plan", ... }`. */
  metadata?: Record<string, unknown>;
  /** Input summary persisted to tileResults JSON. */
  inputSummary?: unknown;
}

export interface CreateExecutionOk {
  ok: true;
  execution: { id: string; workflowId: string; status: ExecutionInitialStatus };
  usedReferralBonus: boolean;
  bonusRemaining: number;
}

export interface CreateExecutionBlocked {
  ok: false;
  eligibility: EligibilityBlocked;
}

export type CreateExecutionResult = CreateExecutionOk | CreateExecutionBlocked;

export class CapExceededError extends Error {
  constructor(public eligibility: EligibilityBlocked) {
    super(eligibility.blocks[0]?.message ?? "Plan cap exceeded");
    this.name = "CapExceededError";
  }
}

export async function createExecutionWithCapCheck(
  args: CreateExecutionArgs,
): Promise<CreateExecutionResult> {
  const isAdminEmail = isAdminUser(args.userEmail ?? undefined);
  const isAdminRole =
    args.userRole === "PLATFORM_ADMIN" || args.userRole === "TEAM_ADMIN";
  const isAdmin = isAdminEmail || isAdminRole;

  // ── 1. Resolve workflow id (read-only, outside lock) ──────────────────────
  let resolvedWorkflowId: string;
  if (args.workflowId) {
    const wf = await prisma.workflow.findFirst({
      where: { id: args.workflowId, ownerId: args.userId, deletedAt: null },
      select: { id: true },
    });
    if (!wf) {
      // Provided workflow doesn't belong to user — fall back to scratch so we
      // never silently fail (the row creation still happens, attached to the
      // user's per-user `__standalone_tools__`). The caller can compare the
      // returned workflowId to detect this.
      resolvedWorkflowId = await getOrCreateScratchWorkflow(args.userId);
    } else {
      resolvedWorkflowId = wf.id;
    }
  } else {
    resolvedWorkflowId = await getOrCreateScratchWorkflow(args.userId);
  }

  // ── 2. Cap-check + row-creation (no interactive transaction) ─────────────
  //
  // Original design used `prisma.$transaction(async (tx) => ...)` with
  // `pg_advisory_xact_lock` for cross-process serialization. That broke on
  // production: Neon's pgbouncer-pooled connections do not reliably support
  // Prisma's interactive transactions, AND `pg_advisory_xact_lock(int4)` is
  // not a valid signature (the function takes int8 or int4+int4). The
  // transaction throws, the route's outer catch returns 500, the client
  // never sets dbExecutionId, and NO Execution row is ever created → the
  // FREE-tier cap silently never trips. This was the smoking-gun bug
  // observed in production where `count(SUCCESS+PARTIAL) = 0` even after
  // the user successfully completed multiple workflow runs.
  //
  // New design: drop the interactive transaction. Read user role + count
  // in parallel, do the cap check, then a non-transactional insert. The
  // slot-reservation count (completed + recent PENDING/RUNNING) means a
  // concurrent second tab will see the first tab's RUNNING row from its
  // own /api/executions POST and block. Race window is ~10 ms between
  // count and insert; under heavy concurrent abuse a single user could
  // exceed the cap by 1 (off-by-one). Acceptable trade-off vs the
  // production-blocking bug.
  //
  // Per-node defensive recheck in /api/execute-node still fires on every
  // node call (see GAP #2 §J), so the cap is enforced at multiple layers.
  try {
    // Admins skip cap — read role from DB to defend against stale JWT.
    const dbUser = await prisma.user.findUnique({
      where: { id: args.userId },
      select: { role: true, legacyLimits: true },
    });
    const dbRole = dbUser?.role ?? args.userRole;
    const dbIsAdminRole = dbRole === "PLATFORM_ADMIN" || dbRole === "TEAM_ADMIN";

    if (isAdmin || dbIsAdminRole) {
      const created = await prisma.execution.create({
        data: {
          workflowId: resolvedWorkflowId,
          userId: args.userId,
          status: args.initialStatus,
          startedAt: new Date(),
          ...(args.initialStatus === "SUCCESS" || args.initialStatus === "PARTIAL"
            ? { completedAt: new Date() }
            : {}),
          ...(args.metadata ? { metadata: args.metadata as Prisma.InputJsonValue } : {}),
          ...(args.inputSummary !== undefined && args.inputSummary !== null
            ? { tileResults: { inputSummary: args.inputSummary } as Prisma.InputJsonValue }
            : {}),
        },
        select: { id: true, workflowId: true, status: true },
      });
      return {
        ok: true,
        execution: {
          id: created.id,
          workflowId: created.workflowId,
          status: created.status as ExecutionInitialStatus,
        },
        usedReferralBonus: false,
        bonusRemaining: 0,
      } as CreateExecutionOk;
    }

    // Compute effective limits — DB-canonical role beats JWT.
    const effectiveRole = toPlanKey(dbRole);
    const effectiveLimits = getEffectiveLimits(
      effectiveRole,
      (dbUser?.legacyLimits as LegacyLimits | null) ?? null,
    );
    const limit = effectiveLimits.runsPerMonth;

    // Workflow-already-executed lock. Skipped for scratch workflow.
    const lockCheck = await hasWorkflowBeenExecuted(resolvedWorkflowId);
    if (lockCheck.executed && !lockCheck.isScratch) {
      const block = makeWorkflowAlreadyExecutedBlock();
      return {
        ok: false,
        eligibility: {
          canExecute: false,
          blocks: [block],
          remaining: 0,
          limit,
          used: 0,
          emailVerified: args.emailVerified,
          role: effectiveRole,
          bonusRemaining: 0,
          usedReferralBonus: false,
        },
      } as CreateExecutionBlocked;
    }

    // Slot-reservation count: completed runs + recent in-flight rows.
    const inflightCutoff = new Date(Date.now() - INFLIGHT_TTL_MS);
    const isPaid = effectiveRole !== "FREE";

    const completedFilter: Prisma.ExecutionWhereInput = {
      status: { in: ["SUCCESS", "PARTIAL"] },
      ...(isPaid ? { createdAt: { gte: monthStart() } } : {}),
    };
    const inflightFilter: Prisma.ExecutionWhereInput = {
      status: { in: ["PENDING", "RUNNING"] },
      createdAt: { gte: inflightCutoff },
    };

    const slotsUsed = await prisma.execution.count({
      where: {
        userId: args.userId,
        OR: [completedFilter, inflightFilter],
      },
    });

    let usedReferralBonus = false;
    let bonusRemaining = await getReferralBonus(args.userId);

    if (limit >= 0 && slotsUsed >= limit) {
      // At cap — try referral bonus before blocking.
      const consumed = await consumeReferralBonus(args.userId);
      if (!consumed) {
        const block = makeCapBlock(effectiveRole, limit);
        return {
          ok: false,
          eligibility: {
            canExecute: false,
            blocks: [block],
            remaining: 0,
            limit,
            used: slotsUsed,
            emailVerified: args.emailVerified,
            role: effectiveRole,
            bonusRemaining,
            usedReferralBonus: false,
          },
        } as CreateExecutionBlocked;
      }
      usedReferralBonus = true;
      bonusRemaining = Math.max(0, bonusRemaining - 1);
    }

    const created = await prisma.execution.create({
      data: {
        workflowId: resolvedWorkflowId,
        userId: args.userId,
        status: args.initialStatus,
        startedAt: new Date(),
        ...(args.initialStatus === "SUCCESS" || args.initialStatus === "PARTIAL"
          ? { completedAt: new Date() }
          : {}),
        ...(args.metadata ? { metadata: args.metadata as Prisma.InputJsonValue } : {}),
        ...(args.inputSummary !== undefined && args.inputSummary !== null
          ? { tileResults: { inputSummary: args.inputSummary } as Prisma.InputJsonValue }
          : {}),
      },
      select: { id: true, workflowId: true, status: true },
    });

    return {
      ok: true,
      execution: {
        id: created.id,
        workflowId: created.workflowId,
        status: created.status as ExecutionInitialStatus,
      },
      usedReferralBonus,
      bonusRemaining,
    } as CreateExecutionOk;
  } catch (err) {
    // Surface diagnostics so future failures are debuggable from Vercel logs.
    console.error(
      `[createExecutionWithCapCheck] user=${args.userId} workflowId=${args.workflowId ?? "<scratch>"} failed:`,
      err instanceof Error ? `${err.name}: ${err.message}` : err,
    );
    throw err;
  }
}

// ── Scratch workflow helper ───────────────────────────────────────────────────
//
// Some run paths can't link to a user-saved Workflow row (e.g. unsaved canvas
// when the user is at maxWorkflows cap, or standalone tools like floor-plan
// generate). To keep the Execution table the single source of truth for usage
// counting, we route those runs against a per-user "scratch" Workflow named
// `__standalone_tools__` (hidden from the My Workflows list — see the name
// filter in /api/workflows GET).
//
// Idempotent and safe to call from any execution-creation path.

const SCRATCH_WORKFLOW_NAME = "__standalone_tools__";

export async function getOrCreateScratchWorkflow(
  userId: string,
): Promise<string> {
  const existing = await prisma.workflow.findFirst({
    where: { ownerId: userId, name: SCRATCH_WORKFLOW_NAME, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Un-delete any soft-deleted scratch workflow (legacy cleanup).
  const legacy = await prisma.workflow.findFirst({
    where: { ownerId: userId, name: SCRATCH_WORKFLOW_NAME },
    select: { id: true },
  });
  if (legacy) {
    const restored = await prisma.workflow.update({
      where: { id: legacy.id },
      data: { deletedAt: null },
      select: { id: true },
    });
    return restored.id;
  }

  const created = await prisma.workflow.create({
    data: {
      ownerId: userId,
      name: SCRATCH_WORKFLOW_NAME,
      description:
        "Auto-created for unsaved-canvas runs and standalone tool usage.",
    },
    select: { id: true },
  });
  return created.id;
}
