/**
 * POST /api/upload-brief
 *
 * Accepts a PDF or DOCX architectural brief (≤ 50 MB), validates extension
 * + magic bytes, uploads to R2 under the `briefs/` prefix, and returns the
 * public URL. Mirrors `POST /api/upload-ifc` so the same operational
 * pattern applies.
 *
 * Phase 1 of the Brief-to-Renders pipeline. Downstream phases consume
 * `briefUrl` from the response when creating a `BriefRenderJob` row.
 *
 * Validation order matters — we reject the cheapest checks first to keep
 * abusive payloads cheap to refuse:
 *   1. Auth + per-endpoint rate limit (10 req/min/user).
 *   2. File presence in form-data.
 *   3. Filename extension (`.pdf` or `.docx`).
 *   4. Size cap (50 MB).
 *   5. Magic-byte signature (`%PDF-` for PDF; `PK\x03\x04` ZIP for DOCX).
 *   6. R2 upload.
 *
 * Errors flow through `formatErrorResponse` with `UserError` codes so the
 * client surfaces the same UX as every other route.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { uploadBriefToR2 } from "@/lib/r2";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export const maxDuration = 60;

const MAX_BRIEF_SIZE = 50 * 1024 * 1024; // 50 MB — must match r2.ts MAX_BRIEF_SIZE

// PDF magic bytes: `%PDF-` (5 bytes) — every conforming PDF starts with these
// per ISO 32000 §7.5.2 (a leading whitespace allowance exists in practice but
// we reject leading whitespace because production briefs never have it and
// allowing it widens the attack surface).
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

// DOCX is a ZIP archive — the first four bytes are the standard
// "local file header" signature.
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type BriefKind = "pdf" | "docx";

function classifyByExtension(filename: string): BriefKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

function startsWithMagic(buffer: Uint8Array, magic: Buffer): boolean {
  if (buffer.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse(UserErrors.UNAUTHORIZED),
      { status: 401 },
    );
  }

  const rateLimit = await checkEndpointRateLimit(
    session.user.id,
    "upload-brief",
    10,
    "1 m",
  );
  if (!rateLimit.success) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Too many requests",
        message: "Too many requests. Please wait a moment.",
        code: "RATE_001",
      }),
      { status: 429 },
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("file")),
        { status: 400 },
      );
    }

    const kind = classifyByExtension(file.name);
    if (!kind) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Invalid file type",
          message:
            "Brief must be a .pdf or .docx file. Please re-export from your source tool and upload again.",
          code: "VAL_001",
        }),
        { status: 400 },
      );
    }

    if (file.size > MAX_BRIEF_SIZE) {
      return NextResponse.json(
        formatErrorResponse({
          title: "File too large",
          message: `Maximum brief size is ${MAX_BRIEF_SIZE / 1024 / 1024}MB.`,
          code: "VAL_001",
        }),
        { status: 413 },
      );
    }

    const buffer = new Uint8Array(await file.arrayBuffer());

    // Magic-byte validation. We do this AFTER the size check so we never
    // pull a multi-GB body into memory just to refuse it.
    const expectedMagic = kind === "pdf" ? PDF_MAGIC : ZIP_MAGIC;
    if (!startsWithMagic(buffer, expectedMagic)) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Invalid file content",
          message:
            kind === "pdf"
              ? "This file does not look like a valid PDF (missing %PDF- header). Re-export and try again."
              : "This file does not look like a valid DOCX (missing ZIP header). Re-export from Word and try again.",
          code: "VAL_001",
        }),
        { status: 400 },
      );
    }

    const contentType = kind === "pdf" ? PDF_MIME : DOCX_MIME;
    const result = await uploadBriefToR2(buffer, file.name, contentType);

    if (!result.success) {
      // Most likely cause in production: R2 unconfigured. The client
      // gets a clear "storage misconfigured" error instead of a 500.
      return NextResponse.json(
        formatErrorResponse({
          title: "Upload failed",
          message:
            "Failed to upload brief to storage. R2 may not be configured.",
          code: "NET_001",
        }),
        { status: 500 },
      );
    }

    return NextResponse.json({
      briefUrl: result.url,
      fileName: file.name,
      fileSize: file.size,
      mimeType: contentType,
    });
  } catch (err) {
    console.error("[upload-brief]", err);
    return NextResponse.json(
      formatErrorResponse({
        title: "Upload failed",
        message: "An unexpected error occurred during upload.",
        code: "NET_001",
      }),
      { status: 500 },
    );
  }
}
