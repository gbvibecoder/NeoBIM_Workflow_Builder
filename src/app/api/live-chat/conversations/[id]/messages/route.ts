import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPlatformAdmin } from "@/lib/platform-admin";
import type { LiveChatMessage } from "@/types/live-chat";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;

  const conv = await prisma.liveChatConversation.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true },
  });
  if (!conv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = isPlatformAdmin(session.user.email);
  if (!isAdmin && conv.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.liveChatMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const messages: LiveChatMessage[] = rows.map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    senderRole: m.senderRole as "USER" | "ADMIN",
    senderName: m.senderName,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  return NextResponse.json({ status: conv.status, messages });
}
