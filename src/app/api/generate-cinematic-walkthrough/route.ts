import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit, isAdminUser } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { formatErrorResponse } from "@/lib/user-errors";
import { logger } from "@/lib/logger";
import { generateId } from "@/lib/utils";
import { uploadToR2, isR2Configured } from "@/lib/r2";
import {
  buildOverviewPrompt,
  buildLifestylePrompt,
  generateLifestyleImage,
  submitCinematicSegment,
  savePipelineState,
  STAGE_DURATIONS,
  type CinematicPipelineState,
} from "@/features/3d-render/services/cinematic-pipeline";

/**
 * POST /api/generate-cinematic-walkthrough
 *
 * Orchestrates the multi-stage cinematic walkthrough pipeline. This is the
 * EXPENSIVE entry point — it runs the synchronous "prep" work (eye-level
 * lifestyle render via GPT-Image-1, parallel Kling task submission, R2 image
 * persist) and then returns a `pipelineId` that the client polls via
 * /api/cinematic-status.
 *
 * The synchronous work takes ~30-90 seconds depending on GPT-Image-1 latency,
 * which is why this route's maxDuration is set to 300 (5 minutes — the
 * Vercel Pro plan's hard ceiling on Functions). After this returns, every
 * remaining bit of work happens inside the polling endpoint.
 *
 * Body:
 *   {
 *     sourceImage: string,    // photoreal top-down 3D render (data URL OR R2 URL)
 *     floorPlanImage: string, // original 2D floor plan (data URL OR R2 URL)
 *     description: string,    // GPT-4o full floor plan analysis
 *     rooms: string[],        // ["Living Room", "Kitchen", ...]
 *     buildingType?: string,  // optional, default "modern apartment"
 *     primaryRoom?: string    // optional, default "Living Room"
 *   }
 *
 * Returns:
 *   {
 *     pipelineId: string,
 *     status: "processing",
 *     stages: { overview: {...}, lifestyle: {...}, transition: {pending}, stitch: {pending} },
 *     pipeline: "cinematic-multi-stage"
 *   }
 *
 * Rate limit: 1 cinematic walkthrough per HOUR per user. Each one costs
 * ~$2.54 in Kling + GPT-Image-1 credits, so this is intentionally tight.
 */
export const maxDuration = 300;

/** Record standalone tool use as an Execution for dashboard + admin visibility. */
async function recordToolExecution(userId: string, toolName: string) {
  try {
    let wf = await prisma.workflow.findFirst({
      where: { ownerId: userId, name: "__standalone_tools__", deletedAt: null },
      select: { id: true },
    });
    if (!wf) {
      const legacy = await prisma.workflow.findFirst({
        where: { ownerId: userId, name: "__standalone_tools__" },
        select: { id: true },
      });
      if (legacy) {
        wf = await prisma.workflow.update({
          where: { id: legacy.id },
          data: { deletedAt: null },
          select: { id: true },
        });
      } else {
        wf = await prisma.workflow.create({
          data: { ownerId: userId, name: "__standalone_tools__", description: "Auto-created for standalone tool usage tracking" },
          select: { id: true },
        });
      }
    }
    await prisma.execution.create({
      data: { workflowId: wf.id, userId, status: "SUCCESS", startedAt: new Date(), completedAt: new Date(), tileResults: [], metadata: { tool: toolName } },
    });
    console.log(`[recordToolExecution] Recorded ${toolName} for user ${userId}`);
  } catch (err) {
    console.error("[recordToolExecution] Failed:", err);
  }
}

export async function POST(req: NextRequest) {
  // ── Auth ──
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Unauthorized",
        message: "Please sign in to generate a cinematic walkthrough.",
        code: "AUTH_001",
      }),
      { status: 401 },
    );
  }

  // ── Rate limit: 5 cinematics per hour, with admin + dev bypasses ──
  // Each cinematic costs ~$2.54 (Kling pro 25s + GPT-Image-1) and takes
  // ~10min wall time, so we keep this tight in production. 5/h gives the
  // user breathing room for retries when one stage fails (e.g. Kling 1303
  // parallel-task limit, or a transient OpenAI error) without burning the
  // entire hour-long slot on a single failed attempt.
  //
  // Bypasses (mirroring the pattern used by checkRateLimit / isAdminUser):
  //   • Admin emails (ADMIN_EMAILS env var) — bypassed entirely so the
  //     team can demo and debug without hitting limits.
  //   • Development mode — bypassed entirely so local testing isn't
  //     blocked when iterating on the pipeline.
  const userRole = ((session.user as { role?: string }).role) || "FREE";
  const isAdmin = isAdminUser(session.user.email ?? undefined) || userRole === "PLATFORM_ADMIN" || userRole === "TEAM_ADMIN";
  const isDev = process.env.NODE_ENV !== "production";

  // ── Plan gate: FREE and MINI users can't generate cinematic walkthroughs ──
  // (videoPerMonth: 0 for FREE and MINI in stripe.ts)
  if (!isAdmin && !isDev && (userRole === "FREE" || userRole === "MINI")) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Upgrade required",
        message: "Cinematic video walkthroughs are available on Starter and above. Upgrade to unlock cinematic building tours!",
        code: "PLAN_001",
        action: "View Plans",
        actionUrl: "/dashboard/billing",
      }),
      { status: 403 },
    );
  }

  if (!isAdmin && !isDev) {
    const rl = await checkEndpointRateLimit(
      session.user.id,
      "generate-cinematic-walkthrough",
      5,
      "1 h",
    );
    if (!rl.success) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Cinematic walkthrough limit reached",
          message:
            "You can create up to 5 cinematic walkthroughs per hour. The standard 3D Video Walkthrough is still available with no extra wait.",
          code: "RATE_001",
        }),
        { status: 429 },
      );
    }
  }

  // ── Parse + validate body ──
  let body: {
    sourceImage?: unknown;
    floorPlanImage?: unknown;
    description?: unknown;
    rooms?: unknown;
    buildingType?: unknown;
    primaryRoom?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      formatErrorResponse({
        title: "Invalid request",
        message: "Request body must be valid JSON.",
        code: "VAL_001",
      }),
      { status: 400 },
    );
  }

  const sourceImageRaw =
    typeof body.sourceImage === "string" ? body.sourceImage : "";
  const floorPlanRaw =
    typeof body.floorPlanImage === "string" ? body.floorPlanImage : "";
  const description = (
    typeof body.description === "string" ? body.description : ""
  ).slice(0, 4000);
  const buildingType =
    typeof body.buildingType === "string" ? body.buildingType : "modern apartment";
  const primaryRoom =
    typeof body.primaryRoom === "string" && body.primaryRoom.trim()
      ? body.primaryRoom.trim()
      : "Living Room";
  const rooms = Array.isArray(body.rooms)
    ? (body.rooms.filter((r): r is string => typeof r === "string").slice(0, 20) as string[])
    : [];

  if (!sourceImageRaw) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Missing source image",
        message:
          "The cinematic pipeline needs a photorealistic top-down render. Please render the floor plan first.",
        code: "VAL_001",
      }),
      { status: 400 },
    );
  }
  if (!floorPlanRaw) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Missing floor plan",
        message:
          "The cinematic pipeline needs the original floor plan as a reference for the eye-level interior render.",
        code: "VAL_001",
      }),
      { status: 400 },
    );
  }

  // ── Required infrastructure checks ──
  // Kling keys are mandatory — we don't fall back to Three.js for the
  // cinematic pipeline. Users who don't have Kling configured should keep
  // using the legacy "Generate 3D Video Walkthrough" button which DOES fall
  // back to a client-side Three.js renderer.
  const hasKlingKeys = !!(
    process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY
  );
  if (!hasKlingKeys) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Cinematic pipeline not configured",
        message:
          "The cinematic walkthrough requires Kling AI keys. The standard 3D Video Walkthrough still works with the local Three.js fallback.",
        code: "OPENAI_001",
      }),
      { status: 503 },
    );
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json(
      formatErrorResponse({
        title: "OpenAI not configured",
        message:
          "OPENAI_API_KEY is required for the eye-level lifestyle render that drives Stage 3.",
        code: "OPENAI_001",
      }),
      { status: 503 },
    );
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Storage not configured",
        message:
          "R2 storage is required for the cinematic pipeline (it stores intermediate frames and the final video). Configure R2 and try again.",
        code: "NET_001",
      }),
      { status: 503 },
    );
  }

  // ── Persist the source image to R2 if it isn't already a URL ──
  // Kling needs either a public URL or raw base64. R2 URLs are simpler to
  // pass around (and shorter in our state object).
  let sourceImageUrl = sourceImageRaw;
  if (!sourceImageUrl.startsWith("http://") && !sourceImageUrl.startsWith("https://")) {
    try {
      let b64 = sourceImageUrl;
      let mimeType = "image/png";
      if (sourceImageUrl.startsWith("data:")) {
        const commaIdx = sourceImageUrl.indexOf(",");
        const meta = sourceImageUrl.slice(0, commaIdx);
        b64 = sourceImageUrl.slice(commaIdx + 1);
        const m = /^data:([^;]+)/.exec(meta);
        if (m) mimeType = m[1];
      }
      const buf = Buffer.from(b64, "base64");
      const ext = mimeType.includes("png") ? "png" : "jpg";
      const upload = await uploadToR2(
        buf,
        `cinematic-source-${generateId()}.${ext}`,
        mimeType,
      );
      if (!upload.success) {
        throw new Error(upload.error);
      }
      sourceImageUrl = upload.url;
      logger.info(`[CINEMATIC] Source image uploaded to R2: ${sourceImageUrl}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.error("[CINEMATIC] Failed to upload source image:", msg);
      return NextResponse.json(
        formatErrorResponse({
          title: "Could not save source image",
          message: msg,
          code: "NET_001",
        }),
        { status: 500 },
      );
    }
  }

  const pipelineId = generateId();
  logger.info(
    `[CINEMATIC][${pipelineId}] START — user=${session.user.id} primaryRoom=${primaryRoom} rooms=${rooms.length}`,
  );

  // ── STAGE 3 PREP: Generate the eye-level lifestyle image ──
  // This is the most expensive synchronous step (~30-90s). We do it BEFORE
  // submitting any Kling tasks so that if it fails we haven't yet spent any
  // Kling credits. If it fails we still continue with overview-only.
  let lifestyleImageUrl: string | undefined;
  let lifestyleImageBase64: string | undefined;
  let lifestylePrepError: string | undefined;
  try {
    const lifeStart = Date.now();
    const result = await generateLifestyleImage({
      floorPlanRef: floorPlanRaw,
      description,
      primaryRoom,
      apiKey: openaiKey,
    });
    lifestyleImageUrl = result.url;
    lifestyleImageBase64 = result.base64;
    logger.info(
      `[CINEMATIC][${pipelineId}] Lifestyle image ready in ${Date.now() - lifeStart}ms`,
    );
  } catch (err) {
    lifestylePrepError = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[CINEMATIC][${pipelineId}] Lifestyle image generation failed: ${lifestylePrepError}`,
    );
    // We continue — the overview stage can still produce a useful video.
  }

  // ── Submit the Kling tasks in parallel ──
  // overview always runs.
  // lifestyle only runs if its source image was generated successfully.
  const overviewPrompt = buildOverviewPrompt({
    description,
    rooms,
    primaryRoom,
  });
  const lifestylePrompt = buildLifestylePrompt({
    description,
    primaryRoom,
  });

  type Settled = { ok: true; taskId: string } | { ok: false; error: string };

  const overviewSubmit: Promise<Settled> = submitCinematicSegment({
    imageUrlOrBase64: sourceImageUrl,
    prompt: overviewPrompt,
    durationSeconds: STAGE_DURATIONS.overview,
    aspectRatio: "16:9",
  })
    .then((r) => ({ ok: true as const, taskId: r.taskId }))
    .catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));

  // For lifestyle, prefer the R2 URL but fall back to base64 if R2 was
  // somehow not available for the lifestyle image upload.
  const lifestyleKlingImage = lifestyleImageUrl?.startsWith("http")
    ? lifestyleImageUrl
    : lifestyleImageBase64;

  const lifestyleSubmit: Promise<Settled> = lifestyleKlingImage
    ? submitCinematicSegment({
        imageUrlOrBase64: lifestyleKlingImage,
        prompt: lifestylePrompt,
        durationSeconds: STAGE_DURATIONS.lifestyle,
        aspectRatio: "16:9",
      })
        .then((r) => ({ ok: true as const, taskId: r.taskId }))
        .catch((err) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        }))
    : Promise.resolve<Settled>({
        ok: false,
        error: lifestylePrepError ?? "lifestyle image not available",
      });

  const [overviewResult, lifestyleResult] = await Promise.all([
    overviewSubmit,
    lifestyleSubmit,
  ]);

  if (!overviewResult.ok && !lifestyleResult.ok) {
    // Catastrophic failure — both Kling submissions failed. Don't even bother
    // creating a pipeline state, return an error.
    logger.error(
      `[CINEMATIC][${pipelineId}] Catastrophic failure: overview=${overviewResult.error} lifestyle=${lifestyleResult.error}`,
    );
    return NextResponse.json(
      formatErrorResponse({
        title: "Cinematic walkthrough failed to start",
        message: `Overview: ${overviewResult.error}. Lifestyle: ${lifestyleResult.error}`,
        code: "OPENAI_001",
      }),
      { status: 502 },
    );
  }

  // ── Build initial pipeline state ──
  const now = Date.now();
  const state: CinematicPipelineState = {
    pipelineId,
    userId: session.user.id,
    createdAt: now,
    pipelineStatus: "processing",
    inputs: {
      sourceImageUrl,
      // We DON'T store the full floor plan in Redis — it might be a giant
      // base64 string. The polling endpoint doesn't need it; the lifestyle
      // image was already generated.
      floorPlanRef: floorPlanRaw.startsWith("http") ? floorPlanRaw : "",
      description,
      rooms,
      buildingType,
      primaryRoom,
    },
    stages: {
      overview: overviewResult.ok
        ? {
            status: "submitted",
            taskId: overviewResult.taskId,
            startedAt: now,
          }
        : {
            status: "failed",
            error: overviewResult.error,
            completedAt: now,
          },
      transition: {
        status: "pending",
      },
      lifestyle: lifestyleResult.ok
        ? {
            status: "submitted",
            taskId: lifestyleResult.taskId,
            sourceImageUrl: lifestyleImageUrl,
            startedAt: now,
          }
        : {
            status: "failed",
            error: lifestyleResult.error,
            sourceImageUrl: lifestyleImageUrl,
            completedAt: now,
          },
      stitch: {
        status: "pending",
      },
    },
  };

  await savePipelineState(state);

  logger.info(
    `[CINEMATIC][${pipelineId}] State saved. overview=${state.stages.overview.status} lifestyle=${state.stages.lifestyle.status}`,
  );

  await recordToolExecution(session.user.id, "cinematic-walkthrough");
  return NextResponse.json({
    pipelineId,
    status: "processing",
    pipeline: "cinematic-multi-stage",
    stages: state.stages,
    inputs: {
      primaryRoom: state.inputs.primaryRoom,
      rooms: state.inputs.rooms,
      buildingType: state.inputs.buildingType,
    },
    estimatedDurationSeconds: 24,
  });
}
