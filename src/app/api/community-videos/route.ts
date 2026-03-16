import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import {
  formatErrorResponse,
  UserErrors,
} from "@/lib/user-errors";

// ─── GET — List community videos (public) ───────────────────────────────────

export async function GET() {
  try {
    const videos = await prisma.communityVideo.findMany({
      where: { isApproved: true },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: {
        author: {
          select: { id: true, name: true, image: true },
        },
      },
    });

    const response = NextResponse.json({ videos });
    response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return response;
  } catch (error) {
    console.error("[community-videos GET]", error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 },
    );
  }
}

// ─── POST — Create community video record (auth required) ───────────────────
// Expects JSON body: { videoUrl, title, description?, category?, duration? }
// The video file is uploaded directly to R2 via presigned URL (see /upload-url route)

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 },
      );
    }

    // Rate limit: 5 video creations per user per hour
    const rateLimit = await checkEndpointRateLimit(session.user.id, "community-video-create", 5, "1 h");
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Too many requests", message: "Please wait before creating more videos.", code: "RATE_001" }),
        { status: 429 },
      );
    }

    const body = await request.json();
    const videoUrl: string = body.videoUrl;
    const title: string = (body.title || "").trim();
    const description: string | null = (body.description || "").trim() || null;
    const category: string = body.category || "General";
    const duration: string | null = body.duration || null;

    // ── Validate ─────────────────────────────────────────────────────────────

    if (!videoUrl) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("videoUrl")),
        { status: 400 },
      );
    }
    if (!title || title.length < 3) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("title")),
        { status: 400 },
      );
    }

    // ── Create DB record ─────────────────────────────────────────────────────

    const video = await prisma.communityVideo.create({
      data: {
        authorId: session.user.id,
        title: title.slice(0, 120),
        description: description?.slice(0, 500) || null,
        category,
        videoUrl,
        duration,
      },
      include: {
        author: {
          select: { id: true, name: true, image: true },
        },
      },
    });

    return NextResponse.json({ video }, { status: 201 });
  } catch (error) {
    console.error("[community-videos POST]", error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 },
    );
  }
}
