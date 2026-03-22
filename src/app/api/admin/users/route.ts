import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";

export async function GET(req: Request) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const role = url.searchParams.get("role") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20")));
  const sort = url.searchParams.get("sort") || "createdAt";
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  if (role && ["FREE", "MINI", "STARTER", "PRO", "TEAM_ADMIN", "PLATFORM_ADMIN"].includes(role)) {
    where.role = role;
  }

  const allowedSorts = ["createdAt", "name", "email", "role", "xp", "level", "workflows", "executions"];
  const sortField = allowedSorts.includes(sort) ? sort : "createdAt";

  // Relation-count sorts use a different Prisma orderBy shape
  const orderBy =
    sortField === "workflows"
      ? { workflows: { _count: order } }
      : sortField === "executions"
        ? { executions: { _count: order } }
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
        stripeCurrentPeriodEnd: true,
        razorpaySubscriptionId: true,
        paymentGateway: true,
        createdAt: true,
        _count: { select: { workflows: true, executions: true } },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      orderBy: orderBy as any,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return NextResponse.json({
    users: users.map((u) => ({
      ...u,
      stripeCurrentPeriodEnd: u.stripeCurrentPeriodEnd?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
