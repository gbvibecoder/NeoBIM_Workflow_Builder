import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, unauthorizedResponse, logAudit } from "@/lib/admin-server";

const ALLOWED_STATUS = ["NEW", "CONTACTED", "SCHEDULED", "COMPLETED", "CANCELLED"] as const;
type AllowedStatus = (typeof ALLOWED_STATUS)[number];

/** Admin-managed updates on a demo request — status transition + free-form notes. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    status?: unknown;
    adminNote?: unknown;
  };

  const current = await prisma.demoRequest.findUnique({
    where: { id },
    select: { status: true, name: true, email: true, contactedAt: true, scheduledAt: true, completedAt: true },
  });
  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};

  if (typeof body.status === "string" && (ALLOWED_STATUS as readonly string[]).includes(body.status)) {
    const newStatus = body.status as AllowedStatus;
    if (newStatus !== current.status) {
      updates.status = newStatus;
      // Stamp the transition timestamp the first time we enter each state so
      // the admin UI can show "Contacted 3h ago" / "Scheduled yesterday" without
      // having to scan the audit log. We only set, never overwrite — a rollback
      // to NEW preserves the original timestamps for audit.
      const now = new Date();
      if (newStatus === "CONTACTED" && !current.contactedAt) updates.contactedAt = now;
      if (newStatus === "SCHEDULED" && !current.scheduledAt) updates.scheduledAt = now;
      if (newStatus === "COMPLETED" && !current.completedAt) updates.completedAt = now;
    }
  }

  if (typeof body.adminNote === "string") {
    // Allow clearing (empty string → null) so admins can reset a stale note.
    updates.adminNote = body.adminNote.trim() ? body.adminNote.slice(0, 5000) : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const demoRequest = await prisma.demoRequest.update({
    where: { id },
    data: updates,
  });

  await logAudit(session.id, "DEMO_REQUEST_UPDATED", "demo_request", id, {
    name: current.name,
    email: current.email,
    oldStatus: current.status,
    newStatus: updates.status ?? current.status,
    noteUpdated: "adminNote" in updates,
  });

  return NextResponse.json({
    success: true,
    demoRequest: {
      ...demoRequest,
      createdAt: demoRequest.createdAt.toISOString(),
      updatedAt: demoRequest.updatedAt.toISOString(),
      contactedAt: demoRequest.contactedAt?.toISOString() ?? null,
      scheduledAt: demoRequest.scheduledAt?.toISOString() ?? null,
      completedAt: demoRequest.completedAt?.toISOString() ?? null,
    },
  });
}
