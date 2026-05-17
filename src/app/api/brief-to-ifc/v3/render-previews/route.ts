/**
 * POST /api/brief-to-ifc/v3/render-previews
 *
 * Canvas EX-007 ("IFC Export + Preview") endpoint.
 *
 * Flow:
 *   1. Auth + canary gate + per-user rate-limit.
 *   2. Validate `{ ifcUrl }` body.
 *   3. Ownership pre-check: confirm a `BriefToIfcV3Run` exists for this
 *      ifcUrl under the user — protects against rendering arbitrary URLs.
 *   4. Call the Railway sandbox `POST /api/v3/generator/render-previews`
 *      with `{ ifc_url }` to render top + iso PNGs (matplotlib +
 *      ifcopenshell.geom).
 *   5. Upload both PNGs to R2 with deterministic keys keyed on the
 *      ifcUrl hash so re-runs don't multiply objects.
 *   6. Return `{ topPngUrl, isoPngUrl, runId, meshCount, durationMs }`.
 *
 * The sandbox call is the slow piece (~5-10 s for a typical SOL-booth
 * IFC). `maxDuration = 120` leaves headroom even for the largest IFCs.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { uploadBase64ToR2 } from "@/lib/r2";
import { shouldUseBriefToIfcV3 } from "@/features/brief-to-ifc/v3/canary";

export const maxDuration = 120;

const RATE_LIMIT_PER_HOUR = 20;

const NOT_AVAILABLE_ERROR = {
  title: "Feature not available",
  message: "The v3 AI IFC pipeline is not available for your account.",
  code: "BRIEF_TO_IFC_V3_NOT_AVAILABLE",
} as const;

const NOT_FOUND_ERROR = {
  title: "IFC not found",
  message: "No v3 run found for this IFC URL.",
  code: "BRIEF_TO_IFC_V3_RUN_NOT_FOUND",
} as const;

const SANDBOX_UNCONFIGURED_ERROR = {
  title: "Preview service unavailable",
  message: "IFC preview rendering is offline. Try again in a moment.",
  code: "PREVIEW_SERVICE_UNCONFIGURED",
} as const;

const BODY_SCHEMA = z
  .object({
    ifcUrl: z.string().min(8).max(2000),
  })
  .strict();

interface SandboxRenderResponse {
  ok: boolean;
  top_png_b64?: string;
  iso_png_b64?: string;
  mesh_count?: number;
  duration_ms?: number;
  error?: string;
  error_detail?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  if (!shouldUseBriefToIfcV3(session.user.email ?? null)) {
    return NextResponse.json(formatErrorResponse(NOT_AVAILABLE_ERROR), {
      status: 403,
    });
  }

  const userId = session.user.id;

  const rl = await checkEndpointRateLimit(
    userId,
    "brief-to-ifc-v3-render-previews",
    RATE_LIMIT_PER_HOUR,
    "1 h",
  );
  if (!rl.success) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Too many requests",
        message: "You've requested too many previews in the last hour.",
        code: "RATE_001",
      }),
      { status: 429 },
    );
  }

  let body: z.infer<typeof BODY_SCHEMA>;
  try {
    const json = await req.json();
    const parsed = BODY_SCHEMA.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("ifcUrl")),
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(formatErrorResponse(UserErrors.INVALID_INPUT), {
      status: 400,
    });
  }

  // Ownership check — only render previews for IFCs the user actually
  // produced. The same ifcUrl can be referenced by multiple rows on
  // (rare) re-runs; we just need one match.
  const run = await prisma.briefToIfcV3Run.findFirst({
    where: { ifcUrl: body.ifcUrl, userId },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (!run) {
    return NextResponse.json(formatErrorResponse(NOT_FOUND_ERROR), { status: 404 });
  }

  // Sandbox config check — same pattern as v3 sandbox-client.
  const sandboxUrl = process.env.IFC_SERVICE_URL;
  const sandboxKey = process.env.IFC_SERVICE_API_KEY;
  if (!sandboxUrl) {
    return NextResponse.json(formatErrorResponse(SANDBOX_UNCONFIGURED_ERROR), {
      status: 503,
    });
  }

  // Call the Railway sandbox to render PNGs.
  let sandboxResponse: SandboxRenderResponse;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (sandboxKey) headers["Authorization"] = `Bearer ${sandboxKey}`;
    const res = await fetch(`${sandboxUrl}/api/v3/generator/render-previews`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ifc_url: body.ifcUrl }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        formatErrorResponse({
          title: "Preview render failed",
          message: `Sandbox responded ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`,
          code: "PREVIEW_SANDBOX_ERROR",
        }),
        { status: 502 },
      );
    }
    sandboxResponse = (await res.json()) as SandboxRenderResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      formatErrorResponse({
        title: "Preview render unreachable",
        message: `Could not reach the preview sandbox: ${msg}`,
        code: "PREVIEW_SANDBOX_UNREACHABLE",
      }),
      { status: 503 },
    );
  }

  if (!sandboxResponse.ok || !sandboxResponse.top_png_b64 || !sandboxResponse.iso_png_b64) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Preview render returned no images",
        message: sandboxResponse.error_detail ?? sandboxResponse.error ?? "Unknown render failure",
        code: "PREVIEW_RENDER_EMPTY",
      }),
      { status: 502 },
    );
  }

  // Deterministic R2 keys keyed on a hash of the ifcUrl so repeated
  // requests for the same IFC don't accumulate orphaned objects.
  const hash = createHash("sha1").update(body.ifcUrl).digest("hex").slice(0, 12);
  const topFilename = `previews/v3/${hash}-top.png`;
  const isoFilename = `previews/v3/${hash}-iso.png`;

  const topDataUri = `data:image/png;base64,${sandboxResponse.top_png_b64}`;
  const isoDataUri = `data:image/png;base64,${sandboxResponse.iso_png_b64}`;

  // uploadBase64ToR2 returns the original data URI on R2 failure — a
  // graceful fallback so canvas still renders the image (just as inline
  // base64 instead of a public URL).
  const [topPngUrl, isoPngUrl] = await Promise.all([
    uploadBase64ToR2(topDataUri, topFilename, "image/png"),
    uploadBase64ToR2(isoDataUri, isoFilename, "image/png"),
  ]);

  return NextResponse.json(
    {
      runId: run.id,
      ifcUrl: body.ifcUrl,
      topPngUrl,
      isoPngUrl,
      meshCount: sandboxResponse.mesh_count ?? 0,
      durationMs: sandboxResponse.duration_ms ?? 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
