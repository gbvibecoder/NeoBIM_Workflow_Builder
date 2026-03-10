import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { safeErrorMessage } from "@/lib/safe-error";
import { uploadIFCToR2 } from "@/lib/r2";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export const maxDuration = 60; // Vercel: allow 60s for WASM parsing

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
  }

  const rateLimit = await checkEndpointRateLimit(session.user.id, "parse-ifc", 10, "1 m");
  if (!rateLimit.success) {
    return NextResponse.json(formatErrorResponse({ title: "Too many requests", message: "Too many requests. Please wait a moment.", code: "RATE_001" }), { status: 429 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("file")), { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".ifc")) {
      return NextResponse.json(formatErrorResponse({ title: "Invalid file type", message: "Invalid file type. Please upload an .ifc file.", code: "VAL_001" }), { status: 400 });
    }

    // Reject empty files
    if (file.size === 0) {
      return NextResponse.json(formatErrorResponse({ title: "Empty file", message: "The uploaded file is empty. Please select a valid .ifc file.", code: "VAL_001" }), { status: 400 });
    }

    // Reject files over 50MB
    const MAX_IFC_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_IFC_SIZE) {
      return NextResponse.json(formatErrorResponse({ title: "File too large", message: "File too large. Maximum size is 50MB.", code: "VAL_001" }), { status: 413 });
    }

    // Validate IFC file header
    const headerBytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const headerStr = new TextDecoder().decode(headerBytes);
    if (!headerStr.startsWith("ISO-10303-21;")) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.IFC_PARSE_FAILED),
        { status: 400 }
      );
    }

    // ⚡ DYNAMIC IMPORT - Lazy load 23MB web-ifc library only when needed
    const { parseIFCBuffer } = await import("@/services/ifc-parser");
    
    const buffer = new Uint8Array(await file.arrayBuffer());
    const result = await parseIFCBuffer(buffer, file.name);

    // Upload IFC to R2 for 3-day session persistence (fire-and-forget, non-blocking)
    let ifcUrl: string | null = null;
    const r2Result = await uploadIFCToR2(buffer, file.name).catch(() => null);
    if (r2Result) {
      ifcUrl = r2Result.url;
    }

    return NextResponse.json({
      result,
      meta: {
        fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        fileName: file.name,
        ifcUrl, // R2 URL for re-download within 3 days (null if R2 not configured)
      },
    });
  } catch (err) {
    console.error("[parse-ifc]", err);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR, safeErrorMessage(err)), { status: 500 });
  }
}
