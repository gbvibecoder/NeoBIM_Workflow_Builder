import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkDualVideoStatus } from "@/services/video-service";
import { formatErrorResponse } from "@/lib/user-errors";

/**
 * GET /api/video-status?exteriorTaskId=X&interiorTaskId=Y
 *
 * Polls the Kling API for the status of both video generation tasks.
 * Returns progress percentage (0-100) and video URLs when complete.
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
  const exteriorTaskId = searchParams.get("exteriorTaskId");
  const interiorTaskId = searchParams.get("interiorTaskId");

  if (!exteriorTaskId || !interiorTaskId) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Missing parameters",
        message: "Both exteriorTaskId and interiorTaskId are required.",
        code: "VAL_001",
      }),
      { status: 400 }
    );
  }

  try {
    const status = await checkDualVideoStatus(exteriorTaskId, interiorTaskId);

    return NextResponse.json({
      ...status,
      // Include cost estimate when complete
      ...(status.isComplete && {
        costUsd: 5 * 0.10 + 10 * 0.10, // 5s exterior + 10s interior
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
