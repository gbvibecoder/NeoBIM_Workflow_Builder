import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAdminUser, redis, redisConfigured } from "@/lib/rate-limit";
import { VIDEO_NODES, MODEL_3D_NODES, RENDER_NODES, STRIPE_PLANS, getNodeTypeLimits } from "@/lib/stripe";

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
  const emailVerified = !!(session.user as { emailVerified?: boolean }).emailVerified;

  // Admins bypass everything
  const isAdmin = isAdminUser(userEmail) || userRoleRaw === "PLATFORM_ADMIN" || userRoleRaw === "TEAM_ADMIN";
  const userRole = (userRoleRaw in STRIPE_PLANS ? userRoleRaw : "FREE") as keyof typeof STRIPE_PLANS;
  if (isAdmin) {
    return NextResponse.json({ canExecute: true, blocks: [], remaining: 999, limit: 999, emailVerified: true, role: userRole });
  }

  const { catalogueIds } = await req.json().catch(() => ({ catalogueIds: [] }));
  const blocks: ExecutionBlock[] = [];

  // ── 1. Count this month's executions from DB ──
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const executionCount = await prisma.execution.count({
    where: {
      userId,
      createdAt: { gte: monthStart },
      status: { notIn: ["FAILED", "PENDING"] },
    },
  });

  const planConfig = STRIPE_PLANS[userRole] || STRIPE_PLANS.FREE;
  const planLimit = planConfig.limits.runsPerMonth;
  const remaining = planLimit < 0 ? 999 : Math.max(0, planLimit - executionCount);

  // ── 2. Email verification check ──
  // Unverified users get 1 free execution, then must verify for the rest
  if (!emailVerified && executionCount >= 1) {
    const totalFree = planLimit < 0 ? 999 : planLimit;
    blocks.push({
      type: "email_verification",
      title: "Verify your email",
      message: `You've used your free trial workflow! Verify your email to unlock the remaining ${Math.max(0, totalFree - 1)} workflow${totalFree - 1 !== 1 ? "s" : ""} on your ${planConfig.name} plan.`,
      action: "Verify Email",
      actionUrl: "/dashboard/settings",
    });
  }

  // ── 3. Plan execution limit check ──
  if (planLimit >= 0 && executionCount >= planLimit) {
    const nextPlan = userRole === "FREE" ? "Mini" : userRole === "MINI" ? "Starter" : userRole === "STARTER" ? "Pro" : null;
    blocks.push({
      type: "plan_limit",
      title: "Monthly limit reached",
      message: `You've used all ${planLimit} workflow executions this month on the ${planConfig.name} plan.${nextPlan ? ` Upgrade to ${nextPlan} for more.` : " Resets next month."}`,
      action: nextPlan ? `Upgrade to ${nextPlan}` : undefined,
      actionUrl: nextPlan ? "/dashboard/billing" : undefined,
    });
  }

  // ── 4. Node-type limits (video, 3D, renders) ──
  if (Array.isArray(catalogueIds) && catalogueIds.length > 0 && redisConfigured) {
    const nodeLimits = getNodeTypeLimits(userRoleRaw) as { videoPerMonth: number; modelsPerMonth: number; rendersPerMonth: number };
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const hasVideo = catalogueIds.some((id: string) => VIDEO_NODES.has(id));
    const has3D = catalogueIds.some((id: string) => MODEL_3D_NODES.has(id));
    const hasRender = catalogueIds.some((id: string) => RENDER_NODES.has(id));

    if (hasVideo && nodeLimits.videoPerMonth >= 0) {
      const used = await redis.get<number>(`node-limit:${userId}:video:${monthKey}`) ?? 0;
      if (nodeLimits.videoPerMonth === 0) {
        blocks.push({
          type: "node_limit",
          title: "Video not available",
          message: "Video walkthroughs are not available on your current plan. Upgrade to Starter or higher to generate video walkthroughs.",
          action: "Upgrade Plan",
          actionUrl: "/dashboard/billing",
        });
      } else if (used >= nodeLimits.videoPerMonth) {
        blocks.push({
          type: "node_limit",
          title: "Video limit reached",
          message: `You've used all ${nodeLimits.videoPerMonth} video generations this month.`,
          action: "Upgrade Plan",
          actionUrl: "/dashboard/billing",
        });
      }
    }

    if (has3D && nodeLimits.modelsPerMonth >= 0) {
      const used = await redis.get<number>(`node-limit:${userId}:3d:${monthKey}`) ?? 0;
      if (nodeLimits.modelsPerMonth === 0) {
        blocks.push({
          type: "node_limit",
          title: "3D models not available",
          message: "3D model generation is not available on your current plan. Upgrade to Starter or higher.",
          action: "Upgrade Plan",
          actionUrl: "/dashboard/billing",
        });
      } else if (used >= nodeLimits.modelsPerMonth) {
        blocks.push({
          type: "node_limit",
          title: "3D model limit reached",
          message: `You've used all ${nodeLimits.modelsPerMonth} 3D model generations this month.`,
          action: "Upgrade Plan",
          actionUrl: "/dashboard/billing",
        });
      }
    }

    if (hasRender && nodeLimits.rendersPerMonth >= 0) {
      const used = await redis.get<number>(`node-limit:${userId}:render:${monthKey}`) ?? 0;
      if (nodeLimits.rendersPerMonth === 0) {
        blocks.push({
          type: "node_limit",
          title: "Renders not available",
          message: "Concept renders are not available on your current plan.",
          action: "Upgrade Plan",
          actionUrl: "/dashboard/billing",
        });
      } else if (used >= nodeLimits.rendersPerMonth) {
        blocks.push({
          type: "node_limit",
          title: "Render limit reached",
          message: `You've used all ${nodeLimits.rendersPerMonth} concept renders this month.`,
          action: "Upgrade Plan",
          actionUrl: "/dashboard/billing",
        });
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
