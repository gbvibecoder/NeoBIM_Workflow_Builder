/**
 * POST /api/brief-to-ifc/v3/enrich
 *
 * Layer 1 — free-text brief -> strict BriefSpec via Opus 4.7 forced
 * tool_use. Auth + canary gate + rate-limit, then `enrichBrief()`.
 *
 * No streaming — enrichment is one Anthropic call, ~30-60 s total. The
 * client polls or awaits the full response.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import {
  enrichBrief,
  shouldUseBriefToIfcV3,
} from "@/features/brief-to-ifc/v3";

export const maxDuration = 300;

const RATE_LIMIT_PER_HOUR = 20;

const BODY_SCHEMA = z
  .object({
    brief: z.string().min(40).max(20_000),
    project_type: z
      .enum(["exhibition_booth", "office", "residential", "retail"])
      .optional(),
  })
  .strict();

const NOT_AVAILABLE_ERROR = {
  title: "Feature not available",
  message: "The v3 AI IFC pipeline is not available for your account.",
  code: "BRIEF_TO_IFC_V3_NOT_AVAILABLE",
} as const;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(formatErrorResponse(UserErrors.UNAUTHORIZED), {
      status: 401,
    });
  }
  const userId = session.user.id;
  const userEmail = session.user.email ?? null;

  if (!shouldUseBriefToIfcV3(userEmail)) {
    return NextResponse.json(formatErrorResponse(NOT_AVAILABLE_ERROR), {
      status: 403,
    });
  }

  const rl = await checkEndpointRateLimit(
    userId, "brief-to-ifc-v3-enrich", RATE_LIMIT_PER_HOUR, "1 h",
  );
  if (!rl.success) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Too many requests",
        message: "You've enriched too many briefs in the last hour.",
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
        formatErrorResponse(UserErrors.MISSING_REQUIRED_FIELD("brief")),
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(formatErrorResponse(UserErrors.INVALID_INPUT), {
      status: 400,
    });
  }

  const result = await enrichBrief({
    brief: body.brief,
    projectType: body.project_type,
  });

  if (!result.ok) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Brief enrichment failed",
        message: result.error?.message ?? "Unknown error",
        code: result.error?.code ?? "ENRICHMENT_FAILED",
      }),
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      brief: result.brief,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
