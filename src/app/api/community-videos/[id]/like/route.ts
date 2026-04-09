import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";

// POST /api/community-videos/[id]/like — idempotent per-user like/unlike
//
// Body: { action: "like" | "unlike" }
//
// Backed by the community_video_likes join table so duplicate clicks are no-ops
// and the CommunityVideo.likes counter cannot drift via spam-clicking, clearing
// localStorage, or switching devices. The denormalized counter is updated
// transactionally alongside the join row only when the row state actually
// changes (create on like-fresh, delete on unlike-existing).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { id: videoId } = await params;

    // Rate limit: 10 like-actions per user per minute (unchanged)
    const rateLimit = await checkEndpointRateLimit(userId, "community-video-like", 10, "1 m");
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const action: "like" | "unlike" = body.action === "unlike" ? "unlike" : "like";

    // Atomic: read state → adjust join row → adjust counter only if state changed.
    // Race window between findUnique and create is theoretically possible for
    // simultaneous double-clicks; the @@unique([userId, videoId]) constraint
    // catches it as P2002 → caller-visible 500, retry self-corrects.
    const result = await prisma.$transaction(async (tx) => {
      if (action === "like") {
        const existing = await tx.communityVideoLike.findUnique({
          where: { userId_videoId: { userId, videoId } },
          select: { id: true },
        });
        if (existing) {
          const v = await tx.communityVideo.findUnique({
            where: { id: videoId },
            select: { likes: true },
          });
          if (!v) throw new Prisma.PrismaClientKnownRequestError("Video not found", { code: "P2025", clientVersion: "manual" });
          return { likes: v.likes, isLikedByMe: true };
        }
        await tx.communityVideoLike.create({ data: { userId, videoId } });
        const v = await tx.communityVideo.update({
          where: { id: videoId },
          data: { likes: { increment: 1 } },
          select: { likes: true },
        });
        return { likes: v.likes, isLikedByMe: true };
      }

      // action === "unlike"
      const deleted = await tx.communityVideoLike.deleteMany({
        where: { userId, videoId },
      });
      if (deleted.count === 0) {
        const v = await tx.communityVideo.findUnique({
          where: { id: videoId },
          select: { likes: true },
        });
        if (!v) throw new Prisma.PrismaClientKnownRequestError("Video not found", { code: "P2025", clientVersion: "manual" });
        return { likes: v.likes, isLikedByMe: false };
      }
      const v = await tx.communityVideo.update({
        where: { id: videoId },
        data: { likes: { decrement: 1 } },
        select: { likes: true },
      });
      if (v.likes < 0) {
        const fixed = await tx.communityVideo.update({
          where: { id: videoId },
          data: { likes: 0 },
          select: { likes: true },
        });
        return { likes: fixed.likes, isLikedByMe: false };
      }
      return { likes: v.likes, isLikedByMe: false };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // P2003: foreign key violation (video doesn't exist on create)
      // P2025: record not found (update/find on missing video)
      if (err.code === "P2003" || err.code === "P2025") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
    console.error("[community-videos like POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
