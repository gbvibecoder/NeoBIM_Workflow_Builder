import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminRequest, unauthorizedResponse, NODE_NAMES, getNodeCategory } from "@/lib/admin-server";

export async function GET() {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Run all queries in parallel
  const [
    totalUsers,
    roleDistribution,
    recentUsers,
    activeThisWeek,
    totalWorkflows,
    workflowsByComplexity,
    publishedWorkflows,
    templateWorkflows,
    totalExecutions,
    executionsByStatus,
    recentExecutions,
    topNodeTypes,
    recentActivity,
    feedbackCounts,
    feedbackByType,
    proUsersCount,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ["role"], _count: true }),
    prisma.user.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.execution.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: sevenDaysAgo } },
    }).then(r => r.length),
    prisma.workflow.count(),
    prisma.workflow.groupBy({ by: ["complexity"], _count: true }),
    prisma.workflow.count({ where: { isPublished: true } }),
    prisma.workflow.count({ where: { isTemplate: true } }),
    prisma.execution.count(),
    prisma.execution.groupBy({ by: ["status"], _count: true }),
    prisma.execution.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tileInstance.groupBy({
      by: ["tileType"],
      _count: true,
      orderBy: { _count: { tileType: "desc" } },
      take: 12,
    }),
    prisma.execution.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        workflow: { select: { name: true } },
        user: { select: { name: true, email: true, image: true } },
      },
    }),
    prisma.feedback.groupBy({ by: ["status"], _count: true }),
    prisma.feedback.groupBy({ by: ["type"], _count: true }),
    prisma.user.count({ where: { role: "PRO" } }),
  ]);

  // Group signups by day
  const dailySignups: Record<string, number> = {};
  for (let d = new Date(thirtyDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
    dailySignups[d.toISOString().split("T")[0]] = 0;
  }
  recentUsers.forEach((u) => {
    const day = u.createdAt.toISOString().split("T")[0];
    dailySignups[day] = (dailySignups[day] || 0) + 1;
  });

  // Group executions by day
  const dailyExecs: Record<string, { total: number; success: number; failed: number }> = {};
  for (let d = new Date(thirtyDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
    dailyExecs[d.toISOString().split("T")[0]] = { total: 0, success: 0, failed: 0 };
  }
  recentExecutions.forEach((e) => {
    const day = e.createdAt.toISOString().split("T")[0];
    if (!dailyExecs[day]) dailyExecs[day] = { total: 0, success: 0, failed: 0 };
    dailyExecs[day].total++;
    if (e.status === "SUCCESS") dailyExecs[day].success++;
    if (e.status === "FAILED") dailyExecs[day].failed++;
  });

  const successCount = executionsByStatus.find((s) => s.status === "SUCCESS")?._count ?? 0;
  const successRate = totalExecutions > 0 ? successCount / totalExecutions : 0;

  // Estimate MRR: $29/mo per PRO user
  const PRO_PRICE = 29;
  const mrr = proUsersCount * PRO_PRICE;

  const roles: Record<string, number> = {};
  roleDistribution.forEach((r) => { roles[r.role] = r._count; });

  const statusMap: Record<string, number> = {};
  executionsByStatus.forEach((s) => { statusMap[s.status] = s._count; });

  const complexityMap: Record<string, number> = {};
  workflowsByComplexity.forEach((c) => { complexityMap[c.complexity] = c._count; });

  const feedbackStatusMap: Record<string, number> = {};
  feedbackCounts.forEach((f) => { feedbackStatusMap[f.status] = f._count; });

  const feedbackTypeMap: Record<string, number> = {};
  feedbackByType.forEach((f) => { feedbackTypeMap[f.type] = f._count; });

  return NextResponse.json({
    users: {
      total: totalUsers,
      byRole: roles,
      activeThisWeek,
      newThisMonth: recentUsers.length,
      dailySignups: Object.entries(dailySignups).map(([date, count]) => ({ date, count })),
    },
    workflows: {
      total: totalWorkflows,
      published: publishedWorkflows,
      templates: templateWorkflows,
      byComplexity: complexityMap,
    },
    executions: {
      total: totalExecutions,
      byStatus: statusMap,
      successRate: Math.round(successRate * 1000) / 10,
      dailyExecutions: Object.entries(dailyExecs).map(([date, d]) => ({
        date,
        total: d.total,
        success: d.success,
        failed: d.failed,
      })),
    },
    topNodes: topNodeTypes.map((n) => ({
      tileType: n.tileType,
      name: NODE_NAMES[n.tileType] || n.tileType,
      category: getNodeCategory(n.tileType),
      count: n._count,
    })),
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      status: a.status,
      workflowName: a.workflow?.name ?? "Untitled",
      userName: a.user?.name ?? a.user?.email ?? "Unknown",
      userImage: a.user?.image,
      createdAt: a.createdAt.toISOString(),
    })),
    mrr,
    feedback: {
      total: feedbackCounts.reduce((s, f) => s + f._count, 0),
      byStatus: feedbackStatusMap,
      byType: feedbackTypeMap,
    },
  });
}
