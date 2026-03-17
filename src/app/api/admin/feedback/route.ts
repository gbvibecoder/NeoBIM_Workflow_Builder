import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";

export async function GET(req: Request) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "";
  const status = url.searchParams.get("status") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20")));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (type && ["BUG", "FEATURE", "SUGGESTION"].includes(type)) {
    where.type = type;
  }
  if (status && ["NEW", "REVIEWING", "PLANNED", "IN_PROGRESS", "DONE", "DECLINED"].includes(status)) {
    where.status = status;
  }

  const [items, total, statusCounts] = await Promise.all([
    prisma.feedback.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.feedback.count({ where }),
    prisma.feedback.groupBy({ by: ["status"], _count: true }),
  ]);

  const statusMap: Record<string, number> = {};
  statusCounts.forEach((s) => { statusMap[s.status] = s._count; });

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
    statusCounts: statusMap,
  });
}
