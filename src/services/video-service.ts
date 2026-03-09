/**
 * Video Walkthrough Service — Cinematic architectural video from renders.
 * Uses Kling 3.0 Official API (api.klingai.com) with JWT authentication.
 *
 * Endpoint: POST https://api.klingai.com/v1/videos/image2video
 * Auth: JWT token from KLING_ACCESS_KEY + KLING_SECRET_KEY
 * Pricing: ~$0.10/s (1080p, no audio) — ~$1.50 for 15s
 *
 * Multi-shot approach: 3 camera angles in one 15s video
 *   Shot 1 (0-5s):  Exterior approach — slow push toward entrance
 *   Shot 2 (5-10s): Corner orbit — reveal side facade
 *   Shot 3 (10-15s): Aerial pullback — drone rises showing full site
 */

import { generateId } from "@/lib/utils";

// ─── Configuration ──────────────────────────────────────────────────────────

const KLING_BASE_URL = "https://api.klingai.com";
const KLING_IMAGE2VIDEO_PATH = "/v1/videos/image2video";
const KLING_TASK_QUERY_PATH = "/v1/videos/image2video"; // GET with /{task_id}
const COST_PER_SECOND = 0.10; // ~$0.10/s at 1080p, no audio
const REQUEST_TIMEOUT_MS = 600_000; // 10 minutes
const POLL_INTERVAL_MS = 5_000; // 5 seconds between status checks
const JWT_EXPIRY_SECONDS = 1800; // 30 minutes

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VideoInput {
  /** URL of the source render image */
  imageUrl: string;
  /** Single prompt (used if multiShot is false) */
  prompt?: string;
  /** Multi-shot prompts — combined into a single rich prompt */
  multiPrompt?: { prompt: string; duration: string }[];
  /** Video duration in seconds ("5" or "10") */
  duration?: string;
  /** Aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Negative prompt */
  negativePrompt?: string;
  /** Mode: "std" (standard) or "pro" (professional) */
  mode?: "std" | "pro";
}

export interface VideoResult {
  id: string;
  videoUrl: string;
  fileName: string;
  fileSize: number;
  durationSeconds: number;
  costUsd: number;
  generationTimeMs: number;
  shotCount: number;
}

interface KlingTaskResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    task_id: string;
    task_status: string;
    task_status_msg?: string;
    task_result?: {
      videos?: Array<{
        id: string;
        url: string;
        duration: string;
      }>;
    };
  };
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

// ─── JWT Token Generation ───────────────────────────────────────────────────

/**
 * Generate a JWT token for Kling API authentication.
 * Uses HS256 algorithm with AccessKey as issuer and SecretKey for signing.
 */
function generateJwtToken(): string {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new VideoServiceError(
      "KLING_ACCESS_KEY and KLING_SECRET_KEY environment variables are required",
      500,
      false
    );
  }

  const now = Math.floor(Date.now() / 1000);

  // JWT Header
  const header = { alg: "HS256", typ: "JWT" };

  // JWT Payload
  const payload = {
    iss: accessKey,
    exp: now + JWT_EXPIRY_SECONDS,
    nbf: now - 5, // small buffer for clock skew
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Sign with HMAC-SHA256
  const crypto = require("crypto");
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── API Helpers ────────────────────────────────────────────────────────────

async function klingFetch(
  path: string,
  options: { method: string; body?: unknown }
): Promise<KlingTaskResponse> {
  const token = generateJwtToken();
  const url = `${KLING_BASE_URL}${path}`;

  const res = await fetch(url, {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new VideoServiceError(
      `Kling API error ${res.status}: ${text}`,
      res.status,
      res.status >= 500
    );
  }

  const data = (await res.json()) as KlingTaskResponse;

  if (data.code !== 0) {
    throw new VideoServiceError(
      `Kling API error: ${data.message} (code ${data.code})`,
      400,
      false
    );
  }

  return data;
}

/**
 * Poll a Kling task until it completes or fails.
 */
async function pollTask(taskId: string): Promise<KlingTaskResponse> {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await klingFetch(
      `${KLING_TASK_QUERY_PATH}/${taskId}`,
      { method: "GET" }
    );

    const status = result.data.task_status;

    if (status === "succeed") {
      return result;
    }

    if (status === "failed") {
      throw new VideoServiceError(
        `Video generation failed: ${result.data.task_status_msg ?? "Unknown error"}`,
        500,
        true
      );
    }

    // status is "submitted" or "processing" — keep polling
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new VideoServiceError(
    "Video generation timed out after 10 minutes",
    504,
    true
  );
}

// ─── Core Function ──────────────────────────────────────────────────────────

/**
 * Generate a cinematic walkthrough video using Kling 3.0 Official API.
 * Submits an image-to-video task, polls for completion, returns the video URL.
 */
export async function generateWalkthroughVideo(
  input: VideoInput
): Promise<VideoResult> {
  const {
    imageUrl,
    prompt,
    multiPrompt,
    duration = "10",
    aspectRatio = "16:9",
    negativePrompt = "blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure",
    mode = "std",
  } = input;

  const startTime = Date.now();
  const requestId = generateId();
  const isMultiShot = multiPrompt && multiPrompt.length > 0;

  // Combine multi-shot prompts into a single rich prompt for Kling API
  const finalPrompt = isMultiShot
    ? multiPrompt
        .map((shot, i) => `[Shot ${i + 1}] ${shot.prompt}`)
        .join(" Then, ")
    : (prompt ?? "");

  console.log("[Video] Starting Kling 3.0 Official API walkthrough", {
    requestId,
    imageUrl: imageUrl.slice(0, 80),
    duration: `${duration}s`,
    mode,
    shots: isMultiShot ? multiPrompt.length : 1,
  });

  try {
    // Step 1: Create the image-to-video task
    const createResult = await klingFetch(KLING_IMAGE2VIDEO_PATH, {
      method: "POST",
      body: {
        model_name: "kling-v3-image-to-video",
        image: imageUrl,
        prompt: finalPrompt,
        negative_prompt: negativePrompt,
        duration,
        aspect_ratio: aspectRatio,
        mode,
      },
    });

    const taskId = createResult.data.task_id;
    console.log("[Video] Task created", { requestId, taskId });

    // Step 2: Poll until completion
    const completedTask = await pollTask(taskId);

    const videos = completedTask.data.task_result?.videos;
    const videoUrl = videos?.[0]?.url;

    if (!videoUrl) {
      throw new VideoServiceError(
        "Video generation completed but no video URL returned",
        500,
        false
      );
    }

    const durationSeconds = parseInt(duration, 10);
    const costUsd = parseFloat((durationSeconds * COST_PER_SECOND).toFixed(3));
    const generationTimeMs = Date.now() - startTime;

    console.log("[Video] Kling 3.0 walkthrough complete", {
      requestId,
      taskId,
      videoUrl: videoUrl.slice(0, 80),
      durationSeconds,
      costUsd,
      generationTimeMs,
      shots: isMultiShot ? multiPrompt.length : 1,
    });

    return {
      id: taskId,
      videoUrl,
      fileName: `walkthrough_${requestId}.mp4`,
      fileSize: 0, // Kling API doesn't return file size
      durationSeconds,
      costUsd,
      generationTimeMs,
      shotCount: isMultiShot ? multiPrompt.length : 1,
    };
  } catch (error: unknown) {
    const err = error as Record<string, unknown> | null;
    const status = typeof err?.statusCode === "number" ? err.statusCode : 500;
    const message =
      typeof err?.message === "string"
        ? err.message
        : "Video generation failed";

    console.error("[Video] Generation failed", { requestId, error: message });

    if (error instanceof VideoServiceError) throw error;

    throw new VideoServiceError(message, status, status >= 500);
  }
}

/**
 * Build multi-shot camera prompts for architectural walkthroughs.
 * Returns 3 shots (5s each = 15s total) with seamless transitions.
 * Each shot has a distinct camera angle optimized for the building type.
 */
export function buildArchitecturalMultiShot(
  buildingDescription: string
): { prompt: string; duration: string }[] {
  const lower = buildingDescription.toLowerCase();

  const isHighrise =
    /(\d{2,})\s*(?:stor|floor)/i.test(lower) ||
    lower.includes("tower") ||
    lower.includes("skyscraper");
  const hasCourtyard =
    lower.includes("courtyard") || lower.includes("atrium");
  const isResidential =
    lower.includes("villa") ||
    lower.includes("house") ||
    lower.includes("residential");
  const hasGlass =
    lower.includes("glass") ||
    lower.includes("curtain wall") ||
    lower.includes("glazing");

  const materialNote = hasGlass
    ? "Glass facades show realistic reflections of sky and surroundings."
    : "Materials and textures clearly visible with photorealistic detail.";
  const qualitySuffix =
    "Ultra photorealistic architectural visualization, 4K cinematic quality, perfectly steady smooth camera, building structure remains solid and geometrically precise.";

  if (isHighrise) {
    return [
      {
        prompt: `Cinematic approach shot toward the base of the tower at pedestrian eye level. Camera slowly pushes forward showing the main entrance, lobby glazing, and ground-floor retail. Golden hour warm light, long shadows. ${materialNote} ${qualitySuffix}`,
        duration: "5",
      },
      {
        prompt: `Smooth drone ascent along the tower facade, rising steadily past each floor. Camera slightly pulls back while climbing to reveal the building's vertical scale and facade rhythm. Sunlight catches the upper floors. ${materialNote} ${qualitySuffix}`,
        duration: "5",
      },
      {
        prompt: `Dramatic aerial pullback from the tower top. Camera rises above the roofline and slowly orbits to reveal the full building silhouette against the skyline and surrounding city context. Late afternoon golden light. ${qualitySuffix}`,
        duration: "5",
      },
    ];
  }

  if (hasCourtyard) {
    return [
      {
        prompt: `Elegant approach toward the building entrance from the street. Camera at eye level, slowly moving forward to reveal the main facade, entrance canopy, and architectural detailing. Warm golden hour light. ${materialNote} ${qualitySuffix}`,
        duration: "5",
      },
      {
        prompt: `Smooth dolly shot passing through the entrance into the courtyard space. Camera gently tilts upward to reveal the open sky framed by surrounding architecture. Soft diffused daylight, dappled shadows from vegetation. ${qualitySuffix}`,
        duration: "5",
      },
      {
        prompt: `Slow 180-degree pan inside the courtyard revealing all interior facades, landscaping, and water features. Camera gradually rises to show the spatial volume from above. Warm ambient glow. ${qualitySuffix}`,
        duration: "5",
      },
    ];
  }

  if (isResidential) {
    return [
      {
        prompt: `Gentle approach from the front garden toward the residence entrance. Camera at eye level showcasing the main facade, front door, and landscaping. Morning golden hour, warm tones, soft shadows. ${materialNote} ${qualitySuffix}`,
        duration: "5",
      },
      {
        prompt: `Smooth orbit around the side of the house revealing the living spaces, terrace, and outdoor areas. Camera glides at shoulder height showing window details and material textures. Warm morning light. ${qualitySuffix}`,
        duration: "5",
      },
      {
        prompt: `Camera rises gently to aerial view showing the full residence from above — roofline, garden, pool, and surrounding landscape context. Pulls back to reveal the complete property. ${qualitySuffix}`,
        duration: "5",
      },
    ];
  }

  // Default — commercial / mixed-use / generic
  return [
    {
      prompt: `Professional approach shot toward the building main entrance at pedestrian eye level. Camera slowly pushes forward revealing the facade, signage, and ground floor. Golden hour, warm directional sunlight, crisp shadows. ${materialNote} ${qualitySuffix}`,
      duration: "5",
    },
    {
      prompt: `Smooth cinematic orbit around the building corner. Camera arcs from the front facade to the side, revealing the building's full depth and secondary entrance. Materials and architectural details visible. ${qualitySuffix}`,
      duration: "5",
    },
    {
      prompt: `Gradual aerial rise to 30-degree angle showing the complete building, roof, and surrounding site context. Camera slowly orbits while ascending for a dramatic reveal of the full architectural composition. ${qualitySuffix}`,
      duration: "5",
    },
  ];
}

/**
 * Build a single-shot prompt (fallback if multi-shot not needed).
 */
export function buildArchitecturalVideoPrompt(
  buildingDescription: string
): string {
  const shots = buildArchitecturalMultiShot(buildingDescription);
  return shots.map((s) => s.prompt).join(" Then, ");
}
