import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createPresignedUploadUrl, ensureBucketCors } from "@/lib/r2";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

// Auto-ensure CORS on first presigned URL request (self-healing)
let corsEnsured = false;

async function ensureCorsOnce() {
  if (corsEnsured) return;
  try {
    const result = await ensureBucketCors();
    if (result.success) {
      corsEnsured = true;
      console.log("[upload-url] CORS auto-configured on first request");
    } else {
      console.warn("[upload-url] CORS auto-config failed:", result.error);
    }
  } catch (err) {
    console.warn("[upload-url] CORS auto-config error:", err);
  }
}

// POST /api/community-videos/upload-url
// Returns a presigned R2 URL for direct browser upload (bypasses Vercel body limit)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 },
      );
    }

    // Rate limit: 20 presigned URLs per user per hour
    const rateLimit = await checkEndpointRateLimit(session.user.id, "upload-url", 20, "1 h");
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Too many requests", message: "Please wait before uploading more.", code: "RATE_001" }),
        { status: 429 },
      );
    }

    // Ensure bucket CORS is configured (runs once per cold start)
    await ensureCorsOnce();

    const body = await request.json();
    const filename: string = body.filename || "video.mp4";
    const contentType: string = body.contentType || "video/mp4";
    const fileSize: number = body.fileSize || 0;

    // Validate
    if (fileSize > 50 * 1024 * 1024) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.INVALID_INPUT, "Video must be under 50MB"),
        { status: 400 },
      );
    }

    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const result = await createPresignedUploadUrl(
      `community-${sanitized}`,
      contentType,
    );

    if (!result) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.INTERNAL_ERROR, "Could not generate upload URL"),
        { status: 500 },
      );
    }

    return NextResponse.json({
      uploadUrl: result.uploadUrl,
      key: result.key,
      publicUrl: result.publicUrl,
    });
  } catch (error) {
    console.error("[upload-url]", error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 },
    );
  }
}
