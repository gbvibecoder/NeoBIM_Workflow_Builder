/**
 * Video Walkthrough Service — Cinematic architectural video from renders.
 * Uses Kling Official API (api.klingai.com) with JWT authentication.
 *
 * Official API reference (from Kling API docs):
 *   POST /v1/videos/omni-video — Kling 3.0 Omni (primary, requires public image URL)
 *   POST /v1/videos/image2video — v2-6 fallback (accepts URL or base64)
 *   POST /v1/videos/text2video — v2-6 (text-only, no image)
 *   GET  /v1/videos/{endpoint}/{task_id} — poll status
 *
 * Model strategy: kling-v3-omni (primary) → kling-v2-6 (fallback).
 * Older models (v2-1-master, v1-6) removed — no silent downgrade.
 * Supported duration: "5" or "10"
 * Supported mode: "std" (720p) or "pro" (1080p)
 *
 * Strategy: Generate TWO videos (5s exterior + 10s interior) for 15s total,
 * or a single 10s cinematic walkthrough for speed.
 */

import { generateId } from "@/lib/utils";
import {
  KLING_BASE_URL,
  KLING_IMAGE2VIDEO_PATH,
  KLING_TEXT2VIDEO_PATH,
  KLING_OMNI_PATH,
  COST_PER_SECOND,
  VideoServiceError,
  extractKlingVideoUrl,
  klingFetch,
  type KlingTaskResponse,
} from "@/features/3d-render/services/kling-client";
import type { BriefExtraction } from "@/features/3d-render/services/brief-extractor";
import {
  formatMaterials,
  formatLighting,
  formatColors,
  formatStyle,
  formatInhabitedDetails,
} from "@/features/3d-render/services/brief-extractor";

// ─── Local (legacy) constants ───────────────────────────────────────────────
// REQUEST_TIMEOUT_MS + POLL_INTERVAL_MS are only consumed by the legacy
// synchronous generateWalkthroughVideo path below — kept for back-compat.
const REQUEST_TIMEOUT_MS = 600_000; // 10 minutes
const POLL_INTERVAL_MS = 8_000;     // 8 seconds between status checks

// Satisfy "used" analysis when the legacy path is tree-shaken.
void KLING_BASE_URL;

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

/**
 * Poll a Kling task until it completes or fails.
 */
async function pollTask(taskId: string): Promise<KlingTaskResponse> {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await klingFetch(
      `${KLING_IMAGE2VIDEO_PATH}/${taskId}`,
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
 * Create a Kling image-to-video task.
 *
 * Model strategy: kling-v3-omni (primary, via Omni endpoint, requires public
 * HTTP URL) → kling-v2-6 (fallback, via image2video endpoint, accepts URL
 * or base64). If both fail, throws — no silent downgrade to older models.
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
  const isHttpUrl = imageUrl.startsWith("http");

  // ── Primary: Kling 3.0 Omni (requires public URL) ──
  if (isHttpUrl) {
    try {
      const result = await createOmniTask(imageUrl, prompt, negativePrompt, duration, aspectRatio, mode);
      console.error("[KLING-MODEL] SUCCESS: kling-v3-omni duration:", duration, "mode:", mode);
      return result;
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(`kling-v3-omni: ${msg}`);
      console.error("[KLING-MODEL] FAILED: kling-v3-omni error:", msg.slice(0, 200));
    }
  } else {
    errors.push("kling-v3-omni: skipped (image is base64, Omni requires public URL)");
  }

  // ── Fallback: kling-v2-6 via image2video (accepts URL and base64) ──
  try {
    const body = {
      model_name: "kling-v2-6" as const,
      image: imageUrl,
      prompt: prompt.slice(0, 2500),
      negative_prompt: negativePrompt.slice(0, 2500),
      aspect_ratio: aspectRatio,
      mode,
      duration,
    };
    const result = await klingFetch(KLING_IMAGE2VIDEO_PATH, {
      method: "POST",
      body,
    });
    console.error("[KLING-MODEL] SUCCESS: kling-v2-6 duration:", duration, "mode:", mode);
    return result;
  } catch (err) {
    const msg = (err as Error).message;
    errors.push(`kling-v2-6: ${msg}`);
    console.error("[KLING-MODEL] FAILED: kling-v2-6 error:", msg.slice(0, 200));
  }

  throw new VideoServiceError(
    `All Kling models failed (kling-v3-omni + kling-v2-6). No silent downgrade to older models.\n${errors.join("\n")}`,
    500,
    false,
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
  const negativePrompt = "zoom in, close-up, tight shot, cropped building, partial view, dolly forward, approach, moving closer, blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure, jittery motion, flickering textures, plastic appearance, fisheye distortion, floating objects, wireframe, cartoon, sketch, low polygon, unrealistic proportions, text overlay, watermark, oversaturated colors, CGI look, video game graphics, toy model, miniature, tilt-shift, abstract, surreal, people walking, cars moving, birds flying, lens flare";

  const exteriorPrompt = buildExteriorPrompt(buildingDescription);
  const interiorPrompt = buildInteriorPrompt(buildingDescription);


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
 * Build prompt for Kling image2video exterior (5s).
 * Kling 3.0 grammar: subject → camera action with metrics → context → style.
 */
export function buildExteriorPrompt(buildingDescription: string, extraction?: BriefExtraction): string {
  const subject = extraction?.exteriorDescription
    ? extraction.exteriorDescription
    : `A ${extraction?.buildingType ?? "contemporary"} building`;
  const footprint = extraction?.footprintHint ? ` ${extraction.footprintHint} footprint.` : "";
  const materials = extraction ? formatMaterials(extraction) : "realistic materials";
  const lighting = extraction ? formatLighting(extraction) : "natural daylight with soft shadows";
  const colors = extraction ? formatColors(extraction) : "";
  const style = extraction ? formatStyle(extraction) : "";

  return (
    `${subject}.${footprint}\n\n` +
    "Camera begins approximately 30 meters from the front facade at street level (1.6m height). " +
    "Tracks forward at a steady walking pace toward the main entrance for 2 seconds. " +
    "Gradually orbits 30 degrees to the right revealing the side elevation, depth, and proportions over the next 2 seconds. " +
    "Settles on a hero composition of the front-corner with parallax on foreground elements in the final second. " +
    "Continuous unbroken motion across 5 seconds.\n\n" +
    `${lighting}. ${materials}.` +
    `${colors ? ` ${colors}` : ""}` +
    `${style ? ` ${style}` : ""}\n\n` +
    "Cinematic 35mm lens, photorealistic architectural photography, accurate proportions. " +
    "No text overlay, no logos, no watermark."
  );
}

/**
 * Build prompt for Kling image2video interior (10s).
 * Kling 3.0 grammar: subject → camera action with metrics → context → style.
 * Multi-room: threshold composition when 2+ rooms in extraction.
 */
export function buildInteriorPrompt(_buildingDescription: string, extraction?: BriefExtraction): string {
  const materials = extraction
    ? formatMaterials(extraction)
    : "materials appropriate to the building type";
  const lighting = extraction
    ? formatLighting(extraction)
    : "natural daylight blended with interior light";
  const colors = extraction ? formatColors(extraction) : "";
  const inhabited = extraction ? formatInhabitedDetails(extraction) : "";

  const rooms = extraction?.roomSequence?.length
    ? [...extraction.roomSequence].sort((a, b) => a.importance - b.importance)
    : [];
  const primary = rooms[0];
  const secondary = rooms[1];
  const primaryName = primary?.roomType ?? extraction?.spaceType ?? "interior space";

  // Multi-room threshold walkthrough
  if (secondary) {
    return (
      `${primaryName} furnished appropriately to its function as a ${primaryName}. ` +
      `Camera at eye-level (1.4m height) starts 5 meters back from the far wall of the ${primaryName}. ` +
      `Tracks forward briskly at 1.5x walking pace through the ${primaryName} for the first 3 seconds, ` +
      "sweeping the camera 20 degrees laterally to maximize visible coverage of the room's layout, furniture, and key features. " +
      `Passes through the doorway into the adjacent ${secondary.roomType} with continuous unbroken motion — ` +
      "no stall, no slow-down at the threshold. " +
      `Inside the ${secondary.roomType}, continues forward and orbits 30 degrees over 5 seconds to reveal ` +
      "as much of the room as possible — walls, ceiling height, furniture, windows, depth. " +
      "Final 2 seconds: settle on a hero composition.\n\n" +
      "Total 10 seconds of brisk, sweeping, dynamic motion. Camera covers maximum visible area of both rooms. " +
      "Prioritize coverage and dynamic movement over slow contemplation.\n\n" +
      `${lighting}. ${materials}.` +
      `${colors ? ` ${colors}` : ""}` +
      `${inhabited ? ` ${inhabited}` : ""}\n\n` +
      "Cinematic 28mm lens, eye-level architectural interior photography, photorealistic, accurate proportions. " +
      "No text overlay, no logos, no watermark."
    );
  }

  // Single-room walkthrough
  return (
    `${primaryName} furnished appropriately. ` +
    "Camera at eye-level (1.4m height) starts 5 meters back from the far wall. " +
    "Tracks forward briskly at 1.5x walking pace into the room for the first 3 seconds, revealing the full room depth. " +
    "Orbits 45 degrees over the next 5 seconds while continuing forward, " +
    "sweeping the camera to reveal as much of the room as possible — walls, ceiling, furniture, windows, corners, depth, and texture detail. " +
    "Final 2 seconds: settle on a hero composition with parallax on furniture.\n\n" +
    "Total 10 seconds of brisk, sweeping, dynamic motion. Camera covers maximum visible area. " +
    "Prioritize coverage and dynamic movement over slow contemplation.\n\n" +
    `${lighting}. ${materials}.` +
    `${colors ? ` ${colors}` : ""}` +
    `${inhabited ? ` ${inhabited}` : ""}\n\n` +
    "Cinematic 28mm lens, eye-level architectural interior photography, photorealistic. " +
    "No text overlay, no logos, no watermark."
  );
}

// ─── Building Photo → Renovation/New-Life Video Prompts ─────────────────────

/**
 * Build prompt for Part 1 (5s): Cinematic exterior of the DALL-E renovated building.
 * The input image is already a polished renovation render from DALL-E 3.
 * Kling just needs to create smooth camera movement around it.
 */
export function buildRenovationExteriorPrompt(buildingDescription: string): string {
  const desc = buildingDescription.slice(0, 400);

  return (
    `Wide-angle cinematic sweep of this beautifully restored building with pristine, flawless walls. ` +
    `Show the ENTIRE building from end to end. NEVER zoom in, NEVER move closer. ` +
    `Building: ${desc.slice(0, 250)}. ` +
    "CAMERA: Smooth LEFT-TO-RIGHT tracking shot that sweeps across the ENTIRE building " +
    "in 10 seconds — starting from the far left edge and ending at the far right edge. " +
    "The camera moves at a steady pace sideways, revealing the COMPLETE building " +
    "from one end to the other. Show every section, every wing, the full facade. " +
    "Wide-angle lens, camera positioned far back to show full height from roofline to ground. " +
    "All wall surfaces are perfectly smooth, freshly painted, no scratches or damage. " +
    "DO NOT zoom in, DO NOT move forward, DO NOT get closer — only lateral horizontal movement. " +
    "Ultra-realistic photography, natural daylight, real street scene."
  );
}

/**
 * Build prompt for Part 2 (10s): Interior walkthrough of the renovated building.
 * Describes a luxury renovated interior since DALL-E rendered the exterior.
 */
export function buildRenovationInteriorPrompt(buildingDescription: string): string {
  const desc = buildingDescription.slice(0, 400);

  return (
    `Cinematic interior walkthrough of a beautifully restored building. ` +
    `The building has been carefully renovated while keeping its original character and proportions. ` +
    `Building: ${desc.slice(0, 250)}. ` +
    "Interior walkthrough (10 seconds): " +
    "Camera enters through the restored main entrance into a bright, clean lobby area " +
    "with well-maintained floors, fresh paint, and good lighting. " +
    "Smooth walkthrough through renovated interior spaces that match the building's style and era: " +
    "large windows letting in natural light, " +
    "clean plastered walls, restored wood or tile flooring, " +
    "well-proportioned rooms with tasteful furnishings appropriate to the building, " +
    "clean modern bathrooms and functional kitchen areas. " +
    "Spaces flow naturally through the building's original corridor and room layout. " +
    "Natural daylight through restored windows blended with warm interior lighting, " +
    "ultra-realistic photography style, smooth cinematic camera, no distortion, no CGI look."
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
 * Combined floor plan prompt for a single 10s video.
 * Exterior orbit + interior walkthrough in one continuous shot.
 *
 * When roomInfo is available, the room types are listed explicitly instead
 * of using hardcoded "sofa in the living room, beds in each bedroom" defaults.
 */
export function buildFloorPlanCombinedPrompt(_buildingDescription: string, roomInfo?: string): string {
  // When roomInfo is present, use it for room-specific furniture instead of
  // hardcoded residential defaults (which break for commercial/institutional).
  const furnitureClause = roomInfo
    ? `furniture appearing appropriate to each room's function (rooms: ${roomInfo.slice(0, 300)})`
    : "furniture appearing in each room appropriate to the room's function";

  return (
    "This 2D architectural floor plan transforms into a photorealistic 3D model. " +
    "The flat lines and walls gradually extrude upward, gaining height, depth, " +
    "and realistic materials matching the building type. " +
    "The camera holds a top-down isometric view as the entire floor plan becomes " +
    `a detailed architectural scale model with ${furnitureClause}. ` +
    "Every wall, door, and room stays exactly where shown in the plan. " +
    "Then the camera briskly descends and pushes into the model at eye level, " +
    "gliding through the interior spaces with intent. " +
    "Ultra-photorealistic, V-Ray quality, natural daylight, " +
    "architectural visualization, 10 seconds."
  );
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

/**
 * Create a Kling text-to-video task using kling-v2-6.
 * Text2video only supports v2 models — Omni (v3) requires image input.
 * No model loop — fails loudly if kling-v2-6 rejects the task.
 */
async function createTextToVideoTask(
  prompt: string,
  negativePrompt: string,
  duration: "5" | "10",
  aspectRatio: string,
  mode: string,
): Promise<KlingTaskResponse> {
  try {
    const body = {
      model_name: "kling-v2-6" as const,
      prompt: prompt.slice(0, 2500),
      negative_prompt: negativePrompt.slice(0, 2500),
      aspect_ratio: aspectRatio,
      mode,
      duration,
    };
    return await klingFetch(KLING_TEXT2VIDEO_PATH, {
      method: "POST",
      body,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[Video] Text2Video kling-v2-6 failed: ${msg}`);
    throw new VideoServiceError(
      `Kling text2video failed (kling-v2-6): ${msg}`,
      500,
      false,
    );
  }
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

  const extUrl = extractKlingVideoUrl(extResult);
  const intUrl = extractKlingVideoUrl(intResult);

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
// Text2video fallback — only reached when concept render failed and no upstream
// image exists. Uses Kling 3.0 grammar: subject → camera → context → style.
// No image anchor, so we describe the building and camera action concretely.

/**
 * Build exterior prompt for text-to-video (5s).
 * Kling 3.0 grammar. No "BIM-style" filler — subject + camera metrics + context.
 */
function buildExteriorTextPrompt(buildingDescription: string): string {
  const summary = buildingDescription.slice(0, 1800);

  return (
    `${summary}\n\n` +
    "Camera begins approximately 30 meters from the front facade at street level (1.6m height). " +
    "Tracks forward at a steady walking pace toward the main entrance for 2 seconds. " +
    "Gradually orbits 30 degrees to the right revealing the side elevation and proportions over the next 2 seconds. " +
    "Settles on a hero composition of the front-corner in the final second. " +
    "Continuous unbroken motion across 5 seconds.\n\n" +
    "Cinematic 35mm lens, photorealistic architectural photography, accurate proportions. " +
    "No text overlay, no logos, no watermark."
  ).slice(0, 2500);
}

/**
 * Build interior prompt for text-to-video (10s).
 * Kling 3.0 grammar. Establishing shot + reveal, no spatial "track through doorway"
 * since text2video has no spatial anchor.
 */
function buildInteriorTextPrompt(buildingDescription: string): string {
  const summary = buildingDescription.slice(0, 1800);

  return (
    `${summary}\n\n` +
    "Establishing shot revealing the primary interior space at eye-level (1.4m height). " +
    "Camera tracks forward briskly at 1.5x walking pace for 3 seconds, revealing the full room depth. " +
    "Orbits 45 degrees over the next 5 seconds while continuing forward, " +
    "sweeping to reveal as much of the space as possible — walls, ceiling, furniture, windows, depth. " +
    "Final 2 seconds: settle on a hero composition.\n\n" +
    "Total 10 seconds of brisk, sweeping, dynamic motion. Camera covers maximum visible area. " +
    "Prioritize coverage and dynamic movement over slow contemplation.\n\n" +
    "Cinematic 28mm lens, eye-level architectural interior photography, photorealistic. " +
    "No text overlay, no logos, no watermark."
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
  options?: {
    isFloorPlan?: boolean;
    roomInfo?: string;
    isRenovation?: boolean;
    /**
     * Phase 3 — separate reference image for the INTERIOR Kling task only.
     * Kling image2video anchors on its input image; passing the exterior
     * image to both tasks produces "exterior with interior-flavored camera
     * motion" for the interior segment. When this field is set (typically
     * a GPT-Image-1-generated eye-level interior render from the handler),
     * the interior Kling task uses it instead of `imageUrl`. Exterior task
     * is unaffected. Falls back to `imageUrl` when undefined.
     */
    interiorImageUrl?: string;
    /** Brief extraction — drives materials/lighting in Kling prompts. */
    extraction?: BriefExtraction;
  },
): Promise<SubmittedVideoTasks> {

  const negativePrompt = "zoom in, close-up, tight shot, cropped building, partial view, dolly forward, approach, moving closer, blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure, jittery motion, flickering textures, plastic appearance, fisheye distortion, floating objects, wireframe, cartoon, sketch, low polygon, unrealistic proportions, text overlay, watermark, oversaturated colors, CGI look, video game graphics, toy model, miniature, tilt-shift, abstract, surreal, people walking, cars moving, birds flying, lens flare";

  // Building photos from IN-008 → renovation prompts (transform old to new)
  // Concept renders from GN-003 → standard prompts (match the render)
  const ext = options?.extraction;
  const exteriorPrompt = options?.isFloorPlan
    ? buildFloorPlanExteriorPrompt(buildingDescription, options.roomInfo)
    : options?.isRenovation
      ? buildRenovationExteriorPrompt(buildingDescription)
      : buildExteriorPrompt(buildingDescription, ext);
  const interiorPrompt = options?.isFloorPlan
    ? buildFloorPlanInteriorPrompt(buildingDescription, options.roomInfo)
    : options?.isRenovation
      ? buildRenovationInteriorPrompt(buildingDescription)
      : buildInteriorPrompt(buildingDescription, ext);

  // Submit both tasks in parallel — don't poll, return task IDs immediately
  // Renovation exterior gets 10s (needs time to pan across full building)
  // Non-renovation keeps 5s exterior + 10s interior
  const exteriorDuration = options?.isRenovation ? "10" : "5";

  // Phase 3 — interior Kling task takes a dedicated interior reference image
  // when the caller provides one (typically a GPT-Image-1 eye-level render),
  // falling back to the shared exterior image when absent (pre-Phase-3 behavior).
  // Without a separate reference, Kling's image2video anchors on the exterior
  // photo and produces exterior-looking content for the interior segment even
  // with a strong interior prompt (documented in Phase 3 diagnostic plan).
  const interiorSourceImage = options?.interiorImageUrl ?? imageUrl;

  const [exteriorResult, interiorResult] = await Promise.all([
    createTask(imageUrl,             exteriorPrompt, negativePrompt, exteriorDuration, "16:9", mode),
    createTask(interiorSourceImage,  interiorPrompt, negativePrompt, "10",             "16:9", mode),
  ]);


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


  const result = await createTask(imageUrl, prompt, negativePrompt, "10", "16:9", mode);

  return { taskId: result.data.task_id, submittedAt: Date.now() };
}

// ─── Kling 3.0 Omni Endpoint ────────────────────────────────────────────────

/** Upload base64 image to imgbb for a short-lived public URL (auto-deletes after 10 min) */
async function uploadToImgbb(base64Image: string): Promise<string> {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) throw new Error("IMGBB_API_KEY not set");

  const formData = new URLSearchParams();
  formData.append("key", apiKey);
  formData.append("image", base64Image);
  formData.append("expiration", "600");

  const res = await fetch("https://api.imgbb.com/1/upload", {
    method: "POST",
    body: formData,
  });

  const data = await res.json();
  if (!data.success) throw new Error(`imgbb upload failed: ${data.error?.message || "unknown"}`);

  return data.data.url;
}

/**
 * Create a task via the Kling 3.0 Omni endpoint (POST /v1/videos/omni-video).
 * Omni requires a public image URL — base64 is uploaded to imgbb first.
 * Response uses the same videos[].url format as image2video.
 */
async function createOmniTask(
  imageUrl: string,
  prompt: string,
  negativePrompt: string,
  duration: string,
  aspectRatio: string,
  mode: string,
): Promise<KlingTaskResponse> {

  // Kling Omni needs a public URL — upload base64 to imgbb
  let finalImageUrl = imageUrl;
  if (!imageUrl.startsWith("http")) {
    finalImageUrl = await uploadToImgbb(imageUrl);
  }

  const body = {
    model_name: "kling-v3-omni",
    prompt: `${prompt.slice(0, 2450)} @image_1`,
    negative_prompt: negativePrompt.slice(0, 2500),
    image_list: [{ image_url: finalImageUrl }],
    aspect_ratio: aspectRatio,
    mode,
    duration,
    callback_url: "",
    external_task_id: "",
  };

  const result = await klingFetch(KLING_OMNI_PATH, { method: "POST", body });

  return result;
}

/**
 * Submit a floor plan video — always uses Kling 3.0 Omni.
 * On localhost, falls back to v2.6 since Kling needs a public image URL.
 */
export async function submitFloorPlanWalkthrough(
  imageUrl: string,
  prompt: string,
  mode: "std" | "pro" = "pro",
): Promise<SubmittedSingleVideoTask & { usedOmni: boolean; durationSeconds: number }> {
  const negativePrompt = "blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure, jittery motion, flickering textures, plastic appearance, fisheye distortion, floating objects, wireframe, cartoon, sketch, watermark";

  // On localhost Kling needs a public image URL — use v2.6 with imgbb
  const authUrl = process.env.NEXTAUTH_URL ?? "";
  const isLocalhost = authUrl.includes("localhost") || authUrl.includes("127.0.0.1");

  if (isLocalhost) {
    // Localhost branch actually uses v2.6 via image2video (Kling Omni can't
    // reach localhost — it needs a public URL). Report `usedOmni: false`
    // honestly so UI labels and metadata reflect reality.
    const result = await createTask(imageUrl, prompt, negativePrompt, "10", "16:9", mode);
    return { taskId: result.data.task_id, submittedAt: Date.now(), usedOmni: false, durationSeconds: 10 };
  }

  // Production: always Kling 3.0 Omni — no fallback
  const result = await createOmniTask(imageUrl, prompt, negativePrompt, "10", "16:9", "std");
  return { taskId: result.data.task_id, submittedAt: Date.now(), usedOmni: true, durationSeconds: 10 };
}

/**
 * Check status of a single video task. Non-blocking single check.
 * When `useOmniPolling` is true, polls via the Omni endpoint path.
 */
export async function checkSingleVideoStatus(taskId: string): Promise<{
  status: "submitted" | "processing" | "succeed" | "failed";
  videoUrl: string | null;
  progress: number;
  isComplete: boolean;
  hasFailed: boolean;
  failureMessage: string | null;
}> {
  // Try Omni endpoint first, fall back to image2video. Response shape varies:
  // image2video/text2video use videos[].url; some Kling 3.0 Omni responses
  // use works[].resource.resource — extractKlingVideoUrl handles both (audit
  // Issue #7 — previously Omni succeeds but videoUrl was null → silent timeout).
  let result: KlingTaskResponse;
  try {
    result = await klingFetch(`${KLING_OMNI_PATH}/${taskId}`, { method: "GET" });
  } catch {
    result = await klingFetch(`${KLING_IMAGE2VIDEO_PATH}/${taskId}`, { method: "GET" });
  }

  const taskStatus = result.data.task_status as "submitted" | "processing" | "succeed" | "failed";
  const videoUrl = extractKlingVideoUrl(result);

  const progress = taskStatus === "succeed" ? 100 : taskStatus === "processing" ? 50 : taskStatus === "submitted" ? 10 : 0;
  const hasFailed = taskStatus === "failed";
  const isComplete = taskStatus === "succeed";

  const failureMessage = hasFailed
    ? (result.data.task_status_msg ?? "Unknown error")
    : null;


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

  const extUrl = extractKlingVideoUrl(extResult);
  const intUrl = extractKlingVideoUrl(intResult);

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
