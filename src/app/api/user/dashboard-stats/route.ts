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
    const [user, achievements, workflowCount, executionCount, recentWorkflows, flashCompletion, referralBonus, recentOutputs, recentActivity] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { xp: true, level: true, name: true, role: true },
        }),
        prisma.userAchievement.findMany({
          where: { userId },
          select: { action: true, xpAwarded: true, createdAt: true },
        }),
        prisma.workflow.count({ where: { ownerId: userId, deletedAt: null, name: { not: "__standalone_tools__" } } }),
        prisma.execution.count({ where: { userId, status: { in: ["SUCCESS", "PARTIAL"] } } }),
        prisma.workflow.findMany({
          where: { ownerId: userId, deletedAt: null, name: { not: "__standalone_tools__" } },
          orderBy: { updatedAt: "desc" },
          take: 3,
          select: {
            id: true,
            name: true,
            updatedAt: true,
            tileGraph: true,
            category: true,
            _count: { select: { executions: true } },
          },
        }),
        prisma.flashEventCompletion.findFirst({
          where: { userId, eventKey: todaysFlashEvent().eventKey },
        }),
        getReferralBonus(userId),
        prisma.artifact.findMany({
          where: {
            execution: { userId, status: { in: ["SUCCESS", "PARTIAL"] } },
            type: { in: ["IMAGE", "THREE_D", "FILE", "VIDEO"] },
          },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true,
            type: true,
            dataUri: true,
            createdAt: true,
            execution: {
              select: {
                workflow: { select: { id: true, name: true, category: true } },
              },
            },
          },
        }),
        prisma.execution.findMany({
          where: { userId, workflow: { name: { not: "__standalone_tools__" } } },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true,
            status: true,
            createdAt: true,
            completedAt: true,
            workflow: { select: { id: true, name: true, category: true } },
          },
        }),
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
        category: w.category,
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
      recentOutputs: recentOutputs.map((a) => {
        const isStandalone = a.execution.workflow.name === "__standalone_tools__";
        let displayName = a.execution.workflow.name;
        let displayCategory = a.execution.workflow.category;
        if (isStandalone) {
          if (a.type === "VIDEO") { displayName = "3D Walkthrough"; displayCategory = "video"; }
          else if (a.type === "THREE_D") { displayName = "3D Render"; displayCategory = "render"; }
          else if (a.type === "IMAGE") { displayName = "Generated Image"; displayCategory = "render"; }
          else { displayName = "Output"; displayCategory = displayCategory || "file"; }
        }
        return {
          id: a.id,
          type: a.type,
          dataUri: a.dataUri,
          createdAt: a.createdAt.toISOString(),
          workflowId: a.execution.workflow.id,
          workflowName: displayName,
          workflowCategory: displayCategory,
        };
      }),
      recentActivity: recentActivity.map((e) => ({
        id: e.id,
        status: e.status,
        createdAt: e.createdAt.toISOString(),
        completedAt: e.completedAt?.toISOString() ?? null,
        workflowId: e.workflow.id,
        workflowName: e.workflow.name,
        workflowCategory: e.workflow.category,
      })),
    });
    response.headers.set("Cache-Control", "private, max-age=30");
    return response;
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
