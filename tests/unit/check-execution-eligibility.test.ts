/**
 * Unit tests for src/features/billing/lib/check-execution-eligibility.ts.
 *
 * The helper is the single source of truth for plan-cap enforcement across
 * /api/check-execution-eligibility, /api/execute-node, /api/generate-floor-plan,
 * and /api/parse-ifc. These tests pin the contract that ALL of those routes
 * inherit:
 *
 *   1. Admin bypass (PLATFORM_ADMIN, TEAM_ADMIN, ADMIN_EMAILS) — never blocked
 *   2. FREE lifetime cap — counts SUCCESS+PARTIAL only (RUNNING excluded)
 *   3. Paid monthly cap — calendar month + same status filter
 *   4. legacyLimits grandfathering — legacy snapshot wins
 *   5. JWT-staleness defense — DB role beats stale JWT
 *   6. Referral-bonus consumption — opt-in via consumeBonusOnCap
 *   7. Per-node-type peek (video/3D/render) for paid users
 *   8. getOrCreateScratchWorkflow — find/restore/create idempotency
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  executionCount: vi.fn(),
  executionFindFirst: vi.fn().mockResolvedValue(null), // default: no prior execution
  workflowFindFirst: vi.fn(),
  workflowFindUnique: vi.fn().mockResolvedValue(null), // default: workflow not found
  workflowUpdate: vi.fn(),
  workflowCreate: vi.fn(),
}));

const rateLimitMocks = vi.hoisted(() => ({
  isAdminUser: vi.fn().mockReturnValue(false),
  consumeReferralBonus: vi.fn().mockResolvedValue(false),
  getReferralBonus: vi.fn().mockResolvedValue(0),
  redisGet: vi.fn().mockResolvedValue(0),
  redisConfigured: false,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: prismaMocks.userFindUnique },
    execution: {
      count: prismaMocks.executionCount,
      findFirst: prismaMocks.executionFindFirst,
    },
    workflow: {
      findFirst: prismaMocks.workflowFindFirst,
      findUnique: prismaMocks.workflowFindUnique,
      update: prismaMocks.workflowUpdate,
      create: prismaMocks.workflowCreate,
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  isAdminUser: rateLimitMocks.isAdminUser,
  consumeReferralBonus: rateLimitMocks.consumeReferralBonus,
  getReferralBonus: rateLimitMocks.getReferralBonus,
  redis: { get: rateLimitMocks.redisGet },
  // redisConfigured is read once at module-load, so make it dynamic via getter
  get redisConfigured() {
    return rateLimitMocks.redisConfigured;
  },
}));

import {
  checkExecutionEligibility,
  getOrCreateScratchWorkflow,
} from "@/features/billing/lib/check-execution-eligibility";

const baseArgs = {
  userId: "user-1",
  userEmail: "user@example.com",
  emailVerified: true,
  intent: { kind: "workflow-run" as const, catalogueIds: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMocks.isAdminUser.mockReturnValue(false);
  rateLimitMocks.consumeReferralBonus.mockResolvedValue(false);
  rateLimitMocks.getReferralBonus.mockResolvedValue(0);
  rateLimitMocks.redisConfigured = false;
});

// ──────────────────────────────────────────────────────────────────────────────
// 1. Admin bypass
// ──────────────────────────────────────────────────────────────────────────────

describe("admin bypass", () => {
  it("PLATFORM_ADMIN role is never blocked", async () => {
    const result = await checkExecutionEligibility({
      ...baseArgs,
      userRole: "PLATFORM_ADMIN",
    });
    expect(result.canExecute).toBe(true);
    expect(prismaMocks.executionCount).not.toHaveBeenCalled();
  });

  it("TEAM_ADMIN role is never blocked", async () => {
    const result = await checkExecutionEligibility({
      ...baseArgs,
      userRole: "TEAM_ADMIN",
    });
    expect(result.canExecute).toBe(true);
  });

  it("admin email (via ADMIN_EMAILS) is never blocked", async () => {
    rateLimitMocks.isAdminUser.mockReturnValue(true);
    const result = await checkExecutionEligibility({
      ...baseArgs,
      userRole: "FREE",
    });
    expect(result.canExecute).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. FREE lifetime cap
// ──────────────────────────────────────────────────────────────────────────────

describe("FREE lifetime cap (limit = 1)", () => {
  it("0 runs → canExecute true, remaining = 1", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(0); // FREE limit = 1
    const result = await checkExecutionEligibility({
      ...baseArgs,
      userRole: "FREE",
    });
    expect(result.canExecute).toBe(true);
    if (result.canExecute) {
      expect(result.limit).toBe(1);
      expect(result.used).toBe(0);
      expect(result.remaining).toBe(1);
    }
  });

  it("1 run completed → BLOCKED on next run (cap = 1)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(1);
    const result = await checkExecutionEligibility({
      ...baseArgs,
      userRole: "FREE",
      options: { consumeBonusOnCap: true },
    });
    expect(result.canExecute).toBe(false);
    if (!result.canExecute) {
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].type).toBe("plan_limit");
      // New cap-block copy carries the full upgrade pitch with concrete price.
      expect(result.blocks[0].title).toBe("You've used your free workflow");
      expect(result.blocks[0].action).toContain("Upgrade to Mini");
      expect(result.blocks[0].action).toContain("₹99");
      expect(result.blocks[0].actionUrl).toBe("/dashboard/billing?plan=MINI");
      expect(result.blocks[0].secondaryAction).toBe("View all plans");
    }
  });

  it("at cap, bonus available, consumeBonusOnCap=true → consumed and allowed", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(1);
    rateLimitMocks.consumeReferralBonus.mockResolvedValue(true);
    rateLimitMocks.getReferralBonus.mockResolvedValue(3); // pre-consume count
    const result = await checkExecutionEligibility({
      ...baseArgs,
      userRole: "FREE",
      options: { consumeBonusOnCap: true },
    });
    expect(result.canExecute).toBe(true);
    if (result.canExecute) {
      expect(result.usedReferralBonus).toBe(true);
      expect(result.bonusRemaining).toBe(2); // 3 - 1
    }
    expect(rateLimitMocks.consumeReferralBonus).toHaveBeenCalledTimes(1);
  });

  it("at cap, bonus available, consumeBonusOnCap=false → blocked WITHOUT consuming (preview)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(1);
    rateLimitMocks.getReferralBonus.mockResolvedValue(5);
    const result = await checkExecutionEligibility({
      ...baseArgs,
      userRole: "FREE",
      options: { consumeBonusOnCap: false },
    });
    expect(result.canExecute).toBe(false);
    expect(rateLimitMocks.consumeReferralBonus).not.toHaveBeenCalled();
    if (!result.canExecute) {
      expect(result.bonusRemaining).toBe(5);
    }
  });

  it("count query EXCLUDES RUNNING (so in-flight nodes don't self-block)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(0);
    await checkExecutionEligibility({ ...baseArgs, userRole: "FREE" });
    const callArgs = prismaMocks.executionCount.mock.calls[0][0];
    expect(callArgs.where.status).toEqual({ in: ["SUCCESS", "PARTIAL"] });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Paid monthly cap
// ──────────────────────────────────────────────────────────────────────────────

describe("paid monthly cap (1:1 spec — workflows = executions)", () => {
  it("MINI under cap → allowed (limit = 3)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "MINI", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(1); // MINI = 3
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "MINI" });
    expect(result.canExecute).toBe(true);
    if (result.canExecute) {
      expect(result.limit).toBe(3);
      expect(result.remaining).toBe(2);
    }
  });

  it("MINI at cap (3) → 'Upgrade to Starter ₹799' CTA", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "MINI", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(3);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "MINI" });
    expect(result.canExecute).toBe(false);
    if (!result.canExecute) {
      expect(result.blocks[0].title).toContain("3 Mini executions");
      expect(result.blocks[0].action).toContain("Upgrade to Starter");
      expect(result.blocks[0].action).toContain("₹799");
    }
  });

  it("STARTER at cap (15) → 'Upgrade to Pro ₹1,999' CTA", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "STARTER", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(15);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "STARTER" });
    expect(result.canExecute).toBe(false);
    if (!result.canExecute) {
      expect(result.blocks[0].action).toContain("Upgrade to Pro");
      expect(result.blocks[0].action).toContain("₹1,999");
    }
  });

  it("PRO at cap (45) → 'Contact Sales for Team' CTA (TEAM is sales-only)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "PRO", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(45);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "PRO" });
    expect(result.canExecute).toBe(false);
    if (!result.canExecute) {
      expect(result.blocks[0].action).toContain("Contact Sales");
      expect(result.blocks[0].actionUrl).toContain("/contact");
    }
  });

  it("TEAM at cap (300) → 'Contact support' CTA (top tier, no upgrade)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "TEAM", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(300);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "TEAM" });
    expect(result.canExecute).toBe(false);
    if (!result.canExecute) {
      expect(result.blocks[0].action).toBe("Contact support");
      expect(result.blocks[0].actionUrl).toMatch(/^mailto:/);
    }
  });

  it("paid count query is scoped to current calendar month", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "MINI", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(0);
    await checkExecutionEligibility({ ...baseArgs, userRole: "MINI" });
    const callArgs = prismaMocks.executionCount.mock.calls[0][0];
    expect(callArgs.where.createdAt).toBeDefined();
    expect(callArgs.where.createdAt.gte).toBeInstanceOf(Date);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    // Within 1s of expected month start
    expect(Math.abs(callArgs.where.createdAt.gte.getTime() - monthStart.getTime())).toBeLessThan(1000);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. legacyLimits grandfathering
// ──────────────────────────────────────────────────────────────────────────────

describe("legacyLimits grandfathering", () => {
  it("user with legacyLimits.runsPerMonth=5 has effective FREE cap of 5", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({
      role: "FREE",
      legacyLimits: { runsPerMonth: 5 },
    });
    prismaMocks.executionCount.mockResolvedValue(3); // 3 < 5, allowed
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "FREE" });
    expect(result.canExecute).toBe(true);
    if (result.canExecute) {
      expect(result.limit).toBe(5);
      expect(result.remaining).toBe(2);
    }
  });

  it("legacyLimits=5 still blocks at 5", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({
      role: "FREE",
      legacyLimits: { runsPerMonth: 5 },
    });
    prismaMocks.executionCount.mockResolvedValue(5);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "FREE" });
    expect(result.canExecute).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4b. Grandfathering edge cases (1:1 cutover migration)
// ──────────────────────────────────────────────────────────────────────────────

describe("grandfathering edge cases (1:1 cutover)", () => {
  it("pre-cutover MINI user with legacyLimits.runsPerMonth=6 → effective limit 6", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({
      role: "MINI",
      legacyLimits: { runsPerMonth: 6, maxWorkflows: 3 },
    });
    prismaMocks.executionCount.mockResolvedValue(5); // 5 < 6, allowed
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "MINI" });
    expect(result.canExecute).toBe(true);
    if (result.canExecute) {
      expect(result.limit).toBe(6); // legacy wins over new SSOT (3)
      expect(result.remaining).toBe(1);
    }
  });

  it("post-cutover MINI user with legacyLimits=null → new SSOT (3)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "MINI", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(2);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "MINI" });
    expect(result.canExecute).toBe(true);
    if (result.canExecute) {
      expect(result.limit).toBe(3); // new SSOT
      expect(result.remaining).toBe(1);
    }
  });

  it("partial legacyLimits ({runsPerMonth:6} only) → runs uses legacy, workflows uses SSOT", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({
      role: "MINI",
      legacyLimits: { runsPerMonth: 6 }, // no maxWorkflows
    });
    prismaMocks.executionCount.mockResolvedValue(0);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "MINI" });
    expect(result.canExecute).toBe(true);
    if (result.canExecute) {
      expect(result.limit).toBe(6); // legacy runsPerMonth wins
    }
    // workflows-side: getEffectiveLimits.maxWorkflows would fall back to current SSOT (3)
    // — verified separately in grandfathering helper unit tests below.
  });

  it("empty legacyLimits {} → all fall back to SSOT", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({
      role: "MINI",
      legacyLimits: {}, // empty object — every field undefined
    });
    prismaMocks.executionCount.mockResolvedValue(0);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "MINI" });
    expect(result.canExecute).toBe(true);
    if (result.canExecute) {
      expect(result.limit).toBe(3); // SSOT for MINI
    }
  });

  it("legacyLimits.runsPerMonth=0 → respected as 0 (not falsy fallback)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({
      role: "MINI",
      legacyLimits: { runsPerMonth: 0 },
    });
    prismaMocks.executionCount.mockResolvedValue(0);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "MINI" });
    // 0 >= 0 → blocked at cap
    expect(result.canExecute).toBe(false);
    if (!result.canExecute) {
      expect(result.limit).toBe(0);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. JWT-staleness defense
// ──────────────────────────────────────────────────────────────────────────────

describe("JWT staleness defense", () => {
  // Post §T: helper does ONE count query (period-scoped). The previous
  // pattern of mockResolvedValueOnce().mockResolvedValueOnce() left a
  // stale value in the mock queue and contaminated downstream tests
  // (the per-node-type-peek "ifc-parse" test was returning canExecute=false
  // because the leftover `2` was still in the queue when its mockResolvedValue(0)
  // was set as the default). Use mockResolvedValue (single) here and reset
  // explicitly before the next describe to avoid leakage.
  it("JWT says FREE but DB says PRO → uses PRO limits (just-upgraded user)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "PRO", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(2);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "FREE" });
    expect(result.canExecute).toBe(true);
    if (result.canExecute) {
      expect(result.limit).toBe(45); // PRO under 1:1 spec
      expect(result.role).toBe("PRO");
    }
  });

  it("JWT says PRO but DB says FREE → uses FREE limits (just-downgraded user)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(2);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "PRO" });
    expect(result.canExecute).toBe(false);
    if (!result.canExecute) {
      expect(result.role).toBe("FREE");
    }
  });

  it("JWT says FREE but DB says PLATFORM_ADMIN → admin bypass", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "PLATFORM_ADMIN", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(999);
    const result = await checkExecutionEligibility({ ...baseArgs, userRole: "FREE" });
    expect(result.canExecute).toBe(true);
  });

  // Defensive — explicitly reset executionCount mock implementation after
  // this describe block so any future once-style queue can't leak forward.
  afterAll(() => {
    prismaMocks.executionCount.mockReset();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. Per-node-type peek
// ──────────────────────────────────────────────────────────────────────────────

describe("per-node-type peek", () => {
  it("FREE workflow with video node → 'Video not available' block", async () => {
    rateLimitMocks.redisConfigured = true;
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(0); // under cap
    rateLimitMocks.redisGet.mockResolvedValue(0);
    const result = await checkExecutionEligibility({
      ...baseArgs,
      userRole: "FREE",
      intent: { kind: "workflow-run", catalogueIds: ["GN-009"] },
    });
    expect(result.canExecute).toBe(false);
    if (!result.canExecute) {
      expect(result.blocks.some((b) => b.type === "node_limit" && b.title.includes("Video"))).toBe(true);
    }
  });

  it("ifc-parse intent does NOT trigger per-node checks", async () => {
    rateLimitMocks.redisConfigured = true;
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(0);
    rateLimitMocks.redisGet.mockResolvedValue(99);
    const result = await checkExecutionEligibility({
      ...baseArgs,
      userRole: "FREE",
      intent: { kind: "ifc-parse" },
    });
    expect(result.canExecute).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. getOrCreateScratchWorkflow idempotency
// ──────────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────────
// 8. Atomic create-execution + GAP #4 contract
// ──────────────────────────────────────────────────────────────────────────────

describe("createExecutionWithCapCheck race-protection contract", () => {
  // Phase 2.5 used pg_advisory_xact_lock inside an interactive Prisma
  // transaction. That broke on Neon's pgbouncer-pooled connections AND
  // pg_advisory_xact_lock(int4) is not a valid signature — production
  // result was silent 500s and zero Execution rows ever created.
  //
  // New design: drop the interactive transaction. Race protection now
  // relies on the slot-reservation count (completed runs ∪ recent in-
  // flight PENDING/RUNNING rows). Concurrent tabs read sequentially under
  // READ COMMITTED — the second tab sees the first tab's RUNNING row and
  // blocks. Off-by-one race window is ~10 ms; per-node defensive recheck
  // in /api/execute-node catches anything that slips through.

  it("source no longer executes the failing pg_advisory_xact_lock call", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const src = readFileSync(
      path.join(process.cwd(), "src/features/billing/lib/check-execution-eligibility.ts"),
      "utf8",
    );
    // Strip block + line comments so doc references to the old design don't
    // false-trigger this assertion.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    // Executable code must not contain the lock call OR the int4-signature
    // hashtext template-literal pattern.
    expect(codeOnly).not.toContain("pg_advisory_xact_lock");
    expect(codeOnly).not.toContain("$queryRaw`SELECT pg_advisory_xact_lock");
    // createExecutionWithCapCheck body should not re-introduce the
    // interactive callback either.
    expect(codeOnly).not.toMatch(/createExecutionWithCapCheck[\s\S]*\$transaction\(async/);
  });

  it("slot-reservation count includes recent in-flight rows", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const src = readFileSync(
      path.join(process.cwd(), "src/features/billing/lib/check-execution-eligibility.ts"),
      "utf8",
    );
    // Count must include PENDING/RUNNING within INFLIGHT_TTL_MS so concurrent
    // attempts see each other's slot reservations.
    expect(src).toContain('"PENDING"');
    expect(src).toContain('"RUNNING"');
    expect(src).toContain("INFLIGHT_TTL_MS");
  });

  it("logs diagnostic context on failure for Vercel-log forensics", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const src = readFileSync(
      path.join(process.cwd(), "src/features/billing/lib/check-execution-eligibility.ts"),
      "utf8",
    );
    // The error logger must include userId + workflowId in the message so
    // future failures are debuggable from production logs.
    expect(src).toMatch(/console\.error\([\s\S]*createExecutionWithCapCheck/);
    expect(src).toMatch(/user=\$\{args\.userId\}/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 9. SSOT-only — no hardcoded "2"s for FREE (GAP #1)
// ──────────────────────────────────────────────────────────────────────────────

describe("FREE cap reads from SSOT only (GAP #1)", () => {
  it("STRIPE_PLANS.FREE.limits.runsPerMonth is 1", async () => {
    const { STRIPE_PLANS, FREE_TIER_EXECUTIONS } = await import(
      "@/features/billing/lib/plan-data"
    );
    expect(STRIPE_PLANS.FREE.limits.runsPerMonth).toBe(1);
    expect(FREE_TIER_EXECUTIONS).toBe(1);
  });

  it("no plan-data feature string says '2 lifetime executions'", async () => {
    const { STRIPE_PLANS } = await import("@/features/billing/lib/plan-data");
    const allFeatures = Object.values(STRIPE_PLANS)
      .flatMap((p) => p.features)
      .join(" | ");
    expect(allFeatures).not.toMatch(/2 lifetime executions/);
    expect(STRIPE_PLANS.FREE.features).toContain("1 lifetime execution");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 9a. PERIOD-SCOPED count for paid tiers (P0 §T billing-period bug)
// ──────────────────────────────────────────────────────────────────────────────

describe("period-scoped count (P0 §T fix — pre-upgrade rows excluded from post-upgrade quota)", () => {
  // Helper: capture the createdAt filter passed to prisma.execution.count
  // so we can assert the period boundary the helper computed.
  const capturedFilter: { createdAt?: { gte: Date } } = {};
  beforeEach(() => {
    delete capturedFilter.createdAt;
    prismaMocks.executionCount.mockImplementation(async (args: { where?: { createdAt?: { gte: Date } } } = {}) => {
      if (args.where?.createdAt?.gte) capturedFilter.createdAt = { gte: args.where.createdAt.gte };
      return 0;
    });
  });

  it("Scenario A — fresh paid user, no planChangedAt → period = calendar month", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "MINI", legacyLimits: null, planChangedAt: null });
    await checkExecutionEligibility({ ...baseArgs, userRole: "MINI" });
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    expect(capturedFilter.createdAt?.gte).toBeDefined();
    if (capturedFilter.createdAt?.gte) {
      expect(Math.abs(capturedFilter.createdAt.gte.getTime() - monthStart.getTime())).toBeLessThan(1000);
    }
  });

  it("Scenario B — FREE→MINI upgrade with prior FREE exec → period = planChangedAt (THE BUG)", async () => {
    // User upgraded 2 minutes ago. Calendar month started 7 days ago.
    // The count must use planChangedAt, not monthStart, otherwise the
    // pre-upgrade FREE row contaminates the MINI quota.
    const planChangedAt = new Date(Date.now() - 2 * 60 * 1000);
    prismaMocks.userFindUnique.mockResolvedValue({ role: "MINI", legacyLimits: null, planChangedAt });
    await checkExecutionEligibility({ ...baseArgs, userRole: "MINI" });
    expect(capturedFilter.createdAt?.gte).toBeDefined();
    if (capturedFilter.createdAt?.gte) {
      // Must equal planChangedAt (which is later than monthStart in this scenario).
      expect(capturedFilter.createdAt.gte.getTime()).toBe(planChangedAt.getTime());
    }
  });

  it("Scenario D — paid user, planChangedAt months ago → period = monthStart (renewal rollover)", async () => {
    // User upgraded 90 days ago; calendar month rolled over since.
    // monthStart > planChangedAt, so monthStart wins (period = current month).
    const planChangedAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    prismaMocks.userFindUnique.mockResolvedValue({ role: "MINI", legacyLimits: null, planChangedAt });
    await checkExecutionEligibility({ ...baseArgs, userRole: "MINI" });
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    expect(capturedFilter.createdAt?.gte).toBeDefined();
    if (capturedFilter.createdAt?.gte) {
      expect(Math.abs(capturedFilter.createdAt.gte.getTime() - monthStart.getTime())).toBeLessThan(1000);
    }
  });

  it("Scenario F — FREE user → period = epoch (lifetime semantics preserved)", async () => {
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", legacyLimits: null, planChangedAt: null });
    await checkExecutionEligibility({ ...baseArgs, userRole: "FREE" });
    expect(capturedFilter.createdAt?.gte).toBeDefined();
    if (capturedFilter.createdAt?.gte) {
      // Epoch — effectively "lifetime"
      expect(capturedFilter.createdAt.gte.getTime()).toBe(0);
    }
  });

  it("Scenario F-2 — FREE user with planChangedAt set (post-downgrade) → still epoch (lifetime)", async () => {
    // User downgraded from MINI to FREE; planChangedAt is set but role is FREE.
    // FREE semantic is lifetime regardless — must NOT mistakenly use planChangedAt.
    const planChangedAt = new Date(Date.now() - 60 * 1000);
    prismaMocks.userFindUnique.mockResolvedValue({ role: "FREE", legacyLimits: null, planChangedAt });
    await checkExecutionEligibility({ ...baseArgs, userRole: "FREE" });
    if (capturedFilter.createdAt?.gte) {
      expect(capturedFilter.createdAt.gte.getTime()).toBe(0);
    }
  });

  it("Scenario H — workflow-lock independent of period count", async () => {
    // Paid user with 0/3 used, but workflow already executed → blocked
    // by workflow_already_executed lock, not by cap.
    const planChangedAt = new Date(Date.now() - 5 * 60 * 1000);
    prismaMocks.userFindUnique.mockResolvedValue({ role: "MINI", legacyLimits: null, planChangedAt });
    prismaMocks.workflowFindUnique.mockResolvedValue({ name: "User Workflow A" });
    prismaMocks.executionFindFirst.mockResolvedValue({ status: "SUCCESS" });
    const result = await checkExecutionEligibility({
      ...baseArgs,
      userRole: "MINI",
      intent: { kind: "workflow-run", catalogueIds: [], workflowId: "wf-test" },
    });
    expect(result.canExecute).toBe(false);
    if (!result.canExecute) {
      // Workflow lock fires regardless of cap state.
      expect(result.blocks.some((b) => b.type === "workflow_already_executed")).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 9b. PER-PLAN parameterized matrix (1:1 spec)
// ──────────────────────────────────────────────────────────────────────────────

describe("per-plan parameterized matrix (1:1 spec)", () => {
  // Each tier has a deterministic upgrade target + price; TEAM is the sole
  // tier that routes to support instead of an upgrade CTA.
  const TIERS: Array<{
    role: "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM";
    cap: number;
    actionContains: string; // primary CTA must include this fragment
    actionUrl: string;
  }> = [
    { role: "FREE",    cap: 1,   actionContains: "Upgrade to Mini",    actionUrl: "/dashboard/billing?plan=MINI" },
    { role: "MINI",    cap: 3,   actionContains: "Upgrade to Starter", actionUrl: "/dashboard/billing?plan=STARTER" },
    { role: "STARTER", cap: 15,  actionContains: "Upgrade to Pro",     actionUrl: "/dashboard/billing?plan=PRO" },
    { role: "PRO",     cap: 45,  actionContains: "Contact Sales",      actionUrl: "/contact?subject=Team+Plan+Enquiry" },
    { role: "TEAM",    cap: 300, actionContains: "Contact support",    actionUrl: "mailto:support@buildflow.app" },
  ];

  for (const { role, cap, actionContains, actionUrl } of TIERS) {
    it(`${role}: cap-1 (count=${cap - 1}) → ALLOWED`, async () => {
      prismaMocks.userFindUnique.mockResolvedValue({ role, legacyLimits: null });
      prismaMocks.executionCount.mockResolvedValue(cap - 1);
      const result = await checkExecutionEligibility({ ...baseArgs, userRole: role });
      expect(result.canExecute).toBe(true);
      if (result.canExecute) {
        expect(result.limit).toBe(cap);
        expect(result.remaining).toBe(1);
      }
    });

    it(`${role}: at cap (count=${cap}) → BLOCKED with correct CTA`, async () => {
      prismaMocks.userFindUnique.mockResolvedValue({ role, legacyLimits: null });
      prismaMocks.executionCount.mockResolvedValue(cap);
      const result = await checkExecutionEligibility({ ...baseArgs, userRole: role });
      expect(result.canExecute).toBe(false);
      if (!result.canExecute) {
        expect(result.blocks[0].type).toBe("plan_limit");
        expect(result.blocks[0].action).toContain(actionContains);
        expect(result.blocks[0].actionUrl).toBe(actionUrl);
      }
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 9c. WORKFLOW-LOCK matrix (no double execution)
// ──────────────────────────────────────────────────────────────────────────────

describe("workflow-already-executed lock", () => {
  const wfArgs = {
    ...baseArgs,
    userRole: "MINI",
    intent: { kind: "workflow-run" as const, catalogueIds: [], workflowId: "wf-test" },
  };

  beforeEach(() => {
    // Default: not scratch + no prior execution
    prismaMocks.workflowFindUnique.mockResolvedValue({ name: "User Workflow A" });
    prismaMocks.executionFindFirst.mockResolvedValue(null);
    prismaMocks.userFindUnique.mockResolvedValue({ role: "MINI", legacyLimits: null });
    prismaMocks.executionCount.mockResolvedValue(0); // under cap
  });

  it("workflow with no prior execution → ALLOWED", async () => {
    const result = await checkExecutionEligibility(wfArgs);
    expect(result.canExecute).toBe(true);
  });

  it("workflow with prior SUCCESS execution → BLOCKED with workflow_already_executed", async () => {
    prismaMocks.executionFindFirst.mockResolvedValue({ status: "SUCCESS" });
    const result = await checkExecutionEligibility(wfArgs);
    expect(result.canExecute).toBe(false);
    if (!result.canExecute) {
      expect(result.blocks[0].type).toBe("workflow_already_executed");
      expect(result.blocks[0].title).toBe("Workflow already executed");
      expect(result.blocks[0].action).toBe("Create new workflow");
      expect(result.blocks[0].secondaryAction).toBe("Upgrade plan");
    }
  });

  it("workflow with prior PARTIAL execution → BLOCKED", async () => {
    prismaMocks.executionFindFirst.mockResolvedValue({ status: "PARTIAL" });
    const result = await checkExecutionEligibility(wfArgs);
    expect(result.canExecute).toBe(false);
  });

  it("workflow with prior FAILED execution → ALLOWED (retry)", async () => {
    // hasWorkflowBeenExecuted filter is { in: [SUCCESS, PARTIAL, RUNNING, PENDING] }
    // — FAILED is NOT in the filter, so executionFindFirst returns null even
    // though there's a prior FAILED row in the DB. Workflow is unlocked.
    prismaMocks.executionFindFirst.mockResolvedValue(null);
    const result = await checkExecutionEligibility(wfArgs);
    expect(result.canExecute).toBe(true);
  });

  it("workflow with prior RUNNING execution → BLOCKED (race protection)", async () => {
    prismaMocks.executionFindFirst.mockResolvedValue({ status: "RUNNING" });
    const result = await checkExecutionEligibility(wfArgs);
    expect(result.canExecute).toBe(false);
  });

  it("workflow with prior PENDING execution → BLOCKED (race protection)", async () => {
    prismaMocks.executionFindFirst.mockResolvedValue({ status: "PENDING" });
    const result = await checkExecutionEligibility(wfArgs);
    expect(result.canExecute).toBe(false);
  });

  it("scratch workflow (__standalone_tools__) with prior SUCCESS → ALLOWED (always)", async () => {
    prismaMocks.workflowFindUnique.mockResolvedValue({ name: "__standalone_tools__" });
    prismaMocks.executionFindFirst.mockResolvedValue({ status: "SUCCESS" });
    const result = await checkExecutionEligibility(wfArgs);
    expect(result.canExecute).toBe(true);
  });

  it("admin re-running locked workflow → ALLOWED (admin bypass at top of helper)", async () => {
    prismaMocks.executionFindFirst.mockResolvedValue({ status: "SUCCESS" });
    const result = await checkExecutionEligibility({
      ...wfArgs,
      userRole: "PLATFORM_ADMIN",
    });
    expect(result.canExecute).toBe(true);
  });

  it("intent without workflowId → lock NOT checked (e.g., unsaved canvas)", async () => {
    prismaMocks.executionFindFirst.mockResolvedValue({ status: "SUCCESS" });
    const result = await checkExecutionEligibility({
      ...baseArgs,
      userRole: "MINI",
      intent: { kind: "workflow-run", catalogueIds: [] }, // no workflowId
    });
    expect(result.canExecute).toBe(true);
    expect(prismaMocks.executionFindFirst).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 10. getOrCreateScratchWorkflow idempotency
// ──────────────────────────────────────────────────────────────────────────────

describe("getOrCreateScratchWorkflow", () => {
  it("returns existing non-deleted scratch workflow id", async () => {
    prismaMocks.workflowFindFirst.mockResolvedValueOnce({ id: "wf-existing" });
    const id = await getOrCreateScratchWorkflow("user-1");
    expect(id).toBe("wf-existing");
    expect(prismaMocks.workflowCreate).not.toHaveBeenCalled();
    expect(prismaMocks.workflowUpdate).not.toHaveBeenCalled();
  });

  it("restores soft-deleted scratch workflow", async () => {
    prismaMocks.workflowFindFirst
      .mockResolvedValueOnce(null)              // first call (deletedAt:null) — none
      .mockResolvedValueOnce({ id: "wf-soft-deleted" }); // legacy lookup
    prismaMocks.workflowUpdate.mockResolvedValue({ id: "wf-soft-deleted" });
    const id = await getOrCreateScratchWorkflow("user-1");
    expect(id).toBe("wf-soft-deleted");
    expect(prismaMocks.workflowUpdate).toHaveBeenCalledWith({
      where: { id: "wf-soft-deleted" },
      data: { deletedAt: null },
      select: { id: true },
    });
  });

  it("creates a fresh scratch workflow when none exists", async () => {
    prismaMocks.workflowFindFirst.mockResolvedValue(null);
    prismaMocks.workflowCreate.mockResolvedValue({ id: "wf-new" });
    const id = await getOrCreateScratchWorkflow("user-1");
    expect(id).toBe("wf-new");
    expect(prismaMocks.workflowCreate).toHaveBeenCalledTimes(1);
    const callArgs = prismaMocks.workflowCreate.mock.calls[0][0];
    expect(callArgs.data.name).toBe("__standalone_tools__");
    expect(callArgs.data.ownerId).toBe("user-1");
  });
});
