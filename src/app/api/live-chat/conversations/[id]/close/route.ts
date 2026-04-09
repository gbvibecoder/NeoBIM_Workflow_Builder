import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { pusherTrigger } from "@/lib/pusher-server";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!isPlatformAdmin(session.user.email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const { id } = await params;

  const conv = await prisma.liveChatConversation.findUnique({ where: { id } });
  if (!conv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (conv.status === "CLOSED") {
    return NextResponse.json({ ok: true, alreadyClosed: true });
  }

  const updated = await prisma.liveChatConversation.update({
    where: { id },
    data: {
      status: "CLOSED",
      closedByAdminId: session.user.id,
      closedAt: new Date(),
    },
  });

  void pusherTrigger(`private-livechat-user-${conv.userId}`, "conversation:closed", {
    conversationId: id,
  });
  void pusherTrigger("private-livechat-admin", "status:changed", {
    conversationId: id,
    status: "CLOSED",
    closedByAdminId: session.user.id,
    updatedAt: updated.updatedAt.toISOString(),
  });

  return NextResponse.json({ ok: true });
}
