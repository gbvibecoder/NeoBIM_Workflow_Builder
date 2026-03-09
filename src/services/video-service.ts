/**
 * Video Walkthrough Service — AI-generated cinematic video from architectural renders.
 * Uses Kling 2.1 via fal.ai to create smooth camera-motion walkthroughs
 * from concept render images.
 *
 * Endpoint: fal-ai/kling-video/v2.1/standard/image-to-video
 */

import { fal } from "@fal-ai/client";
import { generateId } from "@/lib/utils";

// ─── Configuration ──────────────────────────────────────────────────────────

const FAL_ENDPOINT = "fal-ai/kling-video/v2.1/standard/image-to-video";
const COST_5S = 0.28;
const COST_10S = 0.56;
const REQUEST_TIMEOUT_MS = 300_000; // 5 minutes — video generation is slow

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VideoInput {
  /** URL of the source render image */
  imageUrl: string;
  /** Camera motion / scene description prompt */
  prompt: string;
  /** Video duration in seconds */
  duration?: "5" | "10";
  /** Negative prompt to avoid artifacts */
  negativePrompt?: string;
  /** CFG scale (0-1, lower = more creative) */
  cfgScale?: number;
}

export interface VideoResult {
  id: string;
  videoUrl: string;
  durationSeconds: number;
  costUsd: number;
  generationTimeMs: number;
}

// ─── Error Handling ─────────────────────────────────────────────────────────

class VideoServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public retryable: boolean
  ) {
    super(message);
    this.name = "VideoServiceError";
  }
}

function ensureFalKey(): void {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new VideoServiceError(
      "FAL_KEY environment variable is not configured",
      500,
      false
    );
  }
  fal.config({ credentials: key });
}

// ─── Core Function ──────────────────────────────────────────────────────────

/**
 * Generate a cinematic walkthrough video from an architectural render image.
 * Uses Kling 2.1 Standard via fal.ai.
 */
export async function generateWalkthroughVideo(
  input: VideoInput
): Promise<VideoResult> {
  ensureFalKey();

  const {
    imageUrl,
    prompt,
    duration = "5",
    negativePrompt = "blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts",
    cfgScale = 0.5,
  } = input;

  const startTime = Date.now();
  const requestId = generateId();

  console.log("[Video] Starting walkthrough generation", {
    requestId,
    imageUrl: imageUrl.slice(0, 80),
    duration: `${duration}s`,
    prompt: prompt.slice(0, 100),
  });

  try {
    const result = await fal.subscribe(FAL_ENDPOINT, {
      input: {
        prompt,
        image_url: imageUrl,
        duration,
        negative_prompt: negativePrompt,
        cfg_scale: cfgScale,
      },
      pollInterval: 3000,
      timeout: REQUEST_TIMEOUT_MS,
    });

    const data = result.data as { video?: { url?: string } };
    const videoUrl = data?.video?.url;

    if (!videoUrl) {
      throw new VideoServiceError(
        "Video generation completed but no video URL returned",
        500,
        false
      );
    }

    const durationSeconds = parseInt(duration, 10);
    const costUsd = durationSeconds <= 5 ? COST_5S : COST_10S;
    const generationTimeMs = Date.now() - startTime;

    console.log("[Video] Walkthrough generated", {
      requestId,
      videoUrl: videoUrl.slice(0, 80),
      durationSeconds,
      costUsd,
      generationTimeMs,
    });

    return {
      id: requestId,
      videoUrl,
      durationSeconds,
      costUsd,
      generationTimeMs,
    };
  } catch (error: unknown) {
    const err = error as Record<string, unknown> | null;
    const status = typeof err?.status === "number" ? err.status : 500;
    const message =
      typeof err?.message === "string"
        ? err.message
        : "Video generation failed";

    console.error("[Video] Generation failed", { requestId, error: message });

    // Re-throw if already our error type
    if (error instanceof VideoServiceError) throw error;

    throw new VideoServiceError(message, status, status >= 500);
  }
}

/**
 * Build an optimized camera motion prompt for architectural walkthroughs.
 * Generates cinematic instructions based on the building description.
 */
export function buildArchitecturalVideoPrompt(
  buildingDescription: string
): string {
  // Extract key visual cues from the description
  const lower = buildingDescription.toLowerCase();
  const isHighrise = /(\d{2,})\s*(?:stor|floor)/i.test(lower) || lower.includes("tower") || lower.includes("skyscraper");
  const hasCourtyard = lower.includes("courtyard") || lower.includes("atrium");
  const isResidential = lower.includes("villa") || lower.includes("house") || lower.includes("residential");

  let cameraMotion: string;

  if (isHighrise) {
    cameraMotion = "Smooth upward crane shot starting from ground level, slowly revealing the full height of the building. Camera gently orbits 45 degrees around the facade showing the tower's full form against the sky.";
  } else if (hasCourtyard) {
    cameraMotion = "Slow dolly forward through the main entrance into the courtyard space. Camera gently pans to reveal the surrounding architecture and sky above.";
  } else if (isResidential) {
    cameraMotion = "Gentle orbit around the building exterior starting from the front facade. Camera slowly rises to show the roof and garden landscape.";
  } else {
    cameraMotion = "Cinematic slow orbit around the building exterior. Camera starts at eye level, gently rises while rotating to reveal all facades and the surrounding context.";
  }

  return `${cameraMotion} Golden hour lighting, photorealistic architectural visualization, smooth steady camera movement, professional cinematography, high detail materials and textures visible.`;
}
