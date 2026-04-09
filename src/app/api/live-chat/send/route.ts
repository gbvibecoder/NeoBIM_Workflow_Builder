import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { pusherTrigger } from "@/lib/pusher-server";
import type {
  LiveChatMessage,
  AdminLiveChatConversation,
} from "@/features/support/types/live-chat";

const MAX_MESSAGE_LENGTH = 3000;
const MAX_MESSAGES_PER_CONVERSATION = 200;

function err(code: string, title: string, message: string, status: number) {
  return NextResponse.json(
    { error: { title, message, code } },
    { status },
  );
}

function serializeMessage(m: {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: "USER" | "ADMIN";
  senderName: string | null;
  content: string;
  createdAt: Date;
}): LiveChatMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    senderRole: m.senderRole,
    senderName: m.senderName,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      return err("AUTH_001", "Not signed in", "Please sign in to continue.", 401);
    }

    const userId = session.user.id;
    const userEmail = session.user.email;
    const senderName = session.user.name || userEmail;
    const senderRole: "USER" | "ADMIN" = isPlatformAdmin(userEmail) ? "ADMIN" : "USER";

    const rl = await checkEndpointRateLimit(userId, "live-chat", 10, "1 m");
    if (!rl.success) {
      return err(
        "RATE_001",
        "Slow down",
        "Too many messages. Please wait a moment.",
        429,
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      conversationId?: string | null;
      content?: string;
      pageContext?: string;
    };

    const content = (body.content || "").trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) {
      return err(
        "LC_001",
        "Invalid message",
        `Message must be 1–${MAX_MESSAGE_LENGTH} characters.`,
        400,
      );
    }

    let convId = body.conversationId || null;
    let isNewConversation = false;
    let conversation: Awaited<
      ReturnType<typeof prisma.liveChatConversation.findFirst>
    > = null;

    if (convId) {
      conversation = await prisma.liveChatConversation.findFirst({
        where: { id: convId },
      });
      if (!conversation) {
        return err("LC_002", "Not found", "Conversation not found.", 404);
      }
      if (senderRole === "USER" && conversation.userId !== userId) {
        return err("LC_003", "Forbidden", "You do not have access.", 403);
      }
      if (conversation.status === "CLOSED") {
        return err("LC_004", "Closed", "This conversation has been closed.", 400);
      }
      if (conversation.messageCount >= MAX_MESSAGES_PER_CONVERSATION) {
        return err(
          "LC_005",
          "Message limit",
          "This conversation has reached its message limit.",
          400,
        );
      }
    } else if (senderRole === "USER") {
      // Reuse the user's most-recent open conversation if any
      const existing = await prisma.liveChatConversation.findFirst({
        where: { userId, status: { in: ["WAITING", "ACTIVE"] } },
        orderBy: { lastMessageAt: "desc" },
      });
      if (existing) {
        conversation = existing;
        convId = existing.id;
      } else {
        const userPlan =
          (session.user as { role?: string }).role || "FREE";
        conversation = await prisma.liveChatConversation.create({
          data: {
            userId,
            status: "WAITING",
            pageContext: body.pageContext || null,
            userPlan,
            messageCount: 0,
          },
        });
        convId = conversation.id;
        isNewConversation = true;
      }
    } else {
      // Admin must always supply conversationId
      return err(
        "LC_002",
        "Missing conversation",
        "Conversation id is required for admin replies.",
        400,
      );
    }

    // Persist message
    const created = await prisma.liveChatMessage.create({
      data: {
        conversationId: convId!,
        senderId: userId,
        senderRole,
        senderName,
        content,
      },
    });

    // Conversation update — flip WAITING→ACTIVE on first admin reply
    let statusChanged = false;
    const updateData: Record<string, unknown> = {
      lastMessageAt: new Date(),
      messageCount: { increment: 1 },
    };
    if (senderRole === "USER" && body.pageContext) {
      updateData.pageContext = body.pageContext;
    }
    if (senderRole === "ADMIN" && conversation!.status === "WAITING") {
      updateData.status = "ACTIVE";
      updateData.repliedByAdminId = userId;
      updateData.repliedByName = senderName;
      updateData.lastAdminReplyAt = new Date();
      statusChanged = true;
    } else if (senderRole === "ADMIN") {
      updateData.lastAdminReplyAt = new Date();
    }

    const updatedConv = await prisma.liveChatConversation.update({
      where: { id: convId! },
      data: updateData,
    });

    const messagePayload = serializeMessage({
      ...created,
      senderRole: created.senderRole as "USER" | "ADMIN",
    });

    // ── Pusher fire-and-forget ──────────────────────────────────────────
    if (senderRole === "USER") {
      let convSnapshot: AdminLiveChatConversation | null = null;
      if (isNewConversation) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { name: true, email: true },
        });
        convSnapshot = {
          id: updatedConv.id,
          userId: updatedConv.userId,
          status: updatedConv.status,
          lastMessageAt: updatedConv.lastMessageAt.toISOString(),
          lastAdminReplyAt: updatedConv.lastAdminReplyAt?.toISOString() ?? null,
          repliedByAdminId: updatedConv.repliedByAdminId,
          repliedByName: updatedConv.repliedByName,
          closedByAdminId: updatedConv.closedByAdminId,
          closedAt: updatedConv.closedAt?.toISOString() ?? null,
          pageContext: updatedConv.pageContext,
          userPlan: updatedConv.userPlan,
          messageCount: updatedConv.messageCount,
          createdAt: updatedConv.createdAt.toISOString(),
          updatedAt: updatedConv.updatedAt.toISOString(),
          userName: user?.name ?? null,
          userEmail: user?.email ?? "",
          lastMessage: {
            content: messagePayload.content,
            senderRole: messagePayload.senderRole,
            senderName: messagePayload.senderName,
            createdAt: messagePayload.createdAt,
          },
        };
      }
      void pusherTrigger("private-livechat-admin", "message:new", {
        conversationId: convId,
        conversation: convSnapshot,
        message: messagePayload,
      });
    } else {
      // ADMIN reply: notify user + cross-sync other admin
      void pusherTrigger(
        `private-livechat-user-${conversation!.userId}`,
        "message:reply",
        { conversationId: convId, message: messagePayload },
      );
      void pusherTrigger("private-livechat-admin", "message:reply", {
        conversationId: convId,
        message: messagePayload,
      });
      if (statusChanged) {
        void pusherTrigger("private-livechat-admin", "status:changed", {
          conversationId: convId,
          status: "ACTIVE",
          repliedByName: senderName,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      conversationId: convId,
      message: messagePayload,
      isNewConversation,
    });
  } catch (e) {
    console.error("[live-chat/send] error:", e);
    return err("NET_001", "Server error", "Something went wrong.", 500);
  }
}
