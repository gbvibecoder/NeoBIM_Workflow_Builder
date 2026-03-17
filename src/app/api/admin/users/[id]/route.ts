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
  if (body.role && ["FREE", "PRO", "TEAM_ADMIN", "PLATFORM_ADMIN"].includes(body.role)) {
    allowedUpdates.role = body.role;
  }

  if (Object.keys(allowedUpdates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data: allowedUpdates,
    select: { id: true, name: true, email: true, role: true },
  });

  return NextResponse.json({ success: true, user });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminRequest())) return unauthorizedResponse();

  const { id } = await params;

  await prisma.user.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
