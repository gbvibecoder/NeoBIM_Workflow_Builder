import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse } from "@/lib/user-errors";
import { logger } from "@/lib/logger";
import {
  acquirePipelineLock,
  buildTransitionPrompt,
  checkCinematicSegmentStatus,
  computeOverallProgress,
  deriveOverallStatus,
  extractLastFrameToR2,
  loadPipelineState,
  persistKlingVideoToR2,
  releasePipelineLock,
  savePipelineState,
  STAGE_COPY,
  STAGE_DURATIONS,
  stitchCinematicSegments,
  submitCinematicSegment,
  type CinematicPipelineState,
} from "@/services/cinematic-pipeline";

/**
 * GET /api/cinematic-status?pipelineId=XXX
 *
 * Polls + advances a cinematic pipeline. This is the heart of the multi-stage
 * pipeline — every call:
 *
 *   1. Loads the pipeline state from Redis.
 *   2. Checks Kling status for any in-flight segments (overview, lifestyle,
 *      transition).
 *   3. If a segment just completed, persists it to R2 so it survives Kling URL
 *      expiry.
 *   4. If overview just completed and transition hasn't started yet, extracts
 *      the last frame and submits the transition Kling task.
 *   5. If all segments are done (success or skipped) and stitch hasn't run,
 *      runs the ffmpeg xfade stitch synchronously and uploads the final MP4.
 *   6. Saves the updated state and returns it to the client.
 *
 * A per-pipeline mutex (Redis SET NX) ensures only one polling caller is
 * advancing the state machine at a time. Concurrent callers are allowed to
 * READ the state but they skip the "advance" step.
 *
 * Rate limit: 60 polls per minute (clients should poll every ~5 seconds).
 *
 * Vercel maxDuration: 300s — long enough to cover stitch + R2 uploads.
 */
export const maxDuration = 300;

interface ClientStageView {
  name: string;
  status: string;
  videoUrl?: string;
  imageUrl?: string;
  error?: string;
  durationSeconds?: number;
}

interface ClientStatusResponse {
  pipelineId: string;
  pipelineStatus: string;
  progress: number;
  currentStage: "overview" | "transition" | "lifestyle" | "stitch" | "complete";
  statusMessage: string;
  stages: {
    overview: ClientStageView;
    transition: ClientStageView;
    lifestyle: ClientStageView;
    stitch: ClientStageView;
  };
  finalVideoUrl?: string;
  durationSeconds?: number;
  pipeline: "cinematic-multi-stage";
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Unauthorized",
        message: "Please sign in.",
        code: "AUTH_001",
      }),
      { status: 401 },
    );
  }

  const rl = await checkEndpointRateLimit(
    session.user.id,
    "cinematic-status",
    60,
    "1 m",
  );
  if (!rl.success) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Polling too fast",
        message: "Slow down. Status polling is limited to 60 requests per minute.",
        code: "RATE_001",
      }),
      { status: 429 },
    );
  }

  const { searchParams } = new URL(req.url);
  const pipelineId = searchParams.get("pipelineId");
  if (!pipelineId) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Missing pipelineId",
        message: "pipelineId query parameter is required.",
        code: "VAL_001",
      }),
      { status: 400 },
    );
  }

  // ── Load state ──
  let state = await loadPipelineState(pipelineId);
  if (!state) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Pipeline not found",
        message:
          "This cinematic pipeline has expired or never existed. Please start a new walkthrough.",
        code: "NODE_001",
      }),
      { status: 404 },
    );
  }
  if (state.userId !== session.user.id) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Forbidden",
        message: "You don't have access to this pipeline.",
        code: "AUTH_001",
      }),
      { status: 403 },
    );
  }

  // ── Try to acquire the mutex; if we don't get it, just return the current
  // state without advancing. The next poll will catch up. ──
  const haveLock = await acquirePipelineLock(pipelineId);
  if (!haveLock) {
    logger.debug(
      `[CINEMATIC][${pipelineId}] Skipping advance (another poller holds the lock)`,
    );
    return NextResponse.json(buildClientResponse(state));
  }

  try {
    state = await advancePipeline(state);
    await savePipelineState(state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[CINEMATIC][${pipelineId}] Advance failed:`, msg);
    // Don't blow up the response — return whatever state we have. The error
    // will surface as a per-stage error on the next call.
  } finally {
    await releasePipelineLock(pipelineId);
  }

  return NextResponse.json(buildClientResponse(state));
}

// ─── State Machine Advancement ───────────────────────────────────────────────
//
// The advance function is idempotent — calling it multiple times in sequence
// is safe and never re-submits a stage that's already been submitted. Order
// of operations:
//
//   1. Poll Kling for any in-flight segment.
//   2. Persist newly-completed segments to R2.
//   3. If overview just finished AND transition hasn't started → extract last
//      frame, submit transition Kling task.
//   4. If all video stages are settled (success/failure/skip) → stitch.

async function advancePipeline(
  state: CinematicPipelineState,
): Promise<CinematicPipelineState> {
  const { pipelineId } = state;

  // ── Step 1: Poll any in-flight Kling task and persist completions ──
  await pollAndPersist(state, "overview");
  await pollAndPersist(state, "lifestyle");
  await pollAndPersist(state, "transition");

  // ── Step 2: Submit the transition stage if overview just completed ──
  // Transition needs the LAST FRAME of the overview video as its source image.
  // We trigger this exactly once: only when overview is complete AND transition
  // is still in the "pending" state.
  if (
    state.stages.overview.status === "complete" &&
    state.stages.overview.persistedUrl &&
    state.stages.transition.status === "pending"
  ) {
    state.stages.transition.status = "preparing";
    state.stages.transition.startedAt = Date.now();
    try {
      logger.info(
        `[CINEMATIC][${pipelineId}] Overview complete — extracting last frame for transition`,
      );
      const lastFrameUrl = await extractLastFrameToR2(
        state.stages.overview.persistedUrl,
        pipelineId,
      );
      state.stages.transition.lastFrameUrl = lastFrameUrl;

      const transitionPrompt = buildTransitionPrompt({
        description: state.inputs.description,
        primaryRoom: state.inputs.primaryRoom,
      });
      const submitResult = await submitCinematicSegment({
        imageUrlOrBase64: lastFrameUrl,
        prompt: transitionPrompt,
        durationSeconds: STAGE_DURATIONS.transition,
        aspectRatio: "16:9",
      });
      state.stages.transition.taskId = submitResult.taskId;
      state.stages.transition.status = "submitted";
      logger.info(
        `[CINEMATIC][${pipelineId}] Transition Kling task submitted: ${submitResult.taskId}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[CINEMATIC][${pipelineId}] Transition prep/submit failed: ${msg}`);
      state.stages.transition.status = "failed";
      state.stages.transition.error = msg;
      state.stages.transition.completedAt = Date.now();
    }
  }

  // If overview failed entirely, transition has no source image. Mark it
  // failed-but-skipped so the stitch stage knows to skip it gracefully.
  if (
    state.stages.overview.status === "failed" &&
    state.stages.transition.status === "pending"
  ) {
    state.stages.transition.status = "failed";
    state.stages.transition.error = "skipped (overview failed)";
    state.stages.transition.completedAt = Date.now();
  }

  // ── Step 3: Stitch when every video stage is settled ──
  const allVideoStagesSettled =
    isSettled(state.stages.overview.status) &&
    isSettled(state.stages.lifestyle.status) &&
    isSettled(state.stages.transition.status);

  if (
    allVideoStagesSettled &&
    state.stages.stitch.status === "pending"
  ) {
    state.stages.stitch.status = "preparing";
    state.stages.stitch.startedAt = Date.now();

    // Build the segment list in narrative order, dropping any failed stages.
    const segments: Array<{
      name: string;
      url: string;
      durationSeconds: number;
    }> = [];
    if (
      state.stages.overview.status === "complete" &&
      state.stages.overview.persistedUrl
    ) {
      segments.push({
        name: "overview",
        url: state.stages.overview.persistedUrl,
        durationSeconds: STAGE_DURATIONS.overview,
      });
    }
    if (
      state.stages.transition.status === "complete" &&
      state.stages.transition.persistedUrl
    ) {
      segments.push({
        name: "transition",
        url: state.stages.transition.persistedUrl,
        durationSeconds: STAGE_DURATIONS.transition,
      });
    }
    if (
      state.stages.lifestyle.status === "complete" &&
      state.stages.lifestyle.persistedUrl
    ) {
      segments.push({
        name: "lifestyle",
        url: state.stages.lifestyle.persistedUrl,
        durationSeconds: STAGE_DURATIONS.lifestyle,
      });
    }

    if (segments.length === 0) {
      // Nothing to stitch — every stage failed. Mark stitch failed; the
      // pipelineStatus will become "failed".
      logger.error(
        `[CINEMATIC][${pipelineId}] All video stages failed — nothing to stitch`,
      );
      state.stages.stitch.status = "failed";
      state.stages.stitch.error = "All video stages failed";
      state.stages.stitch.completedAt = Date.now();
    } else {
      try {
        logger.info(
          `[CINEMATIC][${pipelineId}] Stitching ${segments.length} segment(s): ${segments
            .map((s) => s.name)
            .join("+")}`,
        );
        state.stages.stitch.status = "processing";
        const result = await stitchCinematicSegments({
          segments,
          pipelineId,
        });
        state.stages.stitch.status = "complete";
        state.stages.stitch.finalUrl = result.finalUrl;
        state.stages.stitch.completedAt = Date.now();
        state.finalVideoUrl = result.finalUrl;
        logger.info(
          `[CINEMATIC][${pipelineId}] Stitch complete: ${result.finalUrl} ` +
            `(${result.sizeBytes} bytes, ${result.durationSeconds}s)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[CINEMATIC][${pipelineId}] Stitch failed:`, msg);
        state.stages.stitch.status = "failed";
        state.stages.stitch.error = msg;
        state.stages.stitch.completedAt = Date.now();
        // Partial result — surface the longest available segment as the
        // "final" so the user still gets something playable.
        const longest = segments.sort(
          (a, b) => b.durationSeconds - a.durationSeconds,
        )[0];
        if (longest) {
          state.finalVideoUrl = longest.url;
        }
      }
    }
  }

  // ── Step 4: Update overall pipeline status ──
  state.pipelineStatus = deriveOverallStatus(state);
  return state;
}

function isSettled(s: string): boolean {
  return s === "complete" || s === "failed";
}

/**
 * Poll Kling for a single video stage and update the state in place.
 * Persists the video to R2 if the stage just succeeded.
 */
async function pollAndPersist(
  state: CinematicPipelineState,
  stageName: "overview" | "lifestyle" | "transition",
): Promise<void> {
  const { pipelineId } = state;
  const stage = state.stages[stageName];

  // Only stages that have a Kling task in flight need polling.
  if (
    (stage.status !== "submitted" && stage.status !== "processing") ||
    !stage.taskId
  ) {
    return;
  }

  try {
    const result = await checkCinematicSegmentStatus(stage.taskId);
    if (result.status === "succeed" && result.videoUrl) {
      stage.klingUrl = result.videoUrl;
      stage.status = "processing"; // briefly, while we persist
      try {
        const persistedUrl = await persistKlingVideoToR2({
          klingUrl: result.videoUrl,
          pipelineId,
          stage: stageName,
        });
        stage.persistedUrl = persistedUrl;
        stage.status = "complete";
        stage.completedAt = Date.now();
        logger.info(
          `[CINEMATIC][${pipelineId}] ${stageName} complete → ${persistedUrl}`,
        );
      } catch (persistErr) {
        // R2 persist failed but we have a working Kling URL. Use it; the URL
        // is short-lived but the user can still download/play it now.
        const msg =
          persistErr instanceof Error ? persistErr.message : String(persistErr);
        logger.warn(
          `[CINEMATIC][${pipelineId}] ${stageName} persist failed, using raw Kling URL: ${msg}`,
        );
        stage.persistedUrl = result.videoUrl;
        stage.status = "complete";
        stage.completedAt = Date.now();
      }
    } else if (result.status === "failed") {
      stage.status = "failed";
      stage.error = result.failureMessage ?? "Kling task failed";
      stage.completedAt = Date.now();
      logger.warn(
        `[CINEMATIC][${pipelineId}] ${stageName} failed: ${stage.error}`,
      );
    } else {
      // submitted / processing → bump status from "submitted" to "processing"
      // so the UI shows progress moving.
      if (stage.status === "submitted") {
        stage.status = "processing";
      }
    }
  } catch (err) {
    // Transient — don't mark the stage as failed. Just log and continue;
    // the next poll will retry.
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[CINEMATIC][${pipelineId}] ${stageName} poll error (transient): ${msg}`,
    );
  }
}

// ─── Client Response Shaping ─────────────────────────────────────────────────

function buildClientResponse(state: CinematicPipelineState): ClientStatusResponse {
  const progress = computeOverallProgress(state);
  const currentStage = pickCurrentStage(state);
  const statusMessage = buildStatusMessage(state, currentStage);

  return {
    pipelineId: state.pipelineId,
    pipelineStatus: state.pipelineStatus,
    progress,
    currentStage,
    statusMessage,
    stages: {
      overview: shape(state.stages.overview, "overview"),
      transition: shape(state.stages.transition, "transition"),
      lifestyle: shape(state.stages.lifestyle, "lifestyle"),
      stitch: shape(state.stages.stitch, "stitch"),
    },
    finalVideoUrl: state.finalVideoUrl,
    durationSeconds: state.finalVideoUrl ? 24 : undefined,
    pipeline: "cinematic-multi-stage",
  };
}

function shape(
  s: {
    status: string;
    persistedUrl?: string;
    sourceImageUrl?: string;
    finalUrl?: string;
    lastFrameUrl?: string;
    error?: string;
  },
  name: string,
): ClientStageView {
  return {
    name,
    status: s.status,
    videoUrl:
      "persistedUrl" in s
        ? s.persistedUrl
        : "finalUrl" in s
          ? (s.finalUrl as string | undefined)
          : undefined,
    imageUrl: s.sourceImageUrl ?? s.lastFrameUrl,
    error: s.error,
    durationSeconds:
      name === "overview"
        ? STAGE_DURATIONS.overview
        : name === "transition"
          ? STAGE_DURATIONS.transition
          : name === "lifestyle"
            ? STAGE_DURATIONS.lifestyle
            : undefined,
  };
}

function pickCurrentStage(
  state: CinematicPipelineState,
): "overview" | "transition" | "lifestyle" | "stitch" | "complete" {
  if (state.stages.stitch.status === "complete") return "complete";
  if (
    state.stages.stitch.status === "preparing" ||
    state.stages.stitch.status === "processing"
  ) {
    return "stitch";
  }
  // Whichever video stage is "in flight" — prefer overview > transition > lifestyle.
  if (
    state.stages.overview.status === "submitted" ||
    state.stages.overview.status === "processing"
  ) {
    return "overview";
  }
  if (
    state.stages.transition.status === "submitted" ||
    state.stages.transition.status === "processing" ||
    state.stages.transition.status === "preparing"
  ) {
    return "transition";
  }
  if (
    state.stages.lifestyle.status === "submitted" ||
    state.stages.lifestyle.status === "processing"
  ) {
    return "lifestyle";
  }
  // Nothing in flight — must be at the stitch boundary or finished
  return "stitch";
}

function buildStatusMessage(
  state: CinematicPipelineState,
  current: "overview" | "transition" | "lifestyle" | "stitch" | "complete",
): string {
  if (current === "complete") {
    return "Your cinematic walkthrough is ready!";
  }
  if (current === "stitch") {
    return STAGE_COPY.stitch.en;
  }
  if (current === "transition") {
    return STAGE_COPY.transition.en;
  }
  if (current === "lifestyle") {
    return STAGE_COPY.lifestyle.en;
  }
  // overview
  void state;
  return STAGE_COPY.overview.en;
}
