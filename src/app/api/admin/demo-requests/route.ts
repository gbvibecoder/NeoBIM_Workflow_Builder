import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";

const ALLOWED_STATUS = ["NEW", "CONTACTED", "SCHEDULED", "COMPLETED", "CANCELLED"] as const;
type AllowedStatus = (typeof ALLOWED_STATUS)[number];

export async function GET(req: Request) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "";
  const search = (url.searchParams.get("search") || "").trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20")));

  const where: Prisma.DemoRequestWhereInput = {};
  if (status && (ALLOWED_STATUS as readonly string[]).includes(status)) {
    where.status = status as AllowedStatus;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { company: { contains: search, mode: "insensitive" } },
    ];
  }

  const [items, total, statusCounts] = await Promise.all([
    prisma.demoRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.demoRequest.count({ where }),
    prisma.demoRequest.groupBy({ by: ["status"], _count: true }),
  ]);

  const statusMap: Record<string, number> = {};
  statusCounts.forEach((s) => { statusMap[s.status] = s._count; });

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      contactedAt: item.contactedAt?.toISOString() ?? null,
      scheduledAt: item.scheduledAt?.toISOString() ?? null,
      completedAt: item.completedAt?.toISOString() ?? null,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
    statusCounts: statusMap,
  });
}
