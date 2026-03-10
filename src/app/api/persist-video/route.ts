import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadVideoToR2, isR2Configured } from "@/lib/r2";
import { formatErrorResponse } from "@/lib/user-errors";

/**
 * POST /api/persist-video
 * Downloads a video from the given URL and persists it to R2.
 * Returns the permanent R2 URL.
 *
 * Body: { videoUrl: string, filename?: string }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse({ title: "Unauthorized", message: "Please sign in", code: "AUTH_001" }),
      { status: 401 },
    );
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      formatErrorResponse({ title: "Storage not configured", message: "R2 storage is not configured", code: "NET_001" }),
      { status: 503 },
    );
  }

  try {
    const { videoUrl, filename } = await req.json();

    if (!videoUrl || typeof videoUrl !== "string") {
      return NextResponse.json(
        formatErrorResponse({ title: "Missing video URL", message: "A valid videoUrl is required", code: "VAL_001" }),
        { status: 400 },
      );
    }

    // Download the video from Kling URL
    const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!videoRes.ok) {
      return NextResponse.json(
        formatErrorResponse({ title: "Download failed", message: `HTTP ${videoRes.status}`, code: "NET_001" }),
        { status: 502 },
      );
    }

    const arrayBuffer = await videoRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const safeName = (filename ?? `walkthrough-${Date.now()}.mp4`)
      .replace(/[^a-zA-Z0-9._-]/g, "_");

    const result = await uploadVideoToR2(buffer, safeName);
    if (!result.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Upload failed", message: result.error, code: "NET_001" }),
        { status: 500 },
      );
    }

    return NextResponse.json({
      persistedUrl: result.url,
      key: result.key,
      size: result.size,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[persist-video] Error:", msg);
    return NextResponse.json(
      formatErrorResponse({ title: "Persist video failed", message: msg, code: "NET_001" }),
      { status: 500 },
    );
  }
}
