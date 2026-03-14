import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { assembleAndUploadVideo } from "@/lib/r2";

// Allow up to 60s for downloading chunks + re-uploading assembled video
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 },
      );
    }

    const body = await request.json();
    const { uploadId, totalChunks, filename } = body;

    if (!uploadId || !totalChunks || !filename) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.INVALID_INPUT, "Missing uploadId, totalChunks, or filename"),
        { status: 400 },
      );
    }

    if (totalChunks > 15) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.INVALID_INPUT, "Too many chunks (max 15)"),
        { status: 400 },
      );
    }

    const result = await assembleAndUploadVideo(uploadId, totalChunks, filename);

    if (!result.success) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.INTERNAL_ERROR, result.error || "Assembly failed"),
        { status: 500 },
      );
    }

    return NextResponse.json({ publicUrl: result.url });
  } catch (error) {
    console.error("[upload-complete]", error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 },
    );
  }
}
