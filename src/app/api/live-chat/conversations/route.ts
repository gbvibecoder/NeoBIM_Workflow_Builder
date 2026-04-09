import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPlatformAdmin } from "@/lib/platform-admin";
import type { AdminLiveChatConversation } from "@/types/live-chat";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const ownOnly = url.searchParams.get("own") === "true";
  const isAdmin = isPlatformAdmin(session.user.email);

  const where = isAdmin && !ownOnly ? {} : { userId: session.user.id };

  const rows = await prisma.liveChatConversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    include: {
      user: { select: { name: true, email: true } },
      messages: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          content: true,
          senderRole: true,
          senderName: true,
          createdAt: true,
        },
      },
    },
  });

  const conversations: AdminLiveChatConversation[] = rows.map((c) => ({
    id: c.id,
    userId: c.userId,
    status: c.status,
    lastMessageAt: c.lastMessageAt.toISOString(),
    lastAdminReplyAt: c.lastAdminReplyAt?.toISOString() ?? null,
    repliedByAdminId: c.repliedByAdminId,
    repliedByName: c.repliedByName,
    closedByAdminId: c.closedByAdminId,
    closedAt: c.closedAt?.toISOString() ?? null,
    pageContext: c.pageContext,
    userPlan: c.userPlan,
    messageCount: c.messageCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    userName: c.user?.name ?? null,
    userEmail: c.user?.email ?? "",
    lastMessage: c.messages[0]
      ? {
          content: c.messages[0].content,
          senderRole: c.messages[0].senderRole as "USER" | "ADMIN",
          senderName: c.messages[0].senderName,
          createdAt: c.messages[0].createdAt.toISOString(),
        }
      : null,
  }));

  return NextResponse.json({ conversations });
}
