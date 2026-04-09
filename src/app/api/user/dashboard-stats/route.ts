import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit, getReferralBonus } from "@/lib/rate-limit";
import {
  levelFromXp,
  MISSIONS,
  BLUEPRINTS,
  todaysFlashEvent,
  msUntilMidnightUTC,
} from "@/lib/gamification";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 20 queries per user per minute
    const rateLimit = await checkEndpointRateLimit(session.user.id, "dashboard-stats", 20, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please try again later.", code: "RATE_001" }), { status: 429 });
    }

    const userId = session.user.id;

    // Parallel queries
    const [user, achievements, workflowCount, executionCount, recentWorkflows, flashCompletion, referralBonus] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { xp: true, level: true, name: true, role: true },
        }),
        prisma.userAchievement.findMany({
          where: { userId },
          select: { action: true, xpAwarded: true, createdAt: true },
        }),
        prisma.workflow.count({ where: { ownerId: userId, deletedAt: null } }),
        prisma.execution.count({ where: { userId, workflow: { deletedAt: null } } }),
        prisma.workflow.findMany({
          where: { ownerId: userId, deletedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 3,
          select: {
            id: true,
            name: true,
            updatedAt: true,
            tileGraph: true,
            _count: { select: { executions: true } },
          },
        }),
        prisma.flashEventCompletion.findFirst({
          where: { userId, eventKey: todaysFlashEvent().eventKey },
        }),
        getReferralBonus(userId),
      ]);

    const xp = user?.xp ?? 0;
    const { level, progress, xpForNext, xpInLevel } = levelFromXp(xp);

    // Completed actions set
    const completedActions = new Set(achievements.map((a) => a.action));

    // Derive mission statuses
    const missions = MISSIONS.map((m, idx) => {
      if (completedActions.has(m.action)) return { ...m, status: "completed" as const };
      // First non-completed mission is in_progress, rest are locked
      const prevCompleted = idx === 0 || MISSIONS.slice(0, idx).every((pm) => completedActions.has(pm.action));
      return { ...m, status: prevCompleted ? ("in_progress" as const) : ("locked" as const) };
    });

    // Blueprints with unlock status
    const blueprints = BLUEPRINTS.map((b) => ({
      ...b,
      unlocked: level >= b.requiredLevel,
    }));

    // Flash event
    const flashEvent = {
      ...todaysFlashEvent(),
      completed: !!flashCompletion,
      msRemaining: msUntilMidnightUTC(),
    };

    // Recent workflows (for Recent Activity section)
    const recent = recentWorkflows.map((w) => {
      const graph = w.tileGraph as { nodes?: unknown[] } | null;
      return {
        id: w.id,
        name: w.name,
        updatedAt: w.updatedAt.toISOString(),
        nodeCount: Array.isArray(graph?.nodes) ? graph.nodes.length : 0,
        executionCount: w._count.executions,
      };
    });

    const response = NextResponse.json({
      userName: user?.name ?? null,
      userRole: user?.role ?? "FREE",
      xp,
      level,
      progress,
      xpInLevel,
      xpForNext,
      workflowCount,
      executionCount,
      referralBonus,
      missions,
      blueprints,
      achievements: achievements.map((a) => ({ action: a.action, xp: a.xpAwarded, date: a.createdAt.toISOString() })),
      flashEvent,
      recentWorkflows: recent,
    });
    response.headers.set("Cache-Control", "private, max-age=30");
    return response;
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
