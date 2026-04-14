import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { safeErrorMessage } from "@/lib/safe-error";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";

export const maxDuration = 180; // Vercel: allow 180s for IFC parsing

const MAX_IFC_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * Validate that an IFC URL points to our R2 storage — never let the server
 * fetch arbitrary URLs on behalf of a caller (SSRF). We accept:
 *   - same-origin relative paths (/r2-upload/... or /r2-models/...)
 *   - R2 CDN public URL prefix (R2_PUBLIC_URL)
 *   - R2 account-bucket URL prefix (https://<acct>.r2.cloudflarestorage.com/<bucket>/)
 *
 * Any URL that doesn't match is rejected with 400.
 */
function isAllowedIfcUrl(url: string): boolean {
  try {
    // Relative paths are fine — they'll be normalized against our own origin.
    if (url.startsWith("/")) return true;

    const u = new URL(url);

    const publicUrl = process.env.R2_PUBLIC_URL;
    if (publicUrl && url.startsWith(publicUrl)) return true;

    const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
    if (accountId && u.hostname === `${accountId}.r2.cloudflarestorage.com`) return true;

    // Cloudflare-hosted r2.dev public buckets (explicit allowlist).
    if (u.hostname.endsWith(".r2.dev") || u.hostname.endsWith(".r2.cloudflarestorage.com")) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/** Resolve a relative /r2-upload/... URL against our own origin so we can fetch it. */
function resolveRelativeUrl(relOrAbs: string, req: NextRequest): string {
  if (!relOrAbs.startsWith("/")) return relOrAbs;
  const origin = req.nextUrl.origin;
  return `${origin}${relOrAbs}`;
}

async function parseBuffer(buffer: Uint8Array, fileName: string) {
  const { parseIFCBuffer, createParserDiagnosticCounters } = await import("@/features/ifc/services/ifc-parser");
  const counters = createParserDiagnosticCounters();
  try {
    const result = await parseIFCBuffer(buffer, fileName, undefined, counters);
    const r = result as unknown as Record<string, unknown>;
    const pd = r.parserDiagnostics as Record<string, unknown> | undefined;
    // Breadcrumb: confirms parserDiagnostics made it out of the parser.
    console.info(`[parse-ifc] parserDiagnostics present: ${!!pd}; samples=${Array.isArray(pd?.elementSamples) ? (pd!.elementSamples as unknown[]).length : 0}; smartWarnings=${Array.isArray(pd?.smartWarnings) ? (pd!.smartWarnings as unknown[]).length : 0}`);
    return { result, parserUsed: "web-ifc" as const };
  } catch (wasmErr) {
    console.warn(`[parse-ifc] web-ifc WASM failed: ${wasmErr instanceof Error ? wasmErr.message : wasmErr}`);
    const { parseIFCText } = await import("@/features/ifc/services/ifc-text-parser");
    const textContent = new TextDecoder().decode(buffer);
    const result = parseIFCText(textContent);
    return { result, parserUsed: "text-regex" as const, wasmError: wasmErr instanceof Error ? wasmErr.message : String(wasmErr) };
  }
}

function validateHeader(buffer: Uint8Array): boolean {
  const headerStr = new TextDecoder().decode(buffer.slice(0, 64));
  return headerStr.startsWith("ISO-10303-21;");
}

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
    const contentType = req.headers.get("content-type") || "";

    // ── Path A: JSON body with ifcUrl (primary path for files > 4.5 MB) ──
    // Client PUT the file directly to R2 via presigned URL (bypassing Vercel
    // body limits). Now we fetch it back, parse, and return.
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({})) as { ifcUrl?: string; fileName?: string };
      const ifcUrl = typeof body.ifcUrl === "string" ? body.ifcUrl : "";
      const fileName = typeof body.fileName === "string" && body.fileName ? body.fileName : "uploaded.ifc";

      if (!ifcUrl) {
        return NextResponse.json(formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("ifcUrl")), { status: 400 });
      }
      if (!isAllowedIfcUrl(ifcUrl)) {
        return NextResponse.json(
          formatErrorResponse({ title: "Invalid URL", message: "ifcUrl must point to our R2 storage.", code: "VAL_001" }),
          { status: 400 },
        );
      }

      const fetchUrl = resolveRelativeUrl(ifcUrl, req);
      let buffer: Uint8Array;
      try {
        const r2Resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(60_000) });
        if (!r2Resp.ok) {
          return NextResponse.json(
            formatErrorResponse({ title: "IFC fetch failed", message: `Could not fetch IFC from storage (${r2Resp.status}). The presigned URL may have expired.`, code: "NET_001" }),
            { status: 502 },
          );
        }
        const ab = await r2Resp.arrayBuffer();
        if (ab.byteLength === 0) {
          return NextResponse.json(formatErrorResponse({ title: "Empty file", message: "The uploaded file is empty.", code: "VAL_001" }), { status: 400 });
        }
        if (ab.byteLength > MAX_IFC_SIZE) {
          return NextResponse.json(formatErrorResponse({ title: "File too large", message: "Maximum IFC file size is 100 MB.", code: "VAL_001" }), { status: 413 });
        }
        buffer = new Uint8Array(ab);
      } catch (fetchErr) {
        return NextResponse.json(
          formatErrorResponse({ title: "IFC fetch failed", message: `Could not fetch IFC from storage: ${fetchErr instanceof Error ? fetchErr.message : "unknown error"}`, code: "NET_001" }),
          { status: 502 },
        );
      }

      if (!validateHeader(buffer)) {
        return NextResponse.json(formatErrorResponse(UserErrors.IFC_PARSE_FAILED), { status: 400 });
      }

      const parsed = await parseBuffer(buffer, fileName);
      return NextResponse.json({
        result: parsed.result,
        meta: {
          fileSize: `${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB`,
          fileName,
          ifcUrl,
          parser: parsed.parserUsed,
        },
      });
    }

    // ── Path B: FormData upload (legacy path, works for files up to ~4 MB) ──
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

    if (file.size > MAX_IFC_SIZE) {
      return NextResponse.json(formatErrorResponse({ title: "File too large", message: "File too large. Maximum size is 100MB.", code: "VAL_001" }), { status: 413 });
    }

    const headerBytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const headerStr = new TextDecoder().decode(headerBytes);
    if (!headerStr.startsWith("ISO-10303-21;")) {
      return NextResponse.json(formatErrorResponse(UserErrors.IFC_PARSE_FAILED), { status: 400 });
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseBuffer(buffer, file.name);
    return NextResponse.json({
      result: parsed.result,
      meta: {
        fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        fileName: file.name,
        ifcUrl: null,
        parser: parsed.parserUsed,
      },
    });
  } catch (err) {
    console.error("[parse-ifc]", err);
    return NextResponse.json(formatErrorResponse(UserErrors.INTERNAL_ERROR, safeErrorMessage(err)), { status: 500 });
  }
}
