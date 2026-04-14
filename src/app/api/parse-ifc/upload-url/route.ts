import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createPresignedUploadUrl, ensureBucketCors } from "@/lib/r2";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

// Auto-ensure CORS on first presigned URL request (self-healing, runs once per cold start).
let corsEnsured = false;
async function ensureCorsOnce() {
  if (corsEnsured) return;
  try {
    const result = await ensureBucketCors();
    if (result.success) corsEnsured = true;
    else console.warn("[parse-ifc/upload-url] CORS auto-config failed:", result.error);
  } catch (err) {
    console.warn("[parse-ifc/upload-url] CORS auto-config error:", err);
  }
}

/**
 * POST /api/parse-ifc/upload-url
 *
 * Generates a presigned R2 upload URL for an IFC file. The browser PUTs the
 * file directly to R2 via the `/r2-upload/*` Next.js rewrite, which routes
 * at the Vercel edge layer and does NOT hit a serverless function — so the
 * Vercel 4.5 MB request-body cap does not apply. This lets us push 100 MB
 * IFCs straight to R2 without any body-limit workarounds.
 *
 * Body: { filename: string, fileSize?: number, contentType?: string }
 * Returns: { uploadUrl, publicUrl, key, contentType, expiresIn }
 *
 * Downstream: client PUTs file to `uploadUrl` with the same Content-Type,
 * then POSTs `{ ifcUrl: publicUrl, fileName }` to /api/parse-ifc to parse
 * server-side with full diagnostics.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), { status: 401 });
    }

    // Rate limit: 30 presigned URLs per user per hour — generous for iterative
    // uploads while still curbing abuse. Each URL is valid for 10 min.
    const rateLimit = await checkEndpointRateLimit(session.user.id, "parse-ifc-upload-url", 30, "1 h");
    if (!rateLimit.success) {
      return NextResponse.json(
        formatErrorResponse({ title: "Too many requests", message: "Please wait before uploading more IFC files.", code: "RATE_001" }),
        { status: 429 },
      );
    }

    await ensureCorsOnce();

    const body = await request.json().catch(() => ({}));
    const rawFilename = typeof body.filename === "string" ? body.filename : "model.ifc";
    const fileSize = typeof body.fileSize === "number" ? body.fileSize : 0;
    // IFC files don't have a registered MIME — use octet-stream to match signing.
    const contentType = typeof body.contentType === "string" && body.contentType
      ? body.contentType
      : "application/octet-stream";

    // Validate size hint. Actual R2 PUT enforces nothing, but this catches
    // typos before we hand out a useless URL.
    if (fileSize > 0 && fileSize > 100 * 1024 * 1024) {
      return NextResponse.json(
        formatErrorResponse({ title: "File too large", message: "Maximum IFC file size is 100 MB.", code: "VAL_001" }),
        { status: 413 },
      );
    }

    // Ensure .ifc suffix so the R2 key is recognizable.
    const baseName = rawFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    const filename = baseName.toLowerCase().endsWith(".ifc") ? baseName : `${baseName}.ifc`;

    const result = await createPresignedUploadUrl(filename, contentType, 600, "ifc");
    if (!result) {
      return NextResponse.json(
        formatErrorResponse({ title: "Upload URL unavailable", message: "Storage is not configured. Contact support.", code: "NET_001" }),
        { status: 500 },
      );
    }

    return NextResponse.json({
      uploadUrl: result.uploadUrl,
      publicUrl: result.publicUrl,
      key: result.key,
      contentType,
      expiresIn: 600,
    });
  } catch (err) {
    console.error("[parse-ifc/upload-url]", err);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR), { status: 500 });
  }
}
