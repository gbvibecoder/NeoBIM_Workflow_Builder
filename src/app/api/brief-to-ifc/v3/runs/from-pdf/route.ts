/**
 * POST /api/brief-to-ifc/v3/runs/from-pdf
 *
 * Accepts a multipart PDF upload, extracts text via `pdf-parse`
 * (already in package.json — no new dep), then forwards to the
 * existing /api/brief-to-ifc/v3/runs route with the extracted text as
 * the `brief` field.
 *
 * Kept as a thin shim so the canonical run-creation path lives in one
 * file. Auth + canary + rate-limit are inherited via internal fetch to
 * /runs; we DON'T re-implement them here.
 */

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { shouldUseBriefToIfcV3 } from "@/features/brief-to-ifc/v3";

export const maxDuration = 60;

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
const MIN_EXTRACTED_TEXT = 40;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  if (!shouldUseBriefToIfcV3(session.user.email ?? null)) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Feature not available",
        message: "The v3 AI IFC pipeline is not available for your account.",
        code: "BRIEF_TO_IFC_V3_NOT_AVAILABLE",
      }),
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      formatErrorResponse({
        title: "Invalid form upload",
        message: "Could not parse multipart body.",
        code: "INVALID_INPUT",
      }),
      { status: 400 },
    );
  }
  const file = form.get("pdf");
  if (!(file instanceof File)) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Missing PDF",
        message: "Field `pdf` is required.",
        code: "INVALID_INPUT",
      }),
      { status: 400 },
    );
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      formatErrorResponse({
        title: "PDF too large",
        message: "Max 10 MB.",
        code: "INVALID_INPUT",
      }),
      { status: 413 },
    );
  }
  const costCapStr = form.get("cost_cap_usd");
  const costCap =
    typeof costCapStr === "string" ? Number.parseFloat(costCapStr) : NaN;

  // Extract text. `pdf-parse` reads a Buffer; it's CommonJS so dynamic
  // import keeps the bundle slim.
  const buf = Buffer.from(await file.arrayBuffer());
  let extracted = "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = (await import("pdf-parse")).default ?? (await import("pdf-parse"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (pdfParse as any)(buf);
    extracted = String(result?.text ?? "").trim();
  } catch (err) {
    return NextResponse.json(
      formatErrorResponse({
        title: "PDF text extraction failed",
        message: err instanceof Error ? err.message : "Unknown error",
        code: "PDF_EXTRACT_FAILED",
      }),
      { status: 422 },
    );
  }
  if (extracted.length < MIN_EXTRACTED_TEXT) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Could not extract enough text",
        message:
          "The PDF appears to be image-based (scanned) or has very little text. " +
          "Paste the brief into the Text tab instead.",
        code: "PDF_EMPTY_TEXT",
      }),
      { status: 422 },
    );
  }

  // Forward to the canonical /runs endpoint. Internal fetch carries the
  // session cookie so auth + rate-limit + canary all run there.
  const internalBody: Record<string, unknown> = { brief: extracted };
  if (Number.isFinite(costCap) && costCap > 0) {
    internalBody.cost_cap_usd = costCap;
  }
  const origin = req.nextUrl.origin;
  const cookieHeader = req.headers.get("cookie") ?? "";
  const forwarded = await fetch(`${origin}/api/brief-to-ifc/v3/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: cookieHeader,
    },
    body: JSON.stringify(internalBody),
  });
  const data = await forwarded.json().catch(() => ({}));
  return NextResponse.json(data, {
    status: forwarded.status,
    headers: { "Cache-Control": "no-store" },
  });
}
