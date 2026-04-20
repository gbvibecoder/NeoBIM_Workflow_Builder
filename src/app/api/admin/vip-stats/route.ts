/**
 * GET /api/admin/vip-stats
 *
 * Aggregated VipJob statistics for monitoring.
 * Platform admin auth required (AdminAccount session).
 * Uses Prisma aggregate/groupBy for efficiency (no findMany).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";

export async function GET() {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalJobs,
    byStatus,
    completedAvgs,
    total24h,
    byStatus24h,
    completedAvgs24h,
    total7d,
    byStatus7d,
    completedAvgs7d,
  ] = await Promise.all([
    // All time
    prisma.vipJob.count(),
    prisma.vipJob.groupBy({ by: ["status"], _count: true }),
    prisma.vipJob.aggregate({
      where: { status: "COMPLETED" },
      _avg: { costUsd: true },
      _count: true,
    }),
    // Last 24h
    prisma.vipJob.count({ where: { createdAt: { gte: last24h } } }),
    prisma.vipJob.groupBy({
      by: ["status"],
      where: { createdAt: { gte: last24h } },
      _count: true,
    }),
    prisma.vipJob.aggregate({
      where: { status: "COMPLETED", createdAt: { gte: last24h } },
      _avg: { costUsd: true },
      _count: true,
    }),
    // Last 7d
    prisma.vipJob.count({ where: { createdAt: { gte: last7d } } }),
    prisma.vipJob.groupBy({
      by: ["status"],
      where: { createdAt: { gte: last7d } },
      _count: true,
    }),
    prisma.vipJob.aggregate({
      where: { status: "COMPLETED", createdAt: { gte: last7d } },
      _avg: { costUsd: true },
      _count: true,
    }),
  ]);

  function buildStats(
    total: number,
    statusGroups: Array<{ status: string; _count: number }>,
    completedAggs: { _avg: { costUsd: number | null }; _count: number },
  ) {
    const statusMap: Record<string, number> = {
      QUEUED: 0,
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0,
    };
    for (const g of statusGroups) {
      statusMap[g.status] = g._count;
    }
    const completed = statusMap.COMPLETED;
    const failed = statusMap.FAILED;
    const failureRate =
      completed + failed > 0
        ? Math.round((failed / (completed + failed)) * 1000) / 1000
        : 0;

    return {
      totalJobs: total,
      byStatus: statusMap,
      avgCostUsd: completedAggs._avg.costUsd
        ? Math.round(completedAggs._avg.costUsd * 10000) / 10000
        : 0,
      completedCount: completedAggs._count,
      failureRate,
    };
  }

  return NextResponse.json({
    allTime: buildStats(totalJobs, byStatus, completedAvgs),
    last24h: buildStats(total24h, byStatus24h, completedAvgs24h),
    last7d: buildStats(total7d, byStatus7d, completedAvgs7d),
    generatedAt: now.toISOString(),
  });
}
