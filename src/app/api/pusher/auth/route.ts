import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPusherServer } from "@/lib/pusher-server";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { prisma } from "@/lib/db";

// Pusher private/presence channel auth. Called by pusher-js when subscribing.
// Body is application/x-www-form-urlencoded: socket_id + channel_name.

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const pusher = getPusherServer();
  if (!pusher) {
    return NextResponse.json({ error: "Realtime unavailable" }, { status: 503 });
  }

  const formData = await req.formData();
  const socketId = String(formData.get("socket_id") || "");
  const channel = String(formData.get("channel_name") || "");

  if (!socketId || !channel) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const userId = session.user.id;
  const email = session.user.email;
  const isAdmin = isPlatformAdmin(email);

  // ── Channel authorization ────────────────────────────────────────────
  if (channel === "private-livechat-admin" || channel === "presence-livechat-admin") {
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (channel.startsWith("private-livechat-user-")) {
    const channelUserId = channel.slice("private-livechat-user-".length);
    if (channelUserId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (channel.startsWith("private-livechat-conv-")) {
    const convId = channel.slice("private-livechat-conv-".length);
    if (!isAdmin) {
      const conv = await prisma.liveChatConversation.findFirst({
        where: { id: convId, userId },
        select: { id: true },
      });
      if (!conv) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    if (channel.startsWith("presence-")) {
      const authResponse = pusher.authorizeChannel(socketId, channel, {
        user_id: userId,
        user_info: {
          name: session.user.name ?? null,
          email,
        },
      });
      return NextResponse.json(authResponse);
    }
    const authResponse = pusher.authorizeChannel(socketId, channel);
    return NextResponse.json(authResponse);
  } catch (err) {
    console.error("[pusher/auth] authorizeChannel failed:", err);
    return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }
}
