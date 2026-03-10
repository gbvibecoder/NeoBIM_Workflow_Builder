/**
 * Video Walkthrough Service — Cinematic architectural video from renders.
 * Uses Kling Official API (api.klingai.com) with JWT authentication.
 *
 * Official API reference (from Kling API docs):
 *   POST /v1/videos/image2video — create task
 *   GET  /v1/videos/image2video/{task_id} — poll status
 *
 * Supported model_name: kling-v1-6, kling-v2-1, kling-v2-1-master, kling-v2-6
 * Supported duration: "5" or "10"
 * Supported mode: "std" (720p) or "pro" (1080p)
 * cfg_scale: 0-1 (only on v1.x models)
 *
 * Strategy: Generate TWO 10s videos (exterior + interior) for 20s total,
 * or a single 10s cinematic walkthrough for speed.
 */

import { generateId } from "@/lib/utils";

// ─── Configuration ──────────────────────────────────────────────────────────

const KLING_BASE_URL = "https://api.klingai.com";
const KLING_IMAGE2VIDEO_PATH = "/v1/videos/image2video";
const COST_PER_SECOND = 0.10;
const REQUEST_TIMEOUT_MS = 600_000; // 10 minutes
const POLL_INTERVAL_MS = 8_000;     // 8 seconds between status checks
const JWT_EXPIRY_SECONDS = 1800;

// Model names in priority order — try best first, fall back
const MODELS = ["kling-v2-6", "kling-v2-1-master", "kling-v2-1", "kling-v1-6"] as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VideoInput {
  imageUrl: string;
  prompt: string;
  /** "5" or "10" — only valid values for official Kling API */
  duration?: "5" | "10";
  aspectRatio?: "16:9" | "9:16" | "1:1";
  negativePrompt?: string;
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
    task_status: string;           // "submitted" | "processing" | "succeed" | "failed"
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
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: accessKey,
    exp: now + JWT_EXPIRY_SECONDS,
    nbf: now - 5,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

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

  console.log(`[Video] ${options.method} ${path}`, options.body ? JSON.stringify(options.body).slice(0, 300) : "");

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
    console.error("[Video] Kling HTTP error", { status: res.status, path, body: text.slice(0, 500) });
    throw new VideoServiceError(
      `Kling API HTTP ${res.status}: ${text.slice(0, 300)}`,
      res.status,
      res.status >= 500
    );
  }

  const data = (await res.json()) as KlingTaskResponse;

  if (data.code !== 0) {
    console.error("[Video] Kling API error", { code: data.code, message: data.message, requestId: data.request_id });
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
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    const result = await klingFetch(
      `${KLING_IMAGE2VIDEO_PATH}/${taskId}`,
      { method: "GET" }
    );

    const status = result.data.task_status;
    console.log(`[Video] Poll #${attempt}: status="${status}" taskId=${taskId}`);

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

    // "submitted" or "processing" — keep waiting
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
 * Create a Kling image-to-video task, trying model names in priority order.
 * Returns as soon as one model accepts the task.
 */
async function createTask(
  imageUrl: string,
  prompt: string,
  negativePrompt: string,
  duration: "5" | "10",
  aspectRatio: string,
  mode: string,
): Promise<KlingTaskResponse> {
  const errors: string[] = [];

  for (const modelName of MODELS) {
    try {
      console.log(`[Video] Trying model: ${modelName}, mode: ${mode}, duration: ${duration}s`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = {
        model_name: modelName,
        image: imageUrl,
        prompt: prompt.slice(0, 2500), // API max 2500 chars
        negative_prompt: negativePrompt.slice(0, 2500),
        aspect_ratio: aspectRatio,
        mode,
        duration,
      };

      // cfg_scale only supported on v1.x models
      if (modelName.startsWith("kling-v1")) {
        body.cfg_scale = 0.5;
      }

      const result = await klingFetch(KLING_IMAGE2VIDEO_PATH, {
        method: "POST",
        body,
      });

      console.log(`[Video] Task created with ${modelName}! taskId=${result.data.task_id}`);
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(`${modelName}: ${msg}`);
      console.warn(`[Video] ${modelName} failed: ${msg}`);
    }
  }

  throw new VideoServiceError(
    `All Kling models failed:\n${errors.join("\n")}`,
    500,
    false
  );
}

/**
 * Generate a cinematic walkthrough video using Kling Official API.
 * Creates the task, polls until complete, returns the video URL.
 */
export async function generateWalkthroughVideo(
  input: VideoInput
): Promise<VideoResult> {
  const {
    imageUrl,
    prompt,
    duration = "10",
    aspectRatio = "16:9",
    negativePrompt = "blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure, jittery motion, flickering textures, plastic appearance, fisheye distortion, floating objects",
    mode = "pro",
  } = input;

  const startTime = Date.now();
  const requestId = generateId();

  console.log("[Video] Starting walkthrough generation", {
    requestId,
    imageUrl: imageUrl.slice(0, 80),
    duration: `${duration}s`,
    mode,
    promptLength: prompt.length,
  });

  try {
    // Step 1: Create the task (tries models in priority order)
    const createResult = await createTask(
      imageUrl,
      prompt,
      negativePrompt,
      duration,
      aspectRatio,
      mode,
    );

    const taskId = createResult.data.task_id;

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

    console.log("[Video] Walkthrough complete!", {
      requestId,
      taskId,
      videoUrl: videoUrl.slice(0, 80),
      durationSeconds,
      costUsd,
      generationTimeMs,
    });

    return {
      id: taskId,
      videoUrl,
      fileName: `walkthrough_${requestId}.mp4`,
      fileSize: 0,
      durationSeconds,
      costUsd,
      generationTimeMs,
      shotCount: 1,
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

// ─── Dual Video (15s total: 5s exterior + 10s interior) ─────────────────────

export interface DualVideoResult {
  exteriorVideo: VideoResult;
  interiorVideo: VideoResult;
  totalDurationSeconds: number;
  totalCostUsd: number;
  totalGenerationTimeMs: number;
}

/**
 * Generate 15s architectural walkthrough as TWO parallel videos:
 *   Part 1 (5s): Ultra-realistic 3D model — left, right, top views
 *   Part 2 (10s): Interior walkthrough — lobby, corridors, spaces
 *
 * Both videos are generated in parallel via Promise.all for speed.
 */
export async function generateDualWalkthrough(
  imageUrl: string,
  buildingDescription: string,
  mode: "std" | "pro" = "pro",
): Promise<DualVideoResult> {
  const negativePrompt = "blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure, jittery motion, flickering textures, plastic appearance, fisheye distortion, floating objects";

  const exteriorPrompt = buildExteriorPrompt(buildingDescription);
  const interiorPrompt = buildInteriorPrompt(buildingDescription);

  console.log("[Video] Starting DUAL walkthrough (5s exterior + 10s interior)");

  // Generate both in parallel for speed
  const [exterior, interior] = await Promise.all([
    generateWalkthroughVideo({
      imageUrl,
      prompt: exteriorPrompt,
      duration: "5",
      mode,
      negativePrompt,
    }),
    generateWalkthroughVideo({
      imageUrl,
      prompt: interiorPrompt,
      duration: "10",
      mode,
      negativePrompt,
    }),
  ]);

  console.log("[Video] DUAL walkthrough complete!", {
    exteriorId: exterior.id,
    interiorId: interior.id,
    totalCost: (exterior.costUsd + interior.costUsd).toFixed(2),
    totalTime: exterior.generationTimeMs + interior.generationTimeMs,
  });

  return {
    exteriorVideo: exterior,
    interiorVideo: interior,
    totalDurationSeconds: 15,
    totalCostUsd: exterior.costUsd + interior.costUsd,
    totalGenerationTimeMs: Math.max(exterior.generationTimeMs, interior.generationTimeMs),
  };
}

// ─── Prompt Builders ────────────────────────────────────────────────────────

function detectBuildingType(desc: string) {
  const lower = desc.toLowerCase();
  const isHighrise =
    /(\d{2,})\s*(?:stor|floor)/i.test(lower) ||
    lower.includes("tower") ||
    lower.includes("skyscraper");
  const isResidential =
    lower.includes("villa") ||
    lower.includes("house") ||
    lower.includes("residential");
  const hasGlass =
    lower.includes("glass") ||
    lower.includes("curtain wall") ||
    lower.includes("glazing");
  return { isHighrise, isResidential, hasGlass };
}

/**
 * Build prompt for Part 1 (5s): Fast-paced exterior — all four elevations + top-down aerial.
 */
export function buildExteriorPrompt(buildingDescription: string): string {
  const desc = buildingDescription.slice(0, 600);
  const { isHighrise, hasGlass } = detectBuildingType(desc);

  const materialNote = hasGlass
    ? "Glass curtain wall facades with realistic reflections of sky and surrounding context."
    : "All cladding materials, structural joints, and facade details clearly visible with photorealistic accuracy.";

  if (isHighrise) {
    return (
      `Ultra photorealistic fast-paced 3D AEC model showcase of: ${desc.slice(0, 200)}. ` +
      "FAST dynamic camera orbit: starts from the south elevation showing the full tower facade and structural grid, " +
      "rapidly sweeps to the east side revealing the service core and secondary entrance, " +
      "continues orbiting past the north rear facade showing MEP risers and loading bay, " +
      "swings to the west elevation with balcony details and fire escape routes, " +
      "then dramatically rises to a top-down aerial plan view showing complete roofline, HVAC plant rooms, green roof areas, and full site plan with access roads and landscaping. " +
      `${materialNote} ` +
      "Golden hour lighting with long dramatic shadows, 4K cinematic, perfectly steady smooth camera, " +
      "razor-sharp geometry showing every structural member and facade panel, " +
      "professional AEC visualization, no distortion."
    );
  }

  return (
    `Ultra photorealistic fast-paced 3D AEC model showcase of: ${desc.slice(0, 200)}. ` +
    "FAST dynamic camera orbit: starts from the front facade showing main entrance canopy, structural columns, and ground floor retail frontage, " +
    "rapidly sweeps to the left side showing secondary elevation and service access, " +
    "continues past the rear showing back-of-house areas and parking entry, " +
    "orbits to the right side revealing landscaped setback and emergency exits, " +
    "then rises to dramatic bird's-eye top-down view showing complete roof plan, mechanical penthouses, solar panels, drainage, landscaping, and surrounding streets. " +
    `${materialNote} ` +
    "Golden hour lighting with long shadows, 4K cinematic, perfectly steady smooth camera, " +
    "razor-sharp geometry, professional AEC visualization, no distortion."
  );
}

/**
 * Build prompt for Part 2 (10s): Detailed AEC interior walkthrough — lobby, corridors,
 * structural elements, MEP visible, materials, and spatial flow.
 */
export function buildInteriorPrompt(buildingDescription: string): string {
  const desc = buildingDescription.slice(0, 600);
  const { isHighrise, isResidential } = detectBuildingType(desc);

  if (isHighrise) {
    return (
      `Ultra photorealistic detailed AEC interior walkthrough of: ${desc.slice(0, 200)}. ` +
      "Camera slowly enters through the grand double-height lobby showing the reception desk, exposed concrete columns with steel base plates, polished terrazzo flooring with expansion joints, " +
      "reveals the elevator bank with stainless steel doors and floor indicator panels, " +
      "glides past the fire-rated stairwell enclosure and accessible ramp, " +
      "enters the main corridor showing suspended acoustic ceiling tiles, recessed LED downlights, fire sprinkler heads, and smoke detectors, " +
      "pauses at the exposed structural transfer beam showing reinforcement details, " +
      "enters a typical office floor revealing the open plan workspace with raised access floor, cable trays visible below ceiling, floor-to-ceiling curtain wall mullions, " +
      "continues past the MEP riser cupboard with visible ductwork and cable ladders, " +
      "then slowly approaches the window wall revealing panoramic city views through the high-performance glazing. " +
      "Warm interior lighting blended with abundant natural daylight, real material textures showing concrete formwork marks, brushed steel, timber veneers, " +
      "4K cinematic quality, perfectly steady ultra-smooth camera glide, " +
      "professional AEC interior visualization, no distortion."
    );
  }

  if (isResidential) {
    return (
      `Ultra photorealistic detailed AEC interior walkthrough of: ${desc.slice(0, 200)}. ` +
      "Camera slowly enters through the front door showing the solid timber door frame and electronic lock, " +
      "reveals the entrance hall with coat storage, tiled floor with underfloor heating registers, and ceiling-mounted smoke detector, " +
      "glides into the open-plan living room showing the double-height space, exposed timber ceiling joists, engineered hardwood flooring, " +
      "reveals floor-to-ceiling windows with triple-glazed units and integrated blinds, " +
      "pans across the built-in joinery with concealed ventilation grilles and recessed lighting tracks, " +
      "moves through to the kitchen revealing stone countertops, integrated appliances, splashback tiling, pendant lights over the island, " +
      "passes the dining area with feature pendant and acoustic wall panels, " +
      "then exits through sliding glass doors onto the terrace showing the outdoor living space, drainage channel, timber decking, and planters with the garden beyond. " +
      "Warm interior lighting with soft morning sunlight streaming through windows casting shadows on surfaces, high-end material finishes throughout, " +
      "4K cinematic quality, perfectly steady ultra-smooth camera glide, " +
      "professional AEC interior visualization, no distortion."
    );
  }

  return (
    `Ultra photorealistic detailed AEC interior walkthrough of: ${desc.slice(0, 200)}. ` +
    "Camera slowly enters through the main entrance showing the revolving door mechanism, entrance matwell, and security turnstiles, " +
    "reveals the spacious lobby with high ceilings, exposed structural columns, polished concrete floor, and feature reception desk, " +
    "glides through the reception area showing wayfinding signage, fire extinguisher recesses, and accessible call points, " +
    "enters the main corridor revealing suspended ceiling grid with integrated services — LED panels, sprinkler heads, CCTV domes, and air diffusers, " +
    "passes a glazed meeting room showing acoustic glass partitions and cable management below the raised floor, " +
    "continues past the open office area with workstations, task lighting, and exposed ceiling showing painted ductwork and cable trays, " +
    "pauses at the breakout space showing the kitchenette, acoustic baffles, and living wall planter, " +
    "then slowly approaches the large windows showing the exterior view through high-performance glazing with visible mullion profiles. " +
    "Warm interior lighting blended with natural daylight, real material textures — concrete, timber, steel, and glass, " +
    "4K cinematic quality, perfectly steady ultra-smooth camera glide, " +
    "professional AEC interior visualization, no distortion."
  );
}

/**
 * Build a cinematic AEC walkthrough prompt from the building description.
 * Single-video fallback: fast exterior views → detailed interior walkthrough.
 * Kept under 2500 chars (Kling API limit).
 */
export function buildArchitecturalVideoPrompt(
  buildingDescription: string
): string {
  const desc = buildingDescription.slice(0, 800);
  const lower = desc.toLowerCase();

  const isHighrise =
    /(\d{2,})\s*(?:stor|floor)/i.test(lower) ||
    lower.includes("tower") ||
    lower.includes("skyscraper");
  const isResidential =
    lower.includes("villa") ||
    lower.includes("house") ||
    lower.includes("residential");
  const hasGlass =
    lower.includes("glass") ||
    lower.includes("curtain wall") ||
    lower.includes("glazing");

  const materialNote = hasGlass
    ? "Glass curtain wall facades show realistic reflections of sky and surroundings."
    : "All cladding, structural joints, and facade materials clearly visible with photorealistic detail.";

  let cameraMotion: string;

  if (isHighrise) {
    cameraMotion =
      "Camera starts at street level showing the tower's full front facade, structural grid, and entrance canopy, " +
      "rapidly orbits showing all four elevations, " +
      "rises to an aerial top-down view showing roofline with HVAC plant rooms and green roof, " +
      "then descends and enters through the main lobby for a detailed interior walkthrough " +
      "showing reception desk, exposed columns, elevator banks, corridors with suspended ceilings and sprinklers, " +
      "office floor with raised access flooring, and panoramic views through curtain wall glazing.";
  } else if (isResidential) {
    cameraMotion =
      "Camera starts from the garden showing the full side view and structural facade, " +
      "rapidly orbits to show all elevations, " +
      "rises to a bird's eye top-down view showing roofline and site layout, " +
      "then descends through the front door into a detailed interior walkthrough " +
      "through entrance hall, open-plan living with exposed timber joists, kitchen with stone countertops, " +
      "and out through sliding doors onto the terrace with outdoor living space.";
  } else {
    cameraMotion =
      "Camera starts showing the building's full front facade and main entrance, " +
      "rapidly orbits to reveal all elevations and service areas, " +
      "rises to an aerial top-down view showing the complete site plan, " +
      "then descends and enters through the main entrance for a detailed interior walkthrough " +
      "through the lobby, past structural columns, through corridors with visible MEP services, " +
      "into office spaces and meeting rooms, approaching the windows.";
  }

  return (
    `Ultra photorealistic cinematic AEC architectural walkthrough of: ${desc.slice(0, 250)}. ` +
    `${cameraMotion} ` +
    `${materialNote} ` +
    "Golden hour warm lighting, 4K cinematic quality, perfectly steady smooth camera movement, " +
    "solid precise building geometry showing structural members and real material textures, " +
    "professional AEC visualization quality."
  );
}

/**
 * Build multi-shot camera prompts (kept for backward compatibility).
 * Now returns a single-element array since official Kling API doesn't support multi-shot.
 */
export function buildArchitecturalMultiShot(
  buildingDescription: string
): { prompt: string; duration: number }[] {
  return [{ prompt: buildArchitecturalVideoPrompt(buildingDescription), duration: 10 }];
}

// ─── Text-to-Video (no image required) ──────────────────────────────────────

const KLING_TEXT2VIDEO_PATH = "/v1/videos/text2video";

/**
 * Create a Kling text-to-video task, trying model names in priority order.
 * Used when no upstream render image is available (e.g. PDF → summary → video).
 */
async function createTextToVideoTask(
  prompt: string,
  negativePrompt: string,
  duration: "5" | "10",
  aspectRatio: string,
  mode: string,
): Promise<KlingTaskResponse> {
  const errors: string[] = [];

  for (const modelName of MODELS) {
    try {
      console.log(`[Video] Text2Video trying model: ${modelName}, mode: ${mode}, duration: ${duration}s`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = {
        model_name: modelName,
        prompt: prompt.slice(0, 2500),
        negative_prompt: negativePrompt.slice(0, 2500),
        aspect_ratio: aspectRatio,
        mode,
        duration,
      };

      if (modelName.startsWith("kling-v1")) {
        body.cfg_scale = 0.5;
      }

      const result = await klingFetch(KLING_TEXT2VIDEO_PATH, {
        method: "POST",
        body,
      });

      console.log(`[Video] Text2Video task created with ${modelName}! taskId=${result.data.task_id}`);
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(`${modelName}: ${msg}`);
      console.warn(`[Video] Text2Video ${modelName} failed: ${msg}`);
    }
  }

  throw new VideoServiceError(
    `All Kling text2video models failed:\n${errors.join("\n")}`,
    500,
    false
  );
}

export interface SubmittedTextVideoTasks {
  exteriorTaskId: string;
  interiorTaskId: string;
  buildingDescription: string;
  submittedAt: number;
  pipeline: "text2video";
}

/**
 * Submit dual text-to-video tasks to Kling API (5s exterior + 10s interior).
 * No image required — generates ultra-realistic video directly from text description.
 */
export async function submitDualTextToVideo(
  buildingDescription: string,
  mode: "std" | "pro" = "pro",
): Promise<SubmittedTextVideoTasks> {
  const negativePrompt = "blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure, jittery motion, flickering textures, plastic appearance, fisheye distortion, floating objects";

  const exteriorPrompt = buildExteriorTextPrompt(buildingDescription);
  const interiorPrompt = buildInteriorTextPrompt(buildingDescription);

  console.log("[Video] Submitting DUAL text2video tasks (non-blocking)");
  console.log("[Video] Input description length:", buildingDescription.length, "chars");
  console.log("[Video] Exterior prompt length:", exteriorPrompt.length, "chars");
  console.log("[Video] Exterior prompt (first 500):", exteriorPrompt.slice(0, 500));
  console.log("[Video] Interior prompt length:", interiorPrompt.length, "chars");

  const [exteriorResult, interiorResult] = await Promise.all([
    createTextToVideoTask(exteriorPrompt, negativePrompt, "5", "16:9", mode),
    createTextToVideoTask(interiorPrompt, negativePrompt, "10", "16:9", mode),
  ]);

  const result = {
    exteriorTaskId: exteriorResult.data.task_id,
    interiorTaskId: interiorResult.data.task_id,
    buildingDescription,
    submittedAt: Date.now(),
    pipeline: "text2video" as const,
  };

  console.log("[Video] Text2Video tasks submitted!", {
    exteriorTaskId: result.exteriorTaskId,
    interiorTaskId: result.interiorTaskId,
  });

  return result;
}

/**
 * Check status of dual text-to-video tasks.
 */
export async function checkDualTextVideoStatus(
  exteriorTaskId: string,
  interiorTaskId: string,
): Promise<VideoTaskStatus> {
  const [extResult, intResult] = await Promise.all([
    klingFetch(`${KLING_TEXT2VIDEO_PATH}/${exteriorTaskId}`, { method: "GET" }),
    klingFetch(`${KLING_TEXT2VIDEO_PATH}/${interiorTaskId}`, { method: "GET" }),
  ]);

  const extStatus = extResult.data.task_status as VideoTaskStatus["exteriorStatus"];
  const intStatus = intResult.data.task_status as VideoTaskStatus["interiorStatus"];

  const extUrl = extResult.data.task_result?.videos?.[0]?.url ?? null;
  const intUrl = intResult.data.task_result?.videos?.[0]?.url ?? null;

  const statusToProgress = (s: string) =>
    s === "succeed" ? 100 : s === "processing" ? 50 : s === "submitted" ? 10 : 0;

  const extProgress = statusToProgress(extStatus);
  const intProgress = statusToProgress(intStatus);
  const progress = Math.round(extProgress * 0.33 + intProgress * 0.67);

  const hasFailed = extStatus === "failed" || intStatus === "failed";
  const isComplete = extStatus === "succeed" && intStatus === "succeed";

  let failureMessage: string | null = null;
  if (extStatus === "failed") {
    failureMessage = `Exterior video failed: ${extResult.data.task_status_msg ?? "Unknown error"}`;
  } else if (intStatus === "failed") {
    failureMessage = `Interior video failed: ${intResult.data.task_status_msg ?? "Unknown error"}`;
  }

  console.log("[Video] Text2Video status check:", {
    exterior: extStatus,
    interior: intStatus,
    progress,
    isComplete,
  });

  return {
    exteriorStatus: extStatus,
    interiorStatus: intStatus,
    exteriorVideoUrl: extUrl,
    interiorVideoUrl: intUrl,
    progress,
    isComplete,
    hasFailed,
    failureMessage,
  };
}

// ─── Text-to-Video Prompt Builders ──────────────────────────────────────────
// The PDF summary is the ONLY source of truth. We append a BIM-standard
// instruction to ensure the AI generates the building EXACTLY as described
// in the uploaded PDF — no invented elements.
// Kling API limit: 2500 chars per prompt.

/** Max chars reserved for the PDF summary (leaving room for the ~570 char instruction + suffix) */
const SUMMARY_MAX_CHARS = 1900;

/**
 * The BIM instruction appended to the PDF summary.
 * This tells the AI to treat the summary as the sole source of truth.
 */
const BIM_INSTRUCTION =
  "Use the provided text description as the only source of truth and generate an accurate BIM-style 3D architectural model following AEC industry standards. " +
  "Interpret the text to construct the building's layout, structure, rooms, dimensions, materials, and architectural features exactly as described, without adding elements not mentioned in the text. " +
  "Use physically accurate proportions, realistic materials, global illumination, natural lighting, and cinematic camera movement to produce a high-end real estate style architectural visualization strictly based on the provided text description.";

/**
 * Build exterior prompt for text-to-video (5 seconds).
 * Uses the PDF summary as the ONLY source of truth.
 */
function buildExteriorTextPrompt(buildingDescription: string): string {
  const summary = buildingDescription.slice(0, SUMMARY_MAX_CHARS);

  return (
    `${summary}\n\n` +
    `${BIM_INSTRUCTION}\n\n` +
    "Cinematic exterior views including front, sides, back, and top view of the building."
  ).slice(0, 2500);
}

/**
 * Build interior prompt for text-to-video (10 seconds).
 * Uses the PDF summary as the ONLY source of truth.
 */
function buildInteriorTextPrompt(buildingDescription: string): string {
  const summary = buildingDescription.slice(0, SUMMARY_MAX_CHARS);

  return (
    `${summary}\n\n` +
    `${BIM_INSTRUCTION}\n\n` +
    "Smooth interior walkthrough showcasing all spaces described in the text, following a natural circulation path."
  ).slice(0, 2500);
}

// ─── Non-Blocking Submit + Status Check ──────────────────────────────────────

export interface SubmittedVideoTasks {
  exteriorTaskId: string;
  interiorTaskId: string;
  buildingDescription: string;
  submittedAt: number;
}

/**
 * Submit both video generation tasks to Kling API and return immediately
 * with the task IDs (no polling/waiting).
 */
export async function submitDualWalkthrough(
  imageUrl: string,
  buildingDescription: string,
  mode: "std" | "pro" = "pro",
): Promise<SubmittedVideoTasks> {
  const negativePrompt = "blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure, jittery motion, flickering textures, plastic appearance, fisheye distortion, floating objects";

  const exteriorPrompt = buildExteriorPrompt(buildingDescription);
  const interiorPrompt = buildInteriorPrompt(buildingDescription);

  console.log("[Video] Submitting DUAL walkthrough tasks (non-blocking)");

  // Submit both tasks in parallel — don't poll, return task IDs immediately
  const [exteriorResult, interiorResult] = await Promise.all([
    createTask(imageUrl, exteriorPrompt, negativePrompt, "5", "16:9", mode),
    createTask(imageUrl, interiorPrompt, negativePrompt, "10", "16:9", mode),
  ]);

  const result = {
    exteriorTaskId: exteriorResult.data.task_id,
    interiorTaskId: interiorResult.data.task_id,
    buildingDescription,
    submittedAt: Date.now(),
  };

  console.log("[Video] Tasks submitted!", {
    exteriorTaskId: result.exteriorTaskId,
    interiorTaskId: result.interiorTaskId,
  });

  return result;
}

export interface VideoTaskStatus {
  exteriorStatus: "submitted" | "processing" | "succeed" | "failed";
  interiorStatus: "submitted" | "processing" | "succeed" | "failed";
  exteriorVideoUrl: string | null;
  interiorVideoUrl: string | null;
  progress: number; // 0-100
  isComplete: boolean;
  hasFailed: boolean;
  failureMessage: string | null;
}

/**
 * Check the status of both video tasks. Returns progress percentage
 * and video URLs when available. Non-blocking single check.
 */
export async function checkDualVideoStatus(
  exteriorTaskId: string,
  interiorTaskId: string,
): Promise<VideoTaskStatus> {
  // Check both tasks in parallel
  const [extResult, intResult] = await Promise.all([
    klingFetch(`${KLING_IMAGE2VIDEO_PATH}/${exteriorTaskId}`, { method: "GET" }),
    klingFetch(`${KLING_IMAGE2VIDEO_PATH}/${interiorTaskId}`, { method: "GET" }),
  ]);

  const extStatus = extResult.data.task_status as VideoTaskStatus["exteriorStatus"];
  const intStatus = intResult.data.task_status as VideoTaskStatus["interiorStatus"];

  const extUrl = extResult.data.task_result?.videos?.[0]?.url ?? null;
  const intUrl = intResult.data.task_result?.videos?.[0]?.url ?? null;

  // Calculate progress: exterior = 33% weight (5s), interior = 67% weight (10s)
  const statusToProgress = (s: string) =>
    s === "succeed" ? 100 : s === "processing" ? 50 : s === "submitted" ? 10 : 0;

  const extProgress = statusToProgress(extStatus);
  const intProgress = statusToProgress(intStatus);
  const progress = Math.round(extProgress * 0.33 + intProgress * 0.67);

  const hasFailed = extStatus === "failed" || intStatus === "failed";
  const isComplete = extStatus === "succeed" && intStatus === "succeed";

  let failureMessage: string | null = null;
  if (extStatus === "failed") {
    failureMessage = `Exterior video failed: ${extResult.data.task_status_msg ?? "Unknown error"}`;
  } else if (intStatus === "failed") {
    failureMessage = `Interior video failed: ${intResult.data.task_status_msg ?? "Unknown error"}`;
  }

  console.log("[Video] Status check:", {
    exterior: extStatus,
    interior: intStatus,
    progress,
    isComplete,
  });

  return {
    exteriorStatus: extStatus,
    interiorStatus: intStatus,
    exteriorVideoUrl: extUrl,
    interiorVideoUrl: intUrl,
    progress,
    isComplete,
    hasFailed,
    failureMessage,
  };
}
