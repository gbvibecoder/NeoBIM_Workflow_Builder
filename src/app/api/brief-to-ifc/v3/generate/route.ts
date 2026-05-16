/**
 * POST /api/brief-to-ifc/v3/generate
 *
 * Full pipeline — accepts either a free-text `brief` (runs Layer 1 +
 * Layer 2) or a pre-enriched `briefSpec` (runs Layer 2 only). Returns
 * the agent-loop result with IFC URL, cost, latency, and the per-turn
 * ledger.
 *
 * NOTE on streaming: the Phase v3 prompt calls for SSE so the canvas
 * can show tool turns live. v1 ships the non-streaming JSON response —
 * the agent driver supports an `onTurn` callback but the SSE wrapping
 * + Next.js App-Router ReadableStream plumbing is a follow-up. The
 * eval harness uses this non-streaming endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import {
  briefSpecSchema,
  enrichBrief,
  runGenerator,
  shouldUseBriefToIfcV3,
  type BriefSpec,
} from "@/features/brief-to-ifc/v3";

// Long — the agent loop can run up to ~120s of tool calls + Anthropic
// turns. Vercel Fluid Compute is required for this maxDuration.
export const maxDuration = 800;

const RATE_LIMIT_PER_HOUR = 10;

const BODY_SCHEMA = z
  .object({
    brief: z.string().min(40).max(20_000).optional(),
    briefSpec: briefSpecSchema.optional(),
    project_type: z
      .enum(["exhibition_booth", "office", "residential", "retail"])
      .optional(),
    max_turns: z.number().int().min(1).max(25).optional(),
    /** Optional cumulative-cost ceiling. Below 0.10 the agent doesn't
     *  have budget for even one Opus 4.7 turn; above 10.00 we'd rather
     *  the caller use the queued pipeline. Phase v3 completion §D4. */
    cost_cap_usd: z.number().min(0.1).max(10.0).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.brief) || Boolean(v.briefSpec), {
    message: "Either `brief` (free text) or `briefSpec` (pre-enriched) is required.",
  });

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
    userId, "brief-to-ifc-v3-generate", RATE_LIMIT_PER_HOUR, "1 h",
  );
  if (!rl.success) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Too many requests",
        message: "You've generated too many IFCs in the last hour.",
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
        formatErrorResponse({
          title: "Invalid request",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
            .join("; "),
          code: "INVALID_INPUT",
        }),
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(formatErrorResponse(UserErrors.INVALID_INPUT), {
      status: 400,
    });
  }

  // Resolve the BriefSpec — either passed directly or via Layer 1.
  let briefSpec: BriefSpec;
  let enrichmentCostUsd = 0;
  let enrichmentDurationMs = 0;

  if (body.briefSpec) {
    briefSpec = body.briefSpec;
  } else if (body.brief) {
    const enrichment = await enrichBrief({
      brief: body.brief,
      projectType: body.project_type,
    });
    enrichmentCostUsd = enrichment.costUsd;
    enrichmentDurationMs = enrichment.durationMs;
    if (!enrichment.ok || !enrichment.brief) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Brief enrichment failed",
          message: enrichment.error?.message ?? "Unknown error",
          code: enrichment.error?.code ?? "ENRICHMENT_FAILED",
        }),
        { status: 500 },
      );
    }
    briefSpec = enrichment.brief;
  } else {
    // Refine guard above already caught this — defensive only.
    return NextResponse.json(
      formatErrorResponse(UserErrors.INVALID_INPUT),
      { status: 400 },
    );
  }

  const result = await runGenerator({
    brief: briefSpec,
    maxTurns: body.max_turns,
    costCapUsd: body.cost_cap_usd,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ...formatErrorResponse({
          title: "AI IFC generation failed",
          message: result.error?.message ?? "Unknown error",
          code: result.error?.code ?? "GENERATOR_FAILED",
        }),
        generator: {
          ok: false,
          turns: result.turns,
          ledger: result.ledger,
          turnRecords: result.turnRecords.slice(-3),
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ifcUrl: result.ifcUrl,
      entityCount: result.entityCount,
      brief: briefSpec,
      cost: {
        enrichmentUsd: enrichmentCostUsd,
        generatorUsd: result.costUsd,
        totalUsd: enrichmentCostUsd + result.costUsd,
      },
      duration: {
        enrichmentMs: enrichmentDurationMs,
        generatorMs: result.durationMs,
        totalMs: enrichmentDurationMs + result.durationMs,
      },
      turns: result.turns,
      ledger: result.ledger,
      turnRecords: result.turnRecords,
      validation: result.finalValidation,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
