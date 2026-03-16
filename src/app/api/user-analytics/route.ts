import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 20 analytics queries per user per minute
    const rateLimit = await checkEndpointRateLimit(session.user.id, "user-analytics", 20, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Please try again later.", code: "RATE_001" }), { status: 429 });
    }

    const userId = session.user.id;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Run all queries in parallel
    const [
      totalExecutions,
      successCount,
      failedCount,
      recentExecutions,
      workflows,
    ] = await Promise.all([
      prisma.execution.count({ where: { userId } }),
      prisma.execution.count({ where: { userId, status: "SUCCESS" } }),
      prisma.execution.count({ where: { userId, status: "FAILED" } }),
      prisma.execution.findMany({
        where: { userId, startedAt: { gte: sevenDaysAgo } },
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          tileResults: true,
          workflowId: true,
        },
        orderBy: { startedAt: "desc" },
        take: 100,
      }),
      prisma.workflow.findMany({
        where: { ownerId: userId },
        select: { id: true, name: true, _count: { select: { executions: true } } },
        orderBy: { updatedAt: "desc" },
        take: 10,
      }),
    ]);

    // ─── Daily execution counts (last 7 days) ─────────────────────────
    const dailyCounts: Record<string, { total: number; success: number; failed: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split("T")[0];
      dailyCounts[key] = { total: 0, success: 0, failed: 0 };
    }

    for (const exec of recentExecutions) {
      const day = exec.startedAt?.toISOString().split("T")[0];
      if (day && dailyCounts[day]) {
        dailyCounts[day].total++;
        if (exec.status === "SUCCESS") dailyCounts[day].success++;
        if (exec.status === "FAILED") dailyCounts[day].failed++;
      }
    }

    const dailyStats = Object.entries(dailyCounts).map(([date, counts]) => ({
      date: new Date(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      ...counts,
    }));

    // ─── Node usage from tileResults ───────────────────────────────────
    const nodeUsage: Record<string, number> = {};
    for (const exec of recentExecutions) {
      const tiles = exec.tileResults as unknown;
      if (Array.isArray(tiles)) {
        for (const tile of tiles) {
          const t = tile as Record<string, unknown>;
          const catId = String(t.catalogueId ?? t.nodeId ?? "unknown");
          nodeUsage[catId] = (nodeUsage[catId] ?? 0) + 1;
        }
      }
    }

    const nodeStats = Object.entries(nodeUsage)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // ─── Average execution time ────────────────────────────────────────
    let totalDuration = 0;
    let durationCount = 0;
    for (const exec of recentExecutions) {
      if (exec.startedAt && exec.completedAt) {
        totalDuration += exec.completedAt.getTime() - exec.startedAt.getTime();
        durationCount++;
      }
    }
    const avgDurationMs = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;

    // ─── Success rate ──────────────────────────────────────────────────
    const successRate = totalExecutions > 0
      ? Math.round((successCount / totalExecutions) * 100)
      : 0;

    // ─── Top workflows ─────────────────────────────────────────────────
    const topWorkflows = workflows
      .filter(w => w._count.executions > 0)
      .sort((a, b) => b._count.executions - a._count.executions)
      .slice(0, 5)
      .map(w => ({ name: w.name, runs: w._count.executions }));

    return NextResponse.json({
      totalExecutions,
      successCount,
      failedCount,
      successRate,
      avgDurationMs,
      dailyStats,
      nodeStats,
      topWorkflows,
    });
  } catch (error) {
    console.error("[user-analytics/GET]", error);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
