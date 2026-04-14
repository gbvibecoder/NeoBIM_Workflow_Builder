import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";

export const dynamic = "force-dynamic";

type BucketRow = { label: string; count: number };

function parseRange(req: NextRequest): { from?: Date; to?: Date } {
  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const from = fromStr ? new Date(fromStr) : undefined;
  const to = toStr ? new Date(toStr) : undefined;
  return {
    from: from && !isNaN(from.getTime()) ? from : undefined,
    to: to && !isNaN(to.getTime()) ? to : undefined,
  };
}

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const { from, to } = parseRange(req);
  const userCreatedFilter: { gte?: Date; lte?: Date } = {};
  if (from) userCreatedFilter.gte = from;
  if (to) userCreatedFilter.lte = to;

  // Scope: surveys tied to users whose account was created inside the range.
  // This anchors the funnel to a cohort ("users registered in Q1 …").
  const surveyCreatedFilter: { gte?: Date; lte?: Date } = {};
  if (from) surveyCreatedFilter.gte = from;
  if (to) surveyCreatedFilter.lte = to;

  const userWhere = Object.keys(userCreatedFilter).length
    ? { createdAt: userCreatedFilter }
    : {};

  const surveyWhere = Object.keys(surveyCreatedFilter).length
    ? { createdAt: surveyCreatedFilter }
    : {};

  const [
    totalUsers,
    surveyRows,
    recentRows,
  ] = await Promise.all([
    prisma.user.count({ where: userWhere }),
    prisma.userSurvey.findMany({
      where: surveyWhere,
      select: {
        discoverySource: true,
        profession: true,
        teamSize: true,
        pricingAction: true,
        completedAt: true,
        skippedAt: true,
        skippedAtScene: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.userSurvey.findMany({
      where: surveyWhere,
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        user: { select: { id: true, email: true, name: true, createdAt: true } },
      },
    }),
  ]);

  // ── Funnel ────────────────────────────────────────────────────────────
  // Registered > Scene1 answered > Scene2 answered > Scene3 answered > Scene4 picked > Completed
  const scene1 = surveyRows.filter((r) => r.discoverySource).length;
  const scene2 = surveyRows.filter((r) => r.profession).length;
  const scene3 = surveyRows.filter((r) => r.teamSize).length;
  const scene4 = surveyRows.filter((r) => r.pricingAction).length;
  const completed = surveyRows.filter((r) => r.completedAt).length;

  const funnel = [
    { label: "Registered", count: totalUsers },
    { label: "Scene 1 · Discovery", count: scene1 },
    { label: "Scene 2 · Profession", count: scene2 },
    { label: "Scene 3 · Team", count: scene3 },
    { label: "Scene 4 · Pricing", count: scene4 },
    { label: "Completed", count: completed },
  ];

  // ── Pie buckets ──────────────────────────────────────────────────────
  const bucket = (rows: (string | null)[]): BucketRow[] => {
    const m = new Map<string, number>();
    for (const v of rows) {
      if (!v) continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  };

  const pies = {
    discovery: bucket(surveyRows.map((r) => r.discoverySource)),
    profession: bucket(surveyRows.map((r) => r.profession)),
    teamSize: bucket(surveyRows.map((r) => r.teamSize)),
    pricing: bucket(surveyRows.map((r) => r.pricingAction)),
  };

  // ── Stats ───────────────────────────────────────────────────────────
  const totalSurveys = surveyRows.length;
  const completionRate = totalUsers > 0 ? Math.round((completed / totalUsers) * 1000) / 10 : 0;

  // Average time in seconds: for completed surveys, use (updatedAt - createdAt)
  // as a proxy (we don't store the actual timer client-side in the DB).
  const completedRows = surveyRows.filter((r) => r.completedAt);
  const avgTimeSeconds =
    completedRows.length > 0
      ? Math.round(
          completedRows.reduce(
            (sum, r) =>
              sum + Math.max(0, (r.completedAt!.getTime() - r.createdAt.getTime()) / 1000),
            0
          ) / completedRows.length
        )
      : 0;

  const skipBuckets = new Map<number, number>();
  for (const r of surveyRows) {
    if (r.skippedAt && r.skippedAtScene) {
      skipBuckets.set(r.skippedAtScene, (skipBuckets.get(r.skippedAtScene) ?? 0) + 1);
    }
  }
  const commonSkipScene =
    [...skipBuckets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const topDiscovery = pies.discovery[0]?.label ?? null;

  const stats = {
    totalSurveys,
    completed,
    completionRate,
    avgTimeSeconds,
    commonSkipScene,
    topDiscovery,
  };

  // ── Recent rows for table ───────────────────────────────────────────
  const recent = recentRows.map((r) => ({
    userId: r.user.id,
    userEmail: r.user.email,
    userName: r.user.name,
    discovery: r.discoverySource,
    discoveryOther: r.discoveryOther,
    profession: r.profession,
    professionOther: r.professionOther,
    teamSize: r.teamSize,
    pricing: r.pricingAction,
    completedAt: r.completedAt,
    skippedAt: r.skippedAt,
    skippedAtScene: r.skippedAtScene,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  return NextResponse.json({ funnel, pies, stats, recent });
}
