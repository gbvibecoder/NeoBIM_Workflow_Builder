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
// kling-v3-0 / kling-v3-0-omni may be available on newer API versions (Kling 3.0 Omni)
const MODELS = ["kling-v3-0", "kling-v3-0-omni", "kling-v2-6", "kling-v2-1-master", "kling-v2-1", "kling-v1-6"] as const;

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
    // Try parsing JSON body first (Kling returns JSON even on 429)
    let errorMessage = `Kling API HTTP ${res.status}`;
    try {
      const errData = await res.json();
      if (errData?.code === 1102) {
        errorMessage = "Kling account balance is empty — please top up your Kling AI account at klingai.com to generate professional videos";
      } else if (errData?.message) {
        errorMessage = `Kling API error: ${errData.message} (code ${errData.code})`;
      }
    } catch {
      const text = await res.text().catch(() => "Unknown error");
      errorMessage = `Kling API HTTP ${res.status}: ${text.slice(0, 300)}`;
    }
    console.error("[Video] Kling HTTP error", { status: res.status, path, errorMessage });
    throw new VideoServiceError(errorMessage, res.status, res.status >= 500);
  }

  const data = (await res.json()) as KlingTaskResponse;

  if (data.code !== 0) {
    console.error("[Video] Kling API error", { code: data.code, message: data.message, requestId: data.request_id });
    const msg = data.code === 1102
      ? "Kling account balance is empty — please top up your Kling AI account at klingai.com"
      : `Kling API error: ${data.message} (code ${data.code})`;
    throw new VideoServiceError(msg, 400, false);
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

  console.log("========== createTask START ==========");
  console.log("[CREATE] image type:", imageUrl?.startsWith("http") ? "URL" : "base64");
  console.log("[CREATE] image length:", imageUrl?.length);
  console.log("[CREATE] prompt (FULL):", prompt);
  console.log("[CREATE] duration:", duration);
  console.log("[CREATE] mode:", mode);
  console.log("[CREATE] aspectRatio:", aspectRatio);

  for (const modelName of MODELS) {
    try {
      console.log(`[CREATE] Trying model: ${modelName}`);

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
        body.cfg_scale = 0.7;
      }

      console.log("[CREATE] EXACT Kling API request body:", JSON.stringify({
        ...body,
        image: body.image?.length > 100 ? body.image?.slice(0, 50) + "...[truncated, total=" + body.image.length + "]" : body.image,
      }));

      const result = await klingFetch(KLING_IMAGE2VIDEO_PATH, {
        method: "POST",
        body,
      });

      console.log(`[KLING] ✅ Task created with MODEL: ${modelName}, taskId=${result.data.task_id}`);
      console.log("[CREATE] Full API response:", JSON.stringify(result));
      console.log("========== createTask END ==========");
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
  const negativePrompt = "blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure, jittery motion, flickering textures, plastic appearance, fisheye distortion, floating objects, wireframe, cartoon, sketch, low polygon, unrealistic proportions, text overlay, watermark, oversaturated colors, CGI look, video game graphics, toy model, miniature, tilt-shift, abstract, surreal, people walking, cars moving, birds flying, lens flare";

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

// ─── Prompt Builders (PDF / Concept Render → Video) ─────────────────────────

/**
 * Build prompt for Part 1 (5s): Cinematic exterior views of the building.
 * Philosophy: use the text description as source of truth, don't over-describe
 * the building — Kling sees the concept render image. We only tell it HOW
 * the video should look (camera movement, rendering style).
 *
 * Scene timeline:
 *   0s–1s: Front elevation approach
 *   1s–3s: Side elevations — left and right orbit
 *   3s–4s: Back elevation
 *   4s–5s: Top-down aerial view
 */
export function buildExteriorPrompt(buildingDescription: string): string {
  const desc = buildingDescription.slice(0, 800);

  return (
    `Use the provided text description as the only source of truth and generate an accurate BIM-style 3D architectural model following AEC industry standards. ` +
    `Interpret the text to construct the building's layout, structure, rooms, dimensions, materials, and architectural features exactly as described. ` +
    `Do not add elements, rooms, or features not mentioned in the text. ` +
    `The rendered building must visually match the provided concept image. ` +
    `Building description: ${desc.slice(0, 350)}. ` +
    "Cinematic exterior views (5 seconds): " +
    "Camera starts at the front elevation — slow cinematic dolly toward the building entrance, " +
    "showing the complete front façade with accurate proportions. " +
    "Camera smoothly orbits to the side elevations, revealing the building's depth, massing, and façade details. " +
    "Continues to the back elevation showing rear façade and service areas. " +
    "Camera rises on a sweeping crane shot to a dramatic top-down aerial perspective — " +
    "complete roof plan visible with accurate building footprint. " +
    "Physically accurate proportions, realistic materials, global illumination, " +
    "natural lighting with soft shadows, cinematic smooth camera movement, " +
    "high-end real-estate style architectural visualization, " +
    "8K resolution, V-Ray/Corona render quality, no distortion, no artifacts."
  );
}

/**
 * Build prompt for Part 2 (10s): Smooth interior walkthrough showcasing
 * all spaces described in the text, following natural circulation.
 * Same philosophy: trust the input image + text, describe camera movement only.
 *
 * Scene timeline:
 *   0s–2s: Camera enters through main entrance into lobby/foyer
 *   2s–10s: Smooth walkthrough through all described interior spaces
 */
export function buildInteriorPrompt(buildingDescription: string): string {
  const desc = buildingDescription.slice(0, 800);

  return (
    `Smooth interior walkthrough of the building strictly matching the provided text description and concept image. ` +
    `Show only the spaces, rooms, and features mentioned in the text — do not add rooms or areas not described. ` +
    `Building description: ${desc.slice(0, 350)}. ` +
    "Interior walkthrough (10 seconds): " +
    "Camera enters the building through the main entrance. " +
    "Smooth first-person walkthrough following a natural circulation path — " +
    "showcasing all spaces described in the text in the correct layout order. " +
    "Each space is furnished consistently with its described function. " +
    "Camera showcases spatial flow, room proportions, ceiling heights, and connectivity between spaces. " +
    "Natural light streaming through windows, door positions and wall layouts matching the description. " +
    "Physically accurate proportions, realistic materials " +
    "(hardwood floors, stone countertops, painted walls, glass partitions, metal fixtures), " +
    "global illumination, natural lighting blended with warm interior light, " +
    "cinematic smooth camera movement, high-end real-estate style architectural visualization, " +
    "8K resolution, V-Ray/Corona render quality, no distortion, no artifacts."
  );
}

// ─── Floor Plan → Video Prompts ──────────────────────────────────────────────

/**
 * Build prompt for floor plan exterior (5s): Camera orbits the building formed
 * from the 2D floor plan image. We DON'T describe the building — Kling sees
 * the floor plan image and converts it. We only describe HOW the video looks.
 *
 * Scene timeline:
 *   0s–1s: Front elevation — camera approaches the building from the front
 *   1s–2s: Left side — camera orbits to reveal the left elevation
 *   2s–3s: Back elevation — camera continues orbit showing the rear
 *   3s–4s: Right side — camera orbits to the right elevation
 *   4s–5s: Top-down — camera rises to a dramatic aerial roof perspective
 */
export function buildFloorPlanExteriorPrompt(_buildingDescription: string, _roomInfo?: string): string {
  return (
    "Use the provided 2D floor plan as the only source of truth and convert it into an accurate BIM-style 3D architectural model following AEC standards. " +
    "Strictly interpret walls, doors, windows, room layout, scale, and spatial relationships exactly as shown, without inventing or modifying any spaces. " +
    "Generate an ultra-realistic 3D architectural exterior view. " +
    "Show exterior views including front elevation approach and top-down aerial view of the building derived from the floor plan footprint. " +
    "Use cinematic camera movement, realistic materials, global illumination, natural lighting, and architectural visualization quality. " +
    "Ensure the final result is a high-end real estate style 3D render that strictly matches the provided 2D floor plan."
  );
}

/**
 * Build prompt for floor plan interior (10s): Camera enters the building
 * and walks through rooms exactly as laid out in the floor plan.
 * We only describe HOW the video looks — Kling reads the floor plan image.
 *
 * Scene timeline:
 *   0s–2s: Camera enters the building through the main entrance
 *   2s–10s: First-person walkthrough following natural circulation paths,
 *           showcasing every room visible in the floor plan with furniture
 *           consistent with each room type
 */
export function buildFloorPlanInteriorPrompt(_buildingDescription: string, _roomInfo?: string): string {
  return (
    "Use the provided 2D floor plan as the only source of truth and convert it into an accurate BIM-style 3D architectural model following AEC standards. " +
    "Strictly interpret walls, doors, windows, room layout, scale, and spatial relationships exactly as shown, without inventing or modifying any spaces. " +
    "Generate an ultra-realistic 3D architectural interior walkthrough. " +
    "Smooth interior walkthrough covering all spaces shown in the plan, following a natural circulation path. " +
    "Use cinematic camera movement, realistic materials, global illumination, natural lighting, and architectural visualization quality. " +
    "Ensure the final result is a high-end real estate style 3D render that strictly matches the provided 2D floor plan."
  );
}

// ─── Combined Single-Video Prompts (10s, no segments) ────────────────────────

/**
 * Combined walkthrough prompt for concept render input (fallback single 10s video).
 * Exterior views + interior entry in one continuous shot.
 * Same philosophy: trust the input, describe camera movement only.
 */
export function buildCombinedWalkthroughPrompt(buildingDescription: string): string {
  const desc = buildingDescription.slice(0, 800);

  return (
    `Use the provided text description as the only source of truth and generate an accurate BIM-style 3D architectural model. ` +
    `Interpret the text exactly as described, without adding elements not mentioned. ` +
    `Building description: ${desc.slice(0, 400)}. ` +
    "Single continuous camera movement. " +
    "Camera starts with cinematic exterior views — front elevation approach, " +
    "orbiting around the building showing all sides, rising to a top-down aerial view. " +
    "Camera descends and enters the building through the main entrance — " +
    "smooth first-person walkthrough following natural circulation paths, " +
    "showcasing all spaces described in the text. " +
    "Physically accurate proportions, realistic materials, global illumination, " +
    "natural lighting, cinematic smooth camera, high-end real-estate quality, " +
    "8K resolution, V-Ray/Corona render quality, no distortion, no artifacts."
  );
}

/**
 * Combined floor plan prompt for a single 10s video (fallback if dual isn't used).
 * Exterior orbit + interior walkthrough in one continuous shot.
 * Same philosophy: don't describe the building, just describe camera movement.
 */
export function buildFloorPlanCombinedPrompt(_buildingDescription: string, _roomInfo?: string): string {
  // EXACT prompt that produces great results on OpenArt with Kling 3.0.
  // The image itself carries all floor plan information — Kling reads it visually.
  // Do NOT append roomInfo, buildingDescription, or any dynamic data.
  return "Use the provided 2D floor plan as the only source of truth and convert it into an accurate BIM-style 3D architectural model following AEC standards. Strictly interpret walls, doors, windows, room layout, scale, and spatial relationships exactly as shown, without inventing or modifying any spaces. Generate a 15-second ultra-realistic 3D architectural walkthrough video. First 5 seconds: exterior views showing front, sides, back, and a top view of the building derived from the floor plan footprint. Next 10 seconds: smooth interior walkthrough covering all spaces shown in the plan, following a natural circulation path. Use cinematic camera movement, realistic materials, global illumination, natural lighting, and architectural visualization quality. Ensure the final result is a high-end real estate style 3D render that strictly matches the provided 2D floor plan.";
}

/**
 * Build a cinematic AEC walkthrough prompt from the building description.
 * Legacy single-video fallback — kept for backward compatibility.
 */
export function buildArchitecturalVideoPrompt(
  buildingDescription: string
): string {
  const desc = buildingDescription.slice(0, 800);

  return (
    `Use the provided text description as the only source of truth and generate an accurate BIM-style 3D architectural model following AEC industry standards. ` +
    `Interpret the text exactly as described, without adding elements not mentioned. ` +
    `Building description: ${desc.slice(0, 300)}. ` +
    "Create an ultra-realistic 3D architectural walkthrough video. " +
    "Cinematic exterior views including front, sides, back, and top view of the building. " +
    "Then smooth interior walkthrough showcasing all spaces described in the text, " +
    "following a natural circulation path. " +
    "Physically accurate proportions, realistic materials, global illumination, " +
    "natural lighting, cinematic smooth camera movement, " +
    "high-end real-estate style architectural visualization, " +
    "8K resolution, no distortion, no artifacts."
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
        body.cfg_scale = 0.7;
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
 * Submit TWO video generation tasks to Kling API (5s exterior + 10s interior)
 * and return immediately with the task IDs.
 *
 * After both complete, the frontend calls /api/concat-videos to stitch them
 * into a single seamless 15s MP4 with a crossfade transition.
 *
 * When `options.isFloorPlan` is true, uses floor-plan-specific prompts.
 */
export async function submitDualWalkthrough(
  imageUrl: string,
  buildingDescription: string,
  mode: "std" | "pro" = "pro",
  options?: { isFloorPlan?: boolean; roomInfo?: string },
): Promise<SubmittedVideoTasks> {
  console.log("========== submitDualWalkthrough START ==========");
  console.log("[DUAL] imageUrl type:", imageUrl?.startsWith("http") ? "URL" : "base64");
  console.log("[DUAL] imageUrl length:", imageUrl?.length);
  console.log("[DUAL] buildingDescription:", buildingDescription?.slice(0, 200));
  console.log("[DUAL] mode:", mode);
  console.log("[DUAL] isFloorPlan:", options?.isFloorPlan);
  console.log("[DUAL] roomInfo:", options?.roomInfo?.slice(0, 200) || "NONE");

  const negativePrompt = "blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure, jittery motion, flickering textures, plastic appearance, fisheye distortion, floating objects, wireframe, cartoon, sketch, low polygon, unrealistic proportions, text overlay, watermark, oversaturated colors, CGI look, video game graphics, toy model, miniature, tilt-shift, abstract, surreal, people walking, cars moving, birds flying, lens flare";

  const exteriorPrompt = options?.isFloorPlan
    ? buildFloorPlanExteriorPrompt(buildingDescription, options.roomInfo)
    : buildExteriorPrompt(buildingDescription);
  const interiorPrompt = options?.isFloorPlan
    ? buildFloorPlanInteriorPrompt(buildingDescription, options.roomInfo)
    : buildInteriorPrompt(buildingDescription);

  console.log("[DUAL] exteriorPrompt (FULL):", exteriorPrompt);
  console.log("[DUAL] interiorPrompt (FULL):", interiorPrompt);
  console.log("[DUAL] About to submit TWO tasks in parallel...");
  console.log("[DUAL] Exterior: duration=5, Interior: duration=10");

  // Submit both tasks in parallel — don't poll, return task IDs immediately
  const [exteriorResult, interiorResult] = await Promise.all([
    createTask(imageUrl, exteriorPrompt, negativePrompt, "5", "16:9", mode),
    createTask(imageUrl, interiorPrompt, negativePrompt, "10", "16:9", mode),
  ]);

  console.log("[DUAL] Both tasks submitted!");
  console.log("[DUAL] Exterior task ID:", exteriorResult.data.task_id);
  console.log("[DUAL] Interior task ID:", interiorResult.data.task_id);
  console.log("========== submitDualWalkthrough END ==========");

  const result = {
    exteriorTaskId: exteriorResult.data.task_id,
    interiorTaskId: interiorResult.data.task_id,
    buildingDescription,
    submittedAt: Date.now(),
  };

  return result;
}

// ─── Single Video Submission (floor plans) ──────────────────────────────────

export interface SubmittedSingleVideoTask {
  taskId: string;
  submittedAt: number;
}

/**
 * Submit a SINGLE 10s video task to Kling API and return immediately.
 * Used for floor plans where a continuous shot (exterior + interior) is needed
 * to maintain building consistency.
 */
export async function submitSingleWalkthrough(
  imageUrl: string,
  prompt: string,
  mode: "std" | "pro" = "pro",
): Promise<SubmittedSingleVideoTask> {
  const negativePrompt = "blur, distortion, low quality, noise, artifacts, cartoon, sketch, watermark";

  console.log("[GN-009] submitSingleWalkthrough: Submitting SINGLE 10s walkthrough");
  console.log("[GN-009] Image type:", imageUrl?.startsWith("http") ? "URL" : "base64", "length:", imageUrl?.length);
  console.log("[GN-009] Prompt:", prompt);

  const result = await createTask(imageUrl, prompt, negativePrompt, "10", "16:9", mode);

  console.log("[GN-009] Single task submitted! taskId:", result.data.task_id);
  return { taskId: result.data.task_id, submittedAt: Date.now() };
}

/**
 * Check status of a single video task. Non-blocking single check.
 */
export async function checkSingleVideoStatus(taskId: string): Promise<{
  status: "submitted" | "processing" | "succeed" | "failed";
  videoUrl: string | null;
  progress: number;
  isComplete: boolean;
  hasFailed: boolean;
  failureMessage: string | null;
}> {
  const result = await klingFetch(`${KLING_IMAGE2VIDEO_PATH}/${taskId}`, { method: "GET" });

  const taskStatus = result.data.task_status as "submitted" | "processing" | "succeed" | "failed";
  const videoUrl = result.data.task_result?.videos?.[0]?.url ?? null;

  const progress = taskStatus === "succeed" ? 100 : taskStatus === "processing" ? 50 : taskStatus === "submitted" ? 10 : 0;
  const hasFailed = taskStatus === "failed";
  const isComplete = taskStatus === "succeed";

  const failureMessage = hasFailed
    ? (result.data.task_status_msg ?? "Unknown error")
    : null;

  console.log("[Video] Single task status:", { taskId, taskStatus, progress, videoUrl: videoUrl?.slice(0, 80) });

  return { status: taskStatus, videoUrl, progress, isComplete, hasFailed, failureMessage };
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
