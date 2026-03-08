import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  levelFromXp,
  MISSIONS,
  BLUEPRINTS,
  todaysFlashEvent,
  msUntilMidnightUTC,
} from "@/lib/gamification";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Parallel queries
    const [user, achievements, workflowCount, executionCount, recentWorkflows, flashCompletion] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { xp: true, level: true },
        }),
        prisma.userAchievement.findMany({
          where: { userId },
          select: { action: true, xpAwarded: true, createdAt: true },
        }),
        prisma.workflow.count({ where: { ownerId: userId } }),
        prisma.execution.count({ where: { userId } }),
        prisma.workflow.findMany({
          where: { ownerId: userId },
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

    return NextResponse.json({
      xp,
      level,
      progress,
      xpInLevel,
      xpForNext,
      workflowCount,
      executionCount,
      missions,
      blueprints,
      achievements: achievements.map((a) => ({ action: a.action, xp: a.xpAwarded, date: a.createdAt.toISOString() })),
      flashEvent,
      recentWorkflows: recent,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
