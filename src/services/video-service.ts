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
 * Build prompt for Part 1 (5s): Ultra-realistic exterior — front elevation approach,
 * cinematic side orbit, and dramatic aerial rise to roof plan.
 *
 * Scene timeline:
 *   0s–2s: Front elevation — camera slowly moves toward main entrance
 *   2s–4s: Side elevation — cinematic orbit revealing building depth
 *   4s–5s: Aerial rise — camera rises to top-down roof plan view
 */
export function buildExteriorPrompt(buildingDescription: string): string {
  const desc = buildingDescription.slice(0, 600);
  const { isHighrise, hasGlass } = detectBuildingType(desc);

  const materialNote = hasGlass
    ? "Glass curtain wall façade with physically accurate reflections of sky and clouds, visible unitized panel joints, structural silicone seals, aluminum mullion profiles, triple-glazed low-e coated units."
    : "Photorealistic material rendering — exposed steel I-beams with visible bolt connections, bush-hammered concrete texture with formwork marks, weathering steel Corten cladding panels, anodized aluminum window frames.";

  if (isHighrise) {
    return (
      `Hyper-realistic cinematic architectural visualization, indistinguishable from real drone footage, of: ${desc.slice(0, 180)}. ` +
      "Shot on RED V-Raptor 8K, anamorphic lens, f/2.8 shallow depth of field. " +
      "Camera starts at street level showing front elevation — slow forward dolly toward grand entrance lobby, " +
      "capturing every surface detail: polished granite paving, stainless steel bollards, recessed ground lighting, mature landscaped trees casting dappled shadows, " +
      "the full tower rising above with perfectly proportioned floor-to-floor heights and visible structural grid. " +
      "Camera smoothly orbits to side elevation with fluid Steadicam movement — " +
      "revealing the building's true depth and massing, curtain wall depth profiles, shadow box spandrel panels, " +
      "protruding balcony slabs with glass balustrades, vertical fin sunshading elements. " +
      "Camera rises on a sweeping crane shot to dramatic aerial view — " +
      "rooftop with HVAC chillers, cooling towers, photovoltaic arrays, green roof planters, helicopter pad markings, mechanical penthouse louvres. " +
      `${materialNote} ` +
      "Golden hour warm sunlight with long dramatic shadows, volumetric atmospheric haze, " +
      "cinematic color grading, photorealistic global illumination, sub-surface scattering on translucent materials, " +
      "8K texture resolution, V-Ray/Corona render quality, ultra detailed, no distortion, no artifacts."
    );
  }

  return (
    `Hyper-realistic cinematic architectural visualization, indistinguishable from real drone footage, of: ${desc.slice(0, 180)}. ` +
    "Shot on RED V-Raptor 8K, anamorphic lens, f/2.8 shallow depth of field. " +
    "Camera starts showing front elevation — slow forward dolly toward main entrance, " +
    "capturing polished stone paving, landscaped forecourt, entrance canopy with steel tension cables, " +
    "ground floor glazed shopfronts, the full building rising with proportioned structural bays. " +
    "Camera smoothly orbits to side elevation with fluid Steadicam movement — " +
    "revealing full building depth, façade material transitions, rain screen cladding panels, " +
    "structural columns visible through glazing, secondary service entrances, loading dock. " +
    "Camera rises on sweeping crane shot to bird's-eye aerial — " +
    "complete roof visible with mechanical penthouses, HVAC plant, solar panels, green roof, drainage outlets, parapet coping stones, surrounding streetscape. " +
    `${materialNote} ` +
    "Golden hour warm sunlight with long dramatic shadows, volumetric atmospheric haze, " +
    "cinematic color grading, photorealistic global illumination, sub-surface scattering on translucent materials, " +
    "8K texture resolution, V-Ray/Corona render quality, ultra detailed, no distortion, no artifacts."
  );
}

/**
 * Build prompt for Part 2 (10s): BIM sectional cutaway revealing structure,
 * then interior walkthrough with detailed BIM elements.
 *
 * Scene timeline:
 *   0s–3s: Roof transitions to BIM sectional cutaway — floors visible layer by layer
 *          showing structural beams, columns, floor slabs, building core, staircases, elevator shafts
 *   3s–10s: Camera moves inside — modern lobby and office floor with interior BIM details:
 *           glass partitions, staircases, elevators, furniture layout, lighting fixtures, finishes
 */
export function buildInteriorPrompt(buildingDescription: string): string {
  const desc = buildingDescription.slice(0, 600);
  const { isHighrise, isResidential } = detectBuildingType(desc);

  if (isHighrise) {
    return (
      `Hyper-realistic cinematic interior architectural visualization, indistinguishable from real footage, of: ${desc.slice(0, 180)}. ` +
      "Shot on ARRI Alexa Mini, wide-angle prime lens, cinematic shallow depth of field. " +
      "Scene opens with dramatic sectional cutaway — building slices open revealing every floor in cross-section, " +
      "steel wide-flange beams with bolted connections, reinforced concrete columns with visible rebar ties, " +
      "post-tensioned floor slabs, concrete building core with elevator shafts and fire stairs, MEP risers with color-coded pipes. " +
      "Camera descends into grand double-height lobby — " +
      "Carrara marble reception desk, board-formed concrete feature walls, polished terrazzo floor with brass inlay strips, " +
      "recessed linear LED cove lighting, floor-to-ceiling frameless glass entrance doors. " +
      "Camera glides through corridor — suspended metal ceiling with integrated linear diffusers, " +
      "recessed LED downlights casting precise beam patterns, chrome sprinkler heads, smoke detectors. " +
      "Enters open-plan office — Herman Miller workstations, acoustic felt ceiling baffles, " +
      "full-height glass partitions with manifestation dots, raised access floor with visible cable management, " +
      "panoramic city views through floor-to-ceiling curtain wall. " +
      "Warm 3200K interior lighting blended with cool 5600K daylight, realistic caustics through glass, volumetric light rays, " +
      "photorealistic material rendering — real wood grain, brushed stainless, honed stone, woven carpet texture, " +
      "V-Ray/Corona render quality, 8K textures, ultra detailed, no distortion, no artifacts."
    );
  }

  if (isResidential) {
    return (
      `Hyper-realistic cinematic interior architectural visualization, indistinguishable from real footage, of: ${desc.slice(0, 180)}. ` +
      "Shot on ARRI Alexa Mini, wide-angle prime lens, cinematic shallow depth of field. " +
      "Scene opens with dramatic sectional cutaway — roof peels away revealing timber rafter structure, " +
      "engineered I-joists, insulated cavity walls, service voids with plumbing and electrical runs. " +
      "Camera enters through solid European oak front door — herringbone tile entrance hall, " +
      "glides into double-height living space with exposed glulam beams, wide-plank engineered oak flooring, " +
      "floor-to-ceiling triple-glazed windows with motorized blinds filtering warm sunlight, " +
      "bespoke built-in joinery in satin lacquer finish. " +
      "Moves through kitchen — book-matched Calacatta marble island, integrated Gaggenau appliances, " +
      "hand-made ceramic splashback tiles, brushed brass pendant fixtures. " +
      "Through full-height sliding glass doors onto covered terrace — ipe timber decking, cast concrete planters, " +
      "architectural landscaping with ornamental grasses and specimen trees. " +
      "Warm morning sunlight streaming through windows casting long shadows on surfaces, " +
      "visible dust particles in volumetric light rays, realistic caustics through glass, " +
      "photorealistic material rendering — real wood grain, natural stone veining, brushed metal, linen texture, " +
      "V-Ray/Corona render quality, 8K textures, ultra detailed, no distortion, no artifacts."
    );
  }

  return (
    `Hyper-realistic cinematic interior architectural visualization, indistinguishable from real footage, of: ${desc.slice(0, 180)}. ` +
    "Shot on ARRI Alexa Mini, wide-angle prime lens, cinematic shallow depth of field. " +
    "Scene opens with dramatic sectional cutaway — building slices open revealing every floor, " +
    "steel beams with bolted connections, concrete columns, floor slabs, building core, elevator shafts, fire stairs. " +
    "Camera enters through main entrance — polished concrete lobby with double-height ceiling, " +
    "feature reception desk in stone and timber, recessed linear LED lighting, frameless glass doors. " +
    "Glides through corridor — suspended metal ceiling grid, integrated LED panels, sprinkler heads, " +
    "air diffusers, acoustic wall panels in felt fabric. " +
    "Passes glazed meeting room — frameless glass partitions, acoustic seals visible, cable management below raised floor. " +
    "Enters open office — contemporary workstations, task lighting, acoustic ceiling baffles, " +
    "exposed painted ductwork and cable trays above, full-height curtain wall with city views. " +
    "Warm 3200K interior lighting blended with cool 5600K daylight, realistic caustics through glass, volumetric light rays, " +
    "photorealistic material rendering — concrete formwork marks, real wood grain, brushed steel, woven carpet, " +
    "V-Ray/Corona render quality, 8K textures, ultra detailed, no distortion, no artifacts."
  );
}

// ─── Floor Plan → Video Prompts ──────────────────────────────────────────────

/**
 * Build prompt for floor plan exterior (5s): 2D plan transforms into 3D building.
 * The source image IS the floor plan — Kling will animate it into a 3D reveal.
 *
 * Scene timeline:
 *   0s–2s: Top-down view of a professional architectural floor plan on a drafting table
 *   2s–4s: The floor plan lines begin rising, extruding into 3D walls and a complete building
 *   4s–5s: Camera sweeps to a dramatic exterior aerial orbit of the newly formed 3D building
 */
export function buildFloorPlanExteriorPrompt(buildingDescription: string, roomInfo?: string): string {
  const desc = buildingDescription.slice(0, 400);
  const rooms = roomInfo ? ` Rooms: ${roomInfo.slice(0, 200)}.` : "";

  return (
    `Hyper-realistic cinematic architectural visualization. Source image is a 2D architectural floor plan drawing of: ${desc.slice(0, 150)}.${rooms} ` +
    "Shot on RED V-Raptor 8K, anamorphic lens, f/2.8 shallow depth of field. " +
    "Camera starts looking straight down at the architectural floor plan — clean white paper with room layouts, wall lines, and labels. " +
    "The 2D drawing magically begins transforming — floor plan lines rise and extrude upward into solid 3D walls, " +
    "glass windows materialize in wall openings, concrete floor slabs form between stories, " +
    "a complete photorealistic multi-story building grows organically from the flat blueprint. " +
    "Camera smoothly lifts and orbits as the 3D building finishes forming — " +
    "revealing a stunning modern building with full material detail: glass curtain walls reflecting golden hour sky, " +
    "stone and concrete cladding, aluminum window frames, landscaped entrance, mature trees casting shadows. " +
    "Golden hour warm sunlight with long dramatic shadows, volumetric atmospheric haze, " +
    "cinematic color grading, photorealistic global illumination, V-Ray/Corona render quality, " +
    "8K texture resolution, ultra detailed, no distortion, no artifacts."
  );
}

/**
 * Build prompt for floor plan interior (10s): Camera descends into the building
 * that was built from the floor plan, walking through the rooms.
 *
 * Scene timeline:
 *   0s–3s: Aerial view of 3D building → camera descends through roof into interior
 *   3s–10s: First-person walkthrough through rooms matching the floor plan layout
 */
export function buildFloorPlanInteriorPrompt(buildingDescription: string, roomInfo?: string): string {
  const desc = buildingDescription.slice(0, 400);
  const rooms = roomInfo ? ` Floor plan rooms: ${roomInfo.slice(0, 300)}.` : "";

  return (
    `Hyper-realistic cinematic interior architectural visualization of: ${desc.slice(0, 150)}.${rooms} ` +
    "Shot on ARRI Alexa Mini, wide-angle prime lens, cinematic shallow depth of field. " +
    "Camera descends from aerial view through the building's roof — " +
    "roof peels away in a dramatic sectional cutaway revealing every floor in cross-section, " +
    "structural beams, concrete columns, floor slabs, staircases, elevator shafts, MEP risers. " +
    "Camera enters the main floor — moving through rooms exactly as laid out in the architectural plan. " +
    "Grand entrance lobby with polished stone flooring, feature reception desk, recessed linear LED lighting. " +
    "Glides through corridors — suspended ceiling grid, integrated lighting, acoustic panels. " +
    "Enters living spaces and offices — contemporary furniture, floor-to-ceiling windows with natural light streaming in, " +
    "real material textures: hardwood floors, natural stone countertops, brushed metal fixtures, woven textiles. " +
    "Through each room showing the spatial flow of the architectural plan brought to life in photorealistic 3D. " +
    "Warm 3200K interior lighting blended with cool 5600K daylight, realistic caustics through glass, volumetric light rays, " +
    "photorealistic material rendering — real wood grain, honed stone, brushed stainless, woven carpet texture, " +
    "V-Ray/Corona render quality, 8K textures, ultra detailed, no distortion, no artifacts."
  );
}

// ─── Combined Single-Video Prompts (10s, no segments) ────────────────────────

/**
 * Combined walkthrough prompt for concept render input.
 * Single continuous 10s video: exterior approach → orbit → interior entry.
 * Replaces the old dual 5s+10s approach with one smooth shot.
 */
export function buildCombinedWalkthroughPrompt(buildingDescription: string): string {
  const desc = buildingDescription.slice(0, 500);
  const { isHighrise, hasGlass } = detectBuildingType(desc);

  const materialNote = hasGlass
    ? "Glass curtain wall with sky reflections, aluminum mullions, triple-glazed low-e units."
    : "Photorealistic materials — exposed concrete with formwork marks, weathering steel cladding, anodized aluminum frames.";

  const interiorStyle = isHighrise
    ? "grand double-height lobby with Carrara marble reception desk, polished terrazzo floor, recessed LED cove lighting, " +
      "open-plan office with Herman Miller workstations, full-height glass partitions, panoramic city views"
    : "polished concrete lobby with feature reception desk, natural timber accents, " +
      "open workspaces with contemporary furniture, floor-to-ceiling windows with natural light";

  return (
    `Hyper-realistic cinematic architectural visualization, indistinguishable from real drone footage, of: ${desc.slice(0, 150)}. ` +
    "Shot on RED V-Raptor 8K, anamorphic lens, f/2.8. Single continuous camera movement. " +
    "Camera starts at street level — slow forward dolly toward the building entrance, " +
    "capturing polished stone paving, landscaped forecourt, mature trees casting dappled shadows, the full building rising above. " +
    "Camera smoothly orbits the building revealing depth and massing — façade details, structural grid, curtain wall profiles. " +
    "Camera glides through the main entrance into the interior — " +
    `${interiorStyle}. ` +
    `${materialNote} ` +
    "Golden hour sunlight, volumetric haze, cinematic color grading, photorealistic global illumination, " +
    "V-Ray/Corona render quality, 8K textures, ultra detailed, no distortion, no artifacts."
  );
}

/**
 * Combined floor plan prompt for a single 10s video.
 * 2D plan → 3D building extrusion → interior walkthrough in one continuous shot.
 */
export function buildFloorPlanCombinedPrompt(buildingDescription: string, roomInfo?: string): string {
  const desc = buildingDescription.slice(0, 400);
  const rooms = roomInfo ? ` Rooms: ${roomInfo.slice(0, 200)}.` : "";

  return (
    `Hyper-realistic cinematic architectural visualization. Source image is a 2D architectural floor plan of: ${desc.slice(0, 150)}.${rooms} ` +
    "Shot on RED V-Raptor 8K, anamorphic lens. Single continuous camera movement. " +
    "Camera starts looking down at the architectural floor plan — clean drawing with room layouts, wall lines, and labels. " +
    "The 2D drawing begins transforming — floor plan lines rise and extrude upward into solid 3D walls, " +
    "glass windows materialize in openings, concrete floor slabs form between stories, " +
    "a complete photorealistic building grows from the flat blueprint. " +
    "Camera lifts and smoothly orbits the newly formed 3D building — " +
    "glass façade reflecting golden hour sky, stone cladding, landscaped entrance with mature trees. " +
    "Camera descends and glides through the main entrance into the interior — " +
    "polished stone lobby, feature reception desk, recessed LED lighting, " +
    "contemporary furniture, floor-to-ceiling windows with warm natural light streaming in. " +
    "Golden hour sunlight, volumetric atmospheric haze, cinematic color grading, " +
    "photorealistic global illumination, V-Ray/Corona render quality, " +
    "8K textures, ultra detailed, no distortion, no artifacts."
  );
}

/**
 * Build a cinematic AEC walkthrough prompt from the building description.
 * Single-video fallback: complete 15s timeline in one video.
 * Kept under 2500 chars (Kling API limit).
 *
 * Scene timeline (15s):
 *   0s–3s:  Front elevation — camera moves toward main entrance
 *   3s–6s:  Side elevation — cinematic orbit revealing depth
 *   6s–9s:  Aerial rise — roof plan with BIM elements
 *   9s–12s: BIM sectional cutaway — floors layer by layer
 *   12s–15s: Interior walkthrough — lobby and office floor
 */
export function buildArchitecturalVideoPrompt(
  buildingDescription: string
): string {
  const desc = buildingDescription.slice(0, 800);
  const lower = desc.toLowerCase();

  const hasGlass =
    lower.includes("glass") ||
    lower.includes("curtain wall") ||
    lower.includes("glazing");

  const materialNote = hasGlass
    ? "Glass curtain wall façade reflecting sunlight, visible structural grid, ray-traced reflections."
    : "Exposed steel structural frame, reinforced concrete slabs, realistic architectural materials, visible structural grid.";

  // Universal 5-phase camera motion matching the user's scene timeline
  const cameraMotion =
    "Front elevation view — camera slowly moves forward toward main entrance, " +
    "large façade with visible structural grid, landscaped plaza, realistic shadows and architectural proportions. " +
    "Camera smoothly transitions to side elevation with cinematic orbit — " +
    "building depth visible, façade panels, structural columns, curtain wall systems, architectural details. " +
    "Camera rises upward into aerial top view — roof plan with HVAC units, skylights, mechanical equipment, service walkways, parapet walls. " +
    "Roof transitions into BIM sectional cutaway — floors visible layer by layer showing structural beams, columns, floor slabs, building core, staircases, elevator shafts. " +
    "Camera moves inside showing modern lobby and office floor — glass partitions, staircases, elevators, furniture layout, lighting fixtures, architectural finishes.";

  return (
    `Ultra-realistic 3D BIM architectural visualization of: ${desc.slice(0, 200)}. ` +
    "Highly detailed parametric architecture, high-polygon detailed BIM building model. " +
    `${cameraMotion} ` +
    `${materialNote} ` +
    "Cinematic drone movement, smooth orbit, architectural flythrough, slow dolly camera motion, " +
    "natural daylight, realistic shadows, soft interior lighting, global illumination, " +
    "photorealistic architecture render, professional BIM visualization, extremely detailed geometry, 4K architectural animation, " +
    "Unreal Engine quality rendering, ray tracing, ultra detailed, no distortion."
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
  const negativePrompt = "blur, distortion, low quality, warped geometry, melting walls, deformed architecture, shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure, jittery motion, flickering textures, plastic appearance, fisheye distortion, floating objects, wireframe, cartoon, sketch, low polygon, unrealistic proportions, text overlay, watermark, oversaturated colors, CGI look, video game graphics, toy model, miniature, tilt-shift, abstract, surreal, people walking, cars moving, birds flying, lens flare";

  const exteriorPrompt = options?.isFloorPlan
    ? buildFloorPlanExteriorPrompt(buildingDescription, options.roomInfo)
    : buildExteriorPrompt(buildingDescription);
  const interiorPrompt = options?.isFloorPlan
    ? buildFloorPlanInteriorPrompt(buildingDescription, options.roomInfo)
    : buildInteriorPrompt(buildingDescription);

  console.log(`[Video] Submitting DUAL walkthrough tasks (5s + 10s)${options?.isFloorPlan ? " [FLOOR PLAN MODE]" : ""}`);

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
