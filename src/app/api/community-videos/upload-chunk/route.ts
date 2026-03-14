import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { uploadTempChunk } from "@/lib/r2";

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 },
      );
    }

    const uploadId = request.headers.get("x-upload-id");
    const chunkIndex = request.headers.get("x-chunk-index");

    if (!uploadId || chunkIndex === null) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.INVALID_INPUT, "Missing x-upload-id or x-chunk-index headers"),
        { status: 400 },
      );
    }

    const arrayBuf = await request.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    if (buffer.length === 0) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.INVALID_INPUT, "Empty chunk"),
        { status: 400 },
      );
    }

    const result = await uploadTempChunk(uploadId, parseInt(chunkIndex, 10), buffer);

    if (!result.success) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.INTERNAL_ERROR, result.error || "Chunk upload failed"),
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[upload-chunk]", error);
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR),
      { status: 500 },
    );
  }
}
