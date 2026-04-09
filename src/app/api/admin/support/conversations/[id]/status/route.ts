import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, unauthorizedResponse, logAudit } from "@/lib/admin-server";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import type { AuditAction } from "@/lib/admin-server";
import { sendSupportResolvedEmail } from "@/shared/services/email";

const VALID_STATUSES = ["ACTIVE", "ESCALATED", "ADMIN_REPLIED", "RESOLVED", "CLOSED"];
const VALID_CATEGORIES = [
  "GENERAL", "WORKFLOW_HELP", "NODE_EXECUTION", "BILLING", "BUG_REPORT",
  "FEATURE_REQUEST", "IFC_PARSING", "COST_ESTIMATION", "THREE_D_GENERATION",
  "ACCOUNT", "TECHNICAL",
];

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getAdminSession();
    if (!admin || admin.role === "VIEWER") return unauthorizedResponse();

    const rl = await checkEndpointRateLimit(`admin:${admin.id}`, "admin-support-status", 30, "1 m");
    if (!rl.success) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

    const { id } = await params;
    const body = await req.json();
    const { status, priority, assignedTo, category } = body as {
      status?: string;
      priority?: number;
      assignedTo?: string | null;
      category?: string;
    };

    const conversation = await prisma.supportConversation.findUnique({
      where: { id },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    if (status && VALID_STATUSES.includes(status)) {
      updateData.status = status;
      if (status === "RESOLVED") {
        updateData.resolvedAt = new Date();
        updateData.resolvedBy = admin.id;
      }
    }
    if (typeof priority === "number" && priority >= 0 && priority <= 2) {
      updateData.priority = priority;
    }
    if (assignedTo !== undefined) {
      updateData.assignedTo = assignedTo;
    }
    if (category && VALID_CATEGORIES.includes(category)) {
      updateData.category = category;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    await prisma.supportConversation.update({ where: { id }, data: updateData });

    logAudit(
      admin.id,
      "SUPPORT_STATUS_CHANGE" as AuditAction,
      "CONVERSATION",
      id,
      { changes: updateData },
    ).catch((err) => {
      console.error("[support] Audit log failed:", err);
    });

    // If resolved, send email to user
    if (status === "RESOLVED") {
      sendSupportResolvedEmail({
        userName: conversation.user.name || "there",
        userEmail: conversation.user.email,
        subject: conversation.subject || "Your support question",
        conversationId: id,
      }).catch((err) => {
        console.error("[support] Failed to send resolved email:", err);
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/support/status] Error:", error);
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
