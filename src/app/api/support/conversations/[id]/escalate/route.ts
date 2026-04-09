import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateConversationSummary } from "@/features/support/services/support-chat-service";
import { sendSupportEscalationEmail } from "@/shared/services/email";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;

    // Verify ownership
    const conversation = await prisma.supportConversation.findFirst({
      where: { id, userId: session.user.id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          take: 30,
          select: { role: true, content: true },
        },
        user: { select: { name: true, email: true, role: true } },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (conversation.status === "ESCALATED") {
      return NextResponse.json({ error: "Already escalated" }, { status: 400 });
    }

    // Generate summary
    const summary = await generateConversationSummary(
      conversation.messages.map((m) => ({ role: m.role, content: m.content })),
    );

    // Merge metadata (preserve existing fields)
    const existingMeta = (conversation.metadata && typeof conversation.metadata === "object")
      ? conversation.metadata as Record<string, unknown>
      : {};
    const mergedMeta = reason
      ? { ...existingMeta, escalationReason: reason }
      : existingMeta;

    // Update conversation + add system message atomically
    await prisma.$transaction([
      prisma.supportConversation.update({
        where: { id },
        data: {
          status: "ESCALATED",
          escalatedAt: new Date(),
          summary,
          metadata: JSON.parse(JSON.stringify(mergedMeta)),
          messageCount: { increment: 1 },
          lastMessageAt: new Date(),
        },
      }),
      prisma.supportMessage.create({
        data: {
          conversationId: id,
          role: "SYSTEM",
          content: "This conversation has been escalated to our support team. We'll get back to you as soon as possible.",
        },
      }),
    ]);

    // Send email notification to admin (fire-and-forget)
    sendSupportEscalationEmail({
      userName: conversation.user.name || "User",
      userEmail: conversation.user.email,
      userPlan: conversation.user.role,
      subject: conversation.subject || "Support request",
      summary,
      conversationId: id,
      firstMessages: conversation.messages.slice(0, 3).map((m) => ({
        role: m.role,
        content: m.content.slice(0, 200),
      })),
    }).catch((err) => {
      console.error("[support] Failed to send escalation email:", err);
    });

    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error("[support/escalate] Error:", error);
    return NextResponse.json(
      { error: "Failed to escalate conversation" },
      { status: 500 },
    );
  }
}
