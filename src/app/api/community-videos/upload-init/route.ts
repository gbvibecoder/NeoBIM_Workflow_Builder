import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { isR2Configured } from "@/lib/r2";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 },
      );
    }

    if (!isR2Configured()) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.INTERNAL_ERROR, "Storage not configured"),
        { status: 500 },
      );
    }

    const body = await request.json();
    const fileSize: number = body.fileSize || 0;

    if (fileSize > 50 * 1024 * 1024) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.INVALID_INPUT, "Video must be under 50MB"),
        { status: 400 },
      );
    }

    const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    return NextResponse.json({ uploadId });
  } catch (error) {
    console.error("[upload-init]", error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 },
    );
  }
}
