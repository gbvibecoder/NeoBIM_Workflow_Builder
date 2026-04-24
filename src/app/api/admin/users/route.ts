import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";

const PAID_ROLES: Prisma.UserWhereInput["role"] = { in: ["MINI", "STARTER", "PRO", "TEAM_ADMIN"] };
const PLAN_PRICES: Record<string, number> = { MINI: 99, STARTER: 799, PRO: 1999, TEAM_ADMIN: 4999 };

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

export async function GET(req: Request) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const role = url.searchParams.get("role") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20")));
  const sort = url.searchParams.get("sort") || "createdAt";
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";

  // ── Revenue/billing filters (all optional, backward compatible) ────────────
  const joinedFrom = parseDate(url.searchParams.get("joinedFrom"));
  const joinedTo = parseDate(url.searchParams.get("joinedTo"));
  const paidOnly = url.searchParams.get("paidOnly") === "true";
  const gatewayParam = url.searchParams.get("gateway") || "";
  const gateway = gatewayParam === "stripe" || gatewayParam === "razorpay" ? gatewayParam : "";
  const includeSummary = url.searchParams.get("includeSummary") === "true";

  // ── Compose where with AND[] so filters never overwrite each other ────────
  const andConditions: Prisma.UserWhereInput[] = [];

  if (search) {
    andConditions.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  if (role && ["FREE", "MINI", "STARTER", "PRO", "TEAM_ADMIN", "PLATFORM_ADMIN"].includes(role)) {
    andConditions.push({ role: role as "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN" });
  }

  if (joinedFrom || joinedTo) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (joinedFrom) createdAt.gte = joinedFrom;
    if (joinedTo) createdAt.lte = joinedTo;
    andConditions.push({ createdAt });
  }

  if (paidOnly) {
    andConditions.push({
      role: PAID_ROLES,
      OR: [
        { stripeSubscriptionId: { not: null } },
        { razorpaySubscriptionId: { not: null } },
      ],
    });
  }

  if (gateway === "stripe") {
    andConditions.push({ stripeSubscriptionId: { not: null } });
  } else if (gateway === "razorpay") {
    andConditions.push({ razorpaySubscriptionId: { not: null } });
  }

  const where: Prisma.UserWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

  const allowedSorts = ["createdAt", "name", "email", "role", "xp", "level", "workflows", "executions", "subEnd"];
  const sortField = allowedSorts.includes(sort) ? sort : "createdAt";

  // Relation-count and nullable-date sorts use special Prisma orderBy shapes
  const orderBy: Prisma.UserOrderByWithRelationInput =
    sortField === "workflows"
      ? { workflows: { _count: order } }
      : sortField === "executions"
        ? { executions: { _count: order } }
        : sortField === "subEnd"
          ? { stripeCurrentPeriodEnd: { sort: order, nulls: "last" } }
          : { [sortField]: order };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        xp: true,
        level: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
        stripeCurrentPeriodEnd: true,
        razorpaySubscriptionId: true,
        razorpayPlanId: true,
        paymentGateway: true,
        createdAt: true,
        _count: {
          select: {
            workflows: true,
            executions: { where: { status: { in: ["SUCCESS", "PARTIAL"] } } },
          },
        },
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  // Optional aggregate summary for the current filter (admin billing page)
  let summary:
    | { paidInFilter: number; mrrInFilter: number; byRoleInFilter: Record<string, number> }
    | undefined;

  if (includeSummary) {
    const paidInFilterRows = await prisma.user.findMany({
      where: {
        AND: [
          ...andConditions,
          {
            role: PAID_ROLES,
            OR: [
              { stripeSubscriptionId: { not: null } },
              { razorpaySubscriptionId: { not: null } },
            ],
          },
        ],
      },
      select: { role: true },
    });
    const byRoleInFilter: Record<string, number> = {};
    let mrrInFilter = 0;
    for (const u of paidInFilterRows) {
      byRoleInFilter[u.role] = (byRoleInFilter[u.role] || 0) + 1;
      mrrInFilter += PLAN_PRICES[u.role] || 0;
    }
    summary = {
      paidInFilter: paidInFilterRows.length,
      mrrInFilter,
      byRoleInFilter,
    };
  }

  return NextResponse.json({
    users: users.map((u) => ({
      ...u,
      stripeCurrentPeriodEnd: u.stripeCurrentPeriodEnd?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
    ...(summary ? { summary } : {}),
  });
}
