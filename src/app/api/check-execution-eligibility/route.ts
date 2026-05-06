import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAdminUser, redis, redisConfigured } from "@/lib/rate-limit";
import { VIDEO_NODES, MODEL_3D_NODES, RENDER_NODES, STRIPE_PLANS, getNodeTypeLimits } from "@/features/billing/lib/stripe";
import { getEffectiveLimits, type LegacyLimits } from "@/features/billing/lib/plan-helpers";

interface ExecutionBlock {
  type: "email_verification" | "plan_limit" | "node_limit";
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
}

/**
 * Pre-execution eligibility check.
 * Returns whether the user can execute a workflow — without consuming any rate limit tokens.
 * Called BEFORE execution starts so we can show friendly popups instead of execution log errors.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ canExecute: false, blocks: [{ type: "auth", title: "Not signed in", message: "Please sign in to run workflows.", action: "Sign In", actionUrl: "/auth/signin" }] }, { status: 401 });
  }

  const userId = session.user.id;
  const userRoleRaw = ((session.user as { role?: string }).role) || "FREE";
  const userEmail = session.user.email || "";
  let emailVerified = !!(session.user as { emailVerified?: boolean }).emailVerified;

  // Admins bypass everything
  const isAdmin = isAdminUser(userEmail) || userRoleRaw === "PLATFORM_ADMIN" || userRoleRaw === "TEAM_ADMIN";
  const userRole = (userRoleRaw in STRIPE_PLANS ? userRoleRaw : "FREE") as keyof typeof STRIPE_PLANS;
  if (isAdmin) {
    return NextResponse.json({ canExecute: true, blocks: [], remaining: 999, limit: 999, emailVerified: true, role: userRole });
  }

  // JWT session can be stale for up to 60s after verification (NextAuth JWT
  // refresh throttle). If session says unverified, double-check with DB.
  if (!emailVerified) {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true },
    });
    emailVerified = !!dbUser?.emailVerified;
  }

  const { catalogueIds } = await req.json().catch(() => ({ catalogueIds: [] }));
  const blocks: ExecutionBlock[] = [];

  // Fetch legacyLimits for grandfathering
  const dbUserLimits = await prisma.user.findUnique({
    where: { id: userId },
    select: { legacyLimits: true },
  });
  const effectiveLimits = getEffectiveLimits(userRole, dbUserLimits?.legacyLimits as LegacyLimits | null);
  const planLimit = effectiveLimits.runsPerMonth;

  if (userRole === "FREE") {
    // ── FREE tier: LIFETIME executions ──
    const freeLimit = effectiveLimits.runsPerMonth;
    const lifetimeCount = await prisma.execution.count({
      where: { userId, status: { notIn: ["FAILED", "PENDING"] } },
    });

    const remaining = Math.max(0, freeLimit - lifetimeCount);

    // Hard cap: lifetime executions
    if (lifetimeCount >= freeLimit) {
      blocks.push({
        type: "plan_limit",
        title: "Free executions used",
        message: `You've used all ${freeLimit} free workflow executions. Upgrade to Mini to keep building!`,
        action: "Upgrade to Mini",
        actionUrl: "/dashboard/billing",
      });
    }
    // Verification gate: after (limit - 1) unverified executions, must verify for the last
    else if (!emailVerified && lifetimeCount >= freeLimit - 1) {
      blocks.push({
        type: "email_verification",
        title: "Verify your email",
        message: `You've used ${lifetimeCount} of your ${freeLimit} free executions. Verify your email to unlock your final free workflow!`,
        action: "Verify Email",
        actionUrl: "/dashboard/settings",
      });
    }

    return NextResponse.json({
      canExecute: blocks.length === 0,
      blocks,
      remaining,
      limit: freeLimit,
      used: lifetimeCount,
      emailVerified,
      role: userRole,
    });
  }

  // ── Paid tiers (MINI/STARTER/PRO): monthly limits ──
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const executionCount = await prisma.execution.count({
    where: {
      userId,
      createdAt: { gte: monthStart },
      status: { notIn: ["FAILED", "PENDING"] },
    },
  });

  const remaining = planLimit < 0 ? 999 : Math.max(0, planLimit - executionCount);

  // Paid users: require email verification (no trial)
  if (!emailVerified) {
    blocks.push({
      type: "email_verification",
      title: "Verify your email",
      message: "Please verify your email address to run workflows. Check your inbox for the verification link.",
      action: "Verify Email",
      actionUrl: "/dashboard/settings",
    });
  }

  // Monthly plan limit
  if (planLimit >= 0 && executionCount >= planLimit) {
    const nextPlan = userRole === "MINI" ? "Starter" : userRole === "STARTER" ? "Pro" : null;
    blocks.push({
      type: "plan_limit",
      title: "Monthly limit reached",
      message: `You've used all ${planLimit} workflow executions this month on the ${STRIPE_PLANS[userRole]?.name ?? "current"} plan.${nextPlan ? ` Upgrade to ${nextPlan} for more.` : " Resets next month."}`,
      action: nextPlan ? `Upgrade to ${nextPlan}` : undefined,
      actionUrl: nextPlan ? "/dashboard/billing" : undefined,
    });
  }

  // ── Node-type limits (video, 3D, renders) ──
  if (Array.isArray(catalogueIds) && catalogueIds.length > 0 && redisConfigured) {
    const nodeLimits = getNodeTypeLimits(userRoleRaw) as { videoPerMonth: number; modelsPerMonth: number; rendersPerMonth: number };
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const hasVideo = catalogueIds.some((id: string) => VIDEO_NODES.has(id));
    const has3D = catalogueIds.some((id: string) => MODEL_3D_NODES.has(id));
    const hasRender = catalogueIds.some((id: string) => RENDER_NODES.has(id));

    if (hasVideo && nodeLimits.videoPerMonth >= 0) {
      const used = await redis.get<number>(`node-limit:${userId}:video:${monthKey}`) ?? 0;
      if (nodeLimits.videoPerMonth === 0) {
        blocks.push({ type: "node_limit", title: "Video not available", message: "Video walkthroughs are not available on your current plan. Upgrade to Starter or higher to generate video walkthroughs.", action: "Upgrade Plan", actionUrl: "/dashboard/billing" });
      } else if (used >= nodeLimits.videoPerMonth) {
        blocks.push({ type: "node_limit", title: "Video limit reached", message: `You've used all ${nodeLimits.videoPerMonth} video generations this month.`, action: "Upgrade Plan", actionUrl: "/dashboard/billing" });
      }
    }

    if (has3D && nodeLimits.modelsPerMonth >= 0) {
      const used = await redis.get<number>(`node-limit:${userId}:3d:${monthKey}`) ?? 0;
      if (nodeLimits.modelsPerMonth === 0) {
        blocks.push({ type: "node_limit", title: "3D models not available", message: "3D model generation is not available on your current plan. Upgrade to Starter or higher.", action: "Upgrade Plan", actionUrl: "/dashboard/billing" });
      } else if (used >= nodeLimits.modelsPerMonth) {
        blocks.push({ type: "node_limit", title: "3D model limit reached", message: `You've used all ${nodeLimits.modelsPerMonth} 3D model generations this month.`, action: "Upgrade Plan", actionUrl: "/dashboard/billing" });
      }
    }

    if (hasRender && nodeLimits.rendersPerMonth >= 0) {
      const used = await redis.get<number>(`node-limit:${userId}:render:${monthKey}`) ?? 0;
      if (nodeLimits.rendersPerMonth === 0) {
        blocks.push({ type: "node_limit", title: "Renders not available", message: "Concept renders are not available on your current plan.", action: "Upgrade Plan", actionUrl: "/dashboard/billing" });
      } else if (used >= nodeLimits.rendersPerMonth) {
        blocks.push({ type: "node_limit", title: "Render limit reached", message: `You've used all ${nodeLimits.rendersPerMonth} concept renders this month.`, action: "Upgrade Plan", actionUrl: "/dashboard/billing" });
      }
    }
  }

  return NextResponse.json({
    canExecute: blocks.length === 0,
    blocks,
    remaining,
    limit: planLimit,
    used: executionCount,
    emailVerified,
    role: userRole,
  });
}
