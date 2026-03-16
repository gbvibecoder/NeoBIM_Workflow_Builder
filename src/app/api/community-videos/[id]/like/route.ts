import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";

// POST /api/community-videos/[id]/like — toggle like count (auth required)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 10 likes per user per minute
    const rateLimit = await checkEndpointRateLimit(session.user.id, "community-video-like", 10, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const increment = body.action === "unlike" ? -1 : 1;

    const video = await prisma.communityVideo.update({
      where: { id },
      data: { likes: { increment } },
      select: { likes: true },
    });

    // Prevent negative likes
    if (video.likes < 0) {
      await prisma.communityVideo.update({
        where: { id },
        data: { likes: 0 },
      });
      return NextResponse.json({ likes: 0 });
    }

    return NextResponse.json({ likes: video.likes });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
