import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";
import type { Prisma } from "@prisma/client";

const VALID_STATUSES = ["RUNNING", "SUCCESS", "FALL_THROUGH", "FAILED"] as const;
type VipStatusLiteral = (typeof VALID_STATUSES)[number];

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const params = req.nextUrl.searchParams;
  const limit = Math.min(parseInt(params.get("limit") ?? "50", 10) || 50, 200);
  const before = params.get("before");
  const filterUserId = params.get("userId");
  const filterStatus = params.get("status");

  if (filterStatus && !VALID_STATUSES.includes(filterStatus as VipStatusLiteral)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const where: Prisma.VipGenerationWhereInput = {};
  if (filterUserId) where.userId = filterUserId;
  if (filterStatus) where.status = filterStatus as VipStatusLiteral;
  if (before) where.createdAt = { lt: new Date(before) };

  const rows = await prisma.vipGeneration.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  return NextResponse.json({
    data: rows,
    count: rows.length,
    nextCursor:
      rows.length > 0
        ? rows[rows.length - 1].createdAt.toISOString()
        : null,
  });
}
