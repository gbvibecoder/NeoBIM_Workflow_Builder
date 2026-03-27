import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { uploadIFCToR2 } from "@/lib/r2";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
  }

  const rateLimit = await checkEndpointRateLimit(session.user.id, "upload-ifc", 10, "1 m");
  if (!rateLimit.success) {
    return NextResponse.json(
      formatErrorResponse({ title: "Too many requests", message: "Too many requests. Please wait a moment.", code: "RATE_001" }),
      { status: 429 }
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("file")), { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".ifc")) {
      return NextResponse.json(
        formatErrorResponse({ title: "Invalid file type", message: "Only .ifc files accepted.", code: "VAL_001" }),
        { status: 400 }
      );
    }

    const MAX_IFC_SIZE = 100 * 1024 * 1024; // 100MB
    if (file.size > MAX_IFC_SIZE) {
      return NextResponse.json(
        formatErrorResponse({ title: "File too large", message: "Maximum IFC file size is 100MB.", code: "VAL_001" }),
        { status: 413 }
      );
    }

    const buffer = new Uint8Array(await file.arrayBuffer());

    // Validate IFC header
    const headerStr = new TextDecoder().decode(buffer.slice(0, 64));
    if (!headerStr.startsWith("ISO-10303-21;")) {
      return NextResponse.json(
        formatErrorResponse({ title: "Invalid IFC file", message: "File does not have a valid IFC header.", code: "VAL_001" }),
        { status: 400 }
      );
    }

    const r2Result = await uploadIFCToR2(buffer, file.name);
    if (!r2Result) {
      return NextResponse.json(
        formatErrorResponse({ title: "Upload failed", message: "Failed to upload IFC file to storage. R2 may not be configured.", code: "NET_001" }),
        { status: 500 }
      );
    }

    return NextResponse.json({
      ifcUrl: r2Result.url,
      fileName: file.name,
      fileSize: file.size,
    });
  } catch (err) {
    console.error("[upload-ifc]", err);
    return NextResponse.json(
      formatErrorResponse({ title: "Upload failed", message: "An unexpected error occurred during upload.", code: "NET_001" }),
      { status: 500 }
    );
  }
}
