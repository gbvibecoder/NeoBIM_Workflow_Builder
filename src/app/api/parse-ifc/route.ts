import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { safeErrorMessage } from "@/lib/safe-error";
import { uploadIFCToR2 } from "@/lib/r2";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export const maxDuration = 180; // Vercel: allow 180s for IFC parsing

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

    if (file.size === 0) {
      return NextResponse.json(formatErrorResponse({ title: "Empty file", message: "The uploaded file is empty. Please select a valid .ifc file.", code: "VAL_001" }), { status: 400 });
    }

    const MAX_IFC_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_IFC_SIZE) {
      return NextResponse.json(formatErrorResponse({ title: "File too large", message: "File too large. Maximum size is 50MB.", code: "VAL_001" }), { status: 413 });
    }

    // Validate IFC file header
    const headerBytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const headerStr = new TextDecoder().decode(headerBytes);
    if (!headerStr.startsWith("ISO-10303-21;")) {
      return NextResponse.json(formatErrorResponse(UserErrors.IFC_PARSE_FAILED), { status: 400 });
    }

    const buffer = new Uint8Array(await file.arrayBuffer());

    // Upload IFC to R2 first (non-blocking for response, but we want the URL)
    let ifcUrl: string | null = null;
    const r2Result = await uploadIFCToR2(buffer, file.name).catch((err) => {
      console.warn("[parse-ifc] R2 upload failed:", err);
      return null;
    });
    if (r2Result) {
      ifcUrl = r2Result.url;
    }

    // ── Parse IFC: Try web-ifc WASM first, fall back to text parser ──
    let result;
    let parserUsed = "web-ifc";

    try {
      console.log(`[parse-ifc] Parsing ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB) with web-ifc WASM...`);
      const { parseIFCBuffer } = await import("@/services/ifc-parser");
      result = await parseIFCBuffer(buffer, file.name);
      console.log(`[parse-ifc] web-ifc success: ${result.summary.processedElements} elements in ${result.meta.processingTimeMs}ms`);
    } catch (wasmErr) {
      // web-ifc failed (memory, timeout, unsupported geometry) — use text parser
      console.warn(`[parse-ifc] web-ifc WASM failed: ${wasmErr instanceof Error ? wasmErr.message : wasmErr}`);
      console.log("[parse-ifc] Falling back to lightweight text parser...");
      parserUsed = "text-regex";

      try {
        const { parseIFCText } = await import("@/services/ifc-text-parser");
        const textContent = new TextDecoder().decode(buffer);
        result = parseIFCText(textContent);
        console.log(`[parse-ifc] Text parser success: ${result.summary.processedElements} elements in ${result.meta.processingTimeMs}ms`);
      } catch (textErr) {
        console.error("[parse-ifc] Both parsers failed:", textErr);
        return NextResponse.json(
          formatErrorResponse({
            title: "IFC parsing failed",
            message: `Could not parse this IFC file. Both WASM and text parsers failed. ${wasmErr instanceof Error ? wasmErr.message : "Unknown error"}`,
            code: "NODE_001",
          }),
          { status: 422 }
        );
      }
    }

    return NextResponse.json({
      result,
      meta: {
        fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        fileName: file.name,
        ifcUrl,
        parser: parserUsed,
      },
    });
  } catch (err) {
    console.error("[parse-ifc]", err);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR, safeErrorMessage(err)), { status: 500 });
  }
}
