import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAdminSession, unauthorizedResponse, logAudit } from "@/lib/admin-server";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import type { AuditAction } from "@/lib/admin-server";
import { sendSupportAdminReplyEmail } from "@/shared/services/email";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await getAdminSession();
    if (!admin || admin.role === "VIEWER") return unauthorizedResponse();

    const rl = await checkEndpointRateLimit(`admin:${admin.id}`, "admin-support-reply", 30, "1 m");
    if (!rl.success) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

    const { id } = await params;
    const body = await req.json();
    const { content, isInternal } = body as { content?: string; isInternal?: boolean };

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "Reply content is required" }, { status: 400 });
    }
    if (content.length > 5000) {
      return NextResponse.json({ error: "Reply too long (max 5000 chars)" }, { status: 400 });
    }

    const conversation = await prisma.supportConversation.findUnique({
      where: { id },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Save message
    const message = await prisma.supportMessage.create({
      data: {
        conversationId: id,
        role: isInternal ? "SYSTEM" : "ADMIN",
        content: content.trim(),
        isInternal: isInternal || false,
        metadata: { adminId: admin.id, adminName: admin.displayName },
      },
    });

    // Update conversation status if not internal
    if (!isInternal) {
      await prisma.supportConversation.update({
        where: { id },
        data: {
          status: "ADMIN_REPLIED",
          messageCount: { increment: 1 },
          lastMessageAt: new Date(),
        },
      });

      // Send email notification to user (fire-and-forget)
      sendSupportAdminReplyEmail({
        userName: conversation.user.name || "there",
        userEmail: conversation.user.email,
        replyContent: content.trim(),
        conversationId: id,
        subject: conversation.subject || "Your support question",
      }).catch((err) => {
        console.error("[support] Failed to send admin reply email:", err);
      });
    } else {
      await prisma.supportConversation.update({
        where: { id },
        data: { messageCount: { increment: 1 } },
      });
    }

    logAudit(
      admin.id,
      "SUPPORT_REPLY" as AuditAction,
      "CONVERSATION",
      id,
      { isInternal, contentLength: content.length },
    ).catch((err) => {
      console.error("[support] Audit log failed:", err);
    });

    return NextResponse.json({
      id: message.id,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      metadata: message.metadata,
      isInternal: message.isInternal,
      createdAt: message.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("[admin/support/reply] Error:", error);
    return NextResponse.json({ error: "Failed to send reply" }, { status: 500 });
  }
}
