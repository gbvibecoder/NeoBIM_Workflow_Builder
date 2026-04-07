import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse } from "@/lib/user-errors";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { generateId } from "@/lib/utils";

/**
 * POST /api/share/video
 * Creates a public, slug-addressed share link for a generated walkthrough video.
 *
 * Body: { videoUrl: string, title?: string, expiresInDays?: number }
 * Returns: { slug: string, shareUrl: string, expiresAt: string | null }
 *
 * Rate limit: 10 shares per hour per user (per checkEndpointRateLimit).
 *
 * The slug is a 12-char base36 ID (collision probability negligible at 36^12).
 * Public consumption happens at GET /share/[slug] (rendered by app/share/[slug]/page.tsx).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse({ title: "Unauthorized", message: "Please sign in to share videos.", code: "AUTH_001" }),
      { status: 401 },
    );
  }

  // Rate limit: 10 share creations per hour per user.
  const rl = await checkEndpointRateLimit(session.user.id, "share-video", 10, "1 h");
  if (!rl.success) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Too many share links",
        message: "You can create up to 10 share links per hour. Please try again later.",
        code: "RATE_001",
      }),
      { status: 429 },
    );
  }

  let body: { videoUrl?: unknown; title?: unknown; expiresInDays?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      formatErrorResponse({ title: "Invalid request", message: "Request body must be valid JSON.", code: "VAL_001" }),
      { status: 400 },
    );
  }

  const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : null;
  const expiresInDays =
    typeof body.expiresInDays === "number" && body.expiresInDays > 0 && body.expiresInDays <= 365
      ? Math.floor(body.expiresInDays)
      : null;

  // URL validation: must be http(s), reject localhost / private IPs to prevent SSRF-style abuse
  if (!videoUrl) {
    return NextResponse.json(
      formatErrorResponse({ title: "Missing video URL", message: "videoUrl is required.", code: "VAL_001" }),
      { status: 400 },
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    return NextResponse.json(
      formatErrorResponse({ title: "Invalid URL", message: "videoUrl must be a valid URL.", code: "VAL_001" }),
      { status: 400 },
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json(
      formatErrorResponse({ title: "Invalid URL scheme", message: "Only http(s) URLs can be shared.", code: "VAL_001" }),
      { status: 400 },
    );
  }
  // Block obviously local hosts so users can't generate share links pointing at internal infra.
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Cannot share local URL",
        message: "Local and private network URLs cannot be shared publicly.",
        code: "VAL_001",
      }),
      { status: 400 },
    );
  }

  // Generate a unique slug. Loop a few times in the (vanishingly unlikely) event of a collision.
  let slug = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateId();
    const existing = await prisma.videoShareLink.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) {
      slug = candidate;
      break;
    }
  }
  if (!slug) {
    return NextResponse.json(
      formatErrorResponse({ title: "Slug generation failed", message: "Could not generate a unique share link. Please try again.", code: "NET_001" }),
      { status: 500 },
    );
  }

  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400_000) : null;

  try {
    const link = await prisma.videoShareLink.create({
      data: {
        slug,
        videoUrl,
        title,
        expiresAt,
        createdById: session.user.id,
      },
      select: { slug: true, expiresAt: true },
    });

    // Build absolute share URL from the request origin so the response is copy-paste ready.
    const origin =
      req.headers.get("origin") ??
      process.env.NEXT_PUBLIC_APP_URL ??
      `${parsed.protocol}//${req.headers.get("host") ?? "localhost:3000"}`;

    return NextResponse.json({
      slug: link.slug,
      shareUrl: `${origin.replace(/\/+$/, "")}/share/${link.slug}`,
      expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[share/video] Error creating share link:", msg);
    return NextResponse.json(
      formatErrorResponse({ title: "Could not create share link", message: msg, code: "NET_001" }),
      { status: 500 },
    );
  }
}
