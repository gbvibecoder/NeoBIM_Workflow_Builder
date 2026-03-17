import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const { id } = await params;
  const body = await req.json();

  const allowedUpdates: Record<string, unknown> = {};

  if (body.status && ["NEW", "REVIEWING", "PLANNED", "IN_PROGRESS", "DONE", "DECLINED"].includes(body.status)) {
    allowedUpdates.status = body.status;
  }

  if (Object.keys(allowedUpdates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const feedback = await prisma.feedback.update({
    where: { id },
    data: allowedUpdates,
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  return NextResponse.json({ success: true, feedback });
}
