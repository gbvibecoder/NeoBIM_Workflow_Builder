import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, unauthorizedResponse, logAudit } from "@/lib/admin-server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const body = await req.json();

  // Get current user for audit log
  const currentUser = await prisma.user.findUnique({
    where: { id },
    select: { role: true, email: true },
  });

  const allowedUpdates: Record<string, unknown> = {};
  if (body.role && ["FREE", "MINI", "STARTER", "PRO", "TEAM_ADMIN", "PLATFORM_ADMIN"].includes(body.role)) {
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

  await logAudit(session.id, "USER_ROLE_CHANGED", "user", id, {
    email: currentUser?.email,
    oldRole: currentUser?.role,
    newRole: body.role,
  });

  return NextResponse.json({ success: true, user });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;

  // Get user info before deletion for audit log
  const user = await prisma.user.findUnique({
    where: { id },
    select: { email: true, name: true, role: true },
  });

  await prisma.user.delete({ where: { id } });

  await logAudit(session.id, "USER_DELETED", "user", id, {
    email: user?.email,
    name: user?.name,
    role: user?.role,
  });

  return NextResponse.json({ success: true });
}
