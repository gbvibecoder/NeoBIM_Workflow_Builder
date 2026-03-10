import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkDualVideoStatus, checkDualTextVideoStatus, checkSingleVideoStatus } from "@/services/video-service";
import { formatErrorResponse } from "@/lib/user-errors";

/**
 * GET /api/video-status?taskId=X              (single 10s video)
 * GET /api/video-status?exteriorTaskId=X&interiorTaskId=Y  (dual 5s+10s)
 * GET /api/video-status?exteriorTaskId=X&interiorTaskId=Y&pipeline=image2video|text2video
 *
 * Polls the Kling API for video generation status.
 * Supports single video, dual video, and text2video pipelines.
 * Returns progress percentage (0-100) and video URL(s) when complete.
 */
export async function GET(req: NextRequest) {
  // Auth check
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse({ title: "Unauthorized", message: "Please sign in.", code: "AUTH_001" }),
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const singleTaskId = searchParams.get("taskId");
  const exteriorTaskId = searchParams.get("exteriorTaskId");
  const interiorTaskId = searchParams.get("interiorTaskId");
  const pipeline = searchParams.get("pipeline") ?? "image2video";

  try {
    // ── Single video mode (floor plans) ──
    if (singleTaskId) {
      console.log("[POLL] /api/video-status (single) taskId:", singleTaskId);
      const status = await checkSingleVideoStatus(singleTaskId);
      console.log("[POLL] checkSingleVideoStatus result:", JSON.stringify(status));

      return NextResponse.json({
        ...status,
        mode: "single",
        ...(status.isComplete && {
          costUsd: 10 * 0.10,
          totalDurationSeconds: 10,
        }),
      });
    }

    // ── Dual video mode (concept renders / text2video) ──
    if (!exteriorTaskId || !interiorTaskId) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Missing parameters",
          message: "Provide either taskId (single) or both exteriorTaskId and interiorTaskId (dual).",
          code: "VAL_001",
        }),
        { status: 400 }
      );
    }

    console.log("[POLL] /api/video-status (dual) exteriorTaskId:", exteriorTaskId, "interiorTaskId:", interiorTaskId, "pipeline:", pipeline);
    const status = pipeline === "text2video"
      ? await checkDualTextVideoStatus(exteriorTaskId, interiorTaskId)
      : await checkDualVideoStatus(exteriorTaskId, interiorTaskId);
    console.log("[POLL] checkDualVideoStatus result:", JSON.stringify(status));

    return NextResponse.json({
      ...status,
      mode: "dual",
      ...(status.isComplete && {
        costUsd: 5 * 0.10 + 10 * 0.10,
        totalDurationSeconds: 15,
      }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to check video status";
    console.error("[video-status] Error:", msg);

    return NextResponse.json(
      formatErrorResponse({
        title: "Video status check failed",
        message: msg,
        code: "NODE_001",
      }),
      { status: 500 }
    );
  }
}
