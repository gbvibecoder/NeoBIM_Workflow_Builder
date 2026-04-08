/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Cinematic Multi-Stage Walkthrough Pipeline
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Produces a ~24 second seamless cinematic real-estate walkthrough video by
 * chaining three Kling image-to-video segments and stitching them with
 * ffmpeg `xfade` crossfades:
 *
 *   ┌────────────┐  ┌──────────────┐  ┌───────────┐
 *   │  OVERVIEW  │→ │  TRANSITION  │→ │ LIFESTYLE │ → ffmpeg xfade → final.mp4
 *   │   10s      │  │      5s      │  │    10s    │
 *   └────────────┘  └──────────────┘  └───────────┘
 *      orbit            descent          family
 *      around           into              relaxes
 *      3D model         living room       in room
 *
 *   • OVERVIEW   – top-down photoreal 3D render orbited cinematically
 *   • TRANSITION – starts on the LAST FRAME of OVERVIEW (extracted via
 *                  ffmpeg) so the cut is invisible. The camera descends
 *                  from the aerial view into the living room interior.
 *   • LIFESTYLE  – starts on a FRESHLY GENERATED eye-level interior render
 *                  (via GPT-Image-1) and animates the family scene.
 *   • STITCH     – 0.5s xfade between each segment, CRF 20 H.264, faststart.
 *
 * State for an in-flight pipeline lives in Redis under `cinematic:{id}` with
 * a 24h TTL. The polling endpoint advances the state machine on every call,
 * so the Vercel function lifetime is never the bottleneck.
 *
 * Cost per pipeline (Kling pro $0.10/s + GPT-Image-1 high):
 *   10s + 5s + 10s = $2.50 + ~$0.04 = ≈ $2.54
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { redis, redisConfigured } from "@/lib/rate-limit";
import { uploadToR2, uploadVideoToR2, isR2Configured } from "@/lib/r2";
import { logger } from "@/lib/logger";
import OpenAI from "openai";

// ─── Constants ───────────────────────────────────────────────────────────────

const KLING_BASE_URL = "https://api.klingai.com";
const KLING_IMAGE2VIDEO_PATH = "/v1/videos/image2video";
const JWT_EXPIRY_SECONDS = 1800;

/** Models tried in priority order. v2-1-master = highest quality, v2-6 fallback. */
const KLING_MODELS = ["kling-v2-1-master", "kling-v2-6"] as const;

/** Kling 1303 = parallel-task-slot exhausted. We retry with backoff. */
const KLING_1303_RETRY_DELAY_MS = 30_000;
const KLING_1303_MAX_RETRIES = 3;

/** TTL for pipeline state in Redis (24 hours — long enough to recover). */
export const PIPELINE_TTL_SECONDS = 24 * 60 * 60;

/** Crossfade duration between segments — 0.5s feels cinematic, not jarring. */
export const XFADE_DURATION = 0.5;

/** Per-stage durations (must match the prompts). */
export const STAGE_DURATIONS = {
  overview: 10,
  transition: 5,
  lifestyle: 10,
} as const;

/** Total visible duration after xfade overlap: 10 + 5 + 10 - 2*0.5 = 24s. */
export const PIPELINE_VISIBLE_SECONDS =
  STAGE_DURATIONS.overview +
  STAGE_DURATIONS.transition +
  STAGE_DURATIONS.lifestyle -
  2 * XFADE_DURATION;

// ─── Types ───────────────────────────────────────────────────────────────────

export type CinematicStageStatus =
  | "pending"
  | "preparing"
  | "submitted"
  | "processing"
  | "complete"
  | "failed";

export type CinematicPipelineStatus =
  | "processing"
  | "complete"
  | "partial"
  | "failed";

export interface CinematicStageState {
  status: CinematicStageStatus;
  /** Kling task id once submitted. */
  taskId?: string;
  /** Raw Kling-hosted video URL (short-lived). */
  klingUrl?: string;
  /** R2-persisted permanent URL. */
  persistedUrl?: string;
  /** Human-readable error if the stage failed. */
  error?: string;
  /** When this stage was first submitted (ms epoch). */
  startedAt?: number;
  /** When this stage finished (success or fail) (ms epoch). */
  completedAt?: number;
}

export interface CinematicTransitionState extends CinematicStageState {
  /** R2 URL of the JPEG frame extracted from the end of OVERVIEW. */
  lastFrameUrl?: string;
}

export interface CinematicLifestyleState extends CinematicStageState {
  /** R2 URL of the GPT-Image-1 eye-level lifestyle render used as Kling source. */
  sourceImageUrl?: string;
}

export interface CinematicStitchState {
  status: CinematicStageStatus;
  /** R2 URL of the final stitched MP4. */
  finalUrl?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface CinematicPipelineInputs {
  /** R2 URL of the photorealistic top-down 3D render. Required. */
  sourceImageUrl: string;
  /** Original 2D floor plan as data URL or http URL (used for the GPT-Image-1 reference). */
  floorPlanRef: string;
  /** GPT-4o full description of the floor plan (rooms, furniture, materials). */
  description: string;
  /** Room labels visible in the floor plan, e.g. ["Living Room", "Kitchen"]. */
  rooms: string[];
  /** "modern apartment" / "modern villa" / etc. */
  buildingType: string;
  /** Which room to descend into for stages 2-3. Default: "Living Room". */
  primaryRoom: string;
}

export interface CinematicPipelineState {
  pipelineId: string;
  userId: string;
  createdAt: number;
  /** Set when stitch completes — top-level shortcut for the client. */
  finalVideoUrl?: string;
  pipelineStatus: CinematicPipelineStatus;
  inputs: CinematicPipelineInputs;
  stages: {
    overview: CinematicStageState;
    transition: CinematicTransitionState;
    lifestyle: CinematicLifestyleState;
    stitch: CinematicStitchState;
  };
}

// ─── Stage Status Messages (used by polling endpoint) ────────────────────────

/** Witty per-stage copy shown in the UI. */
export const STAGE_COPY: Record<
  "overview" | "transition" | "lifestyle" | "stitch",
  { en: string; de: string }
> = {
  overview: {
    en: "Creating cinematic overview of your floor plan...",
    de: "Erstelle kinoreife Übersicht Ihres Grundrisses...",
  },
  transition: {
    en: "Preparing the grand entrance into your living room...",
    de: "Bereite den großen Auftritt in Ihr Wohnzimmer vor...",
  },
  lifestyle: {
    en: "Bringing your home to life with a family scene...",
    de: "Erwecke Ihr Zuhause mit einer Familienszene zum Leben...",
  },
  stitch: {
    en: "Producing the final cut of your masterpiece...",
    de: "Produziere den finalen Schnitt Ihres Meisterwerks...",
  },
};

// ─── Kling JWT (mirrors video-service.ts so we don't import private helpers) ─

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateKlingJwt(): string {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error(
      "KLING_ACCESS_KEY and KLING_SECRET_KEY environment variables are required for the cinematic pipeline",
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto");
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

interface KlingTaskResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    task_id: string;
    task_status: "submitted" | "processing" | "succeed" | "failed";
    task_status_msg?: string;
    task_result?: {
      videos?: Array<{ id: string; url: string; duration: string }>;
    };
  };
}

async function klingFetch(
  path: string,
  options: { method: string; body?: unknown },
): Promise<KlingTaskResponse> {
  for (let attempt = 0; attempt <= KLING_1303_MAX_RETRIES; attempt++) {
    const token = generateKlingJwt();
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
      let errorMessage = `Kling API HTTP ${res.status}`;
      let errorCode: number | undefined;
      try {
        const errData = await res.json();
        errorCode = errData?.code;
        if (errData?.code === 1102) {
          errorMessage =
            "Kling account balance is empty — please top up your Kling AI account at klingai.com";
        } else if (errData?.message) {
          errorMessage = `Kling API error: ${errData.message} (code ${errData.code})`;
        }
      } catch {
        const text = await res.text().catch(() => "Unknown error");
        errorMessage = `Kling API HTTP ${res.status}: ${text.slice(0, 300)}`;
      }
      if (errorCode === 1303 && attempt < KLING_1303_MAX_RETRIES) {
        logger.warn(
          `[CINEMATIC] Kling 1303 (parallel limit), retrying in 30s (attempt ${attempt + 1}/${KLING_1303_MAX_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, KLING_1303_RETRY_DELAY_MS));
        continue;
      }
      throw new Error(errorMessage);
    }

    const data = (await res.json()) as KlingTaskResponse;
    if (data.code !== 0) {
      if (data.code === 1303 && attempt < KLING_1303_MAX_RETRIES) {
        logger.warn(
          `[CINEMATIC] Kling 1303 (parallel limit), retrying in 30s (attempt ${attempt + 1}/${KLING_1303_MAX_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, KLING_1303_RETRY_DELAY_MS));
        continue;
      }
      const msg =
        data.code === 1102
          ? "Kling account balance is empty — please top up your Kling AI account at klingai.com"
          : `Kling API error: ${data.message} (code ${data.code})`;
      throw new Error(msg);
    }
    return data;
  }
  throw new Error("Kling API: max retries exceeded");
}

// ─── Kling Segment Submission (single-shot, no polling) ──────────────────────

/**
 * Submit a single Kling image2video task and return the task id immediately.
 * Tries each model in MODELS in order; returns the first success.
 *
 * The negative prompt is shared across all stages — it lists everything that
 * tends to ruin a real-estate walkthrough (warping, low-poly, watermarks…).
 */
export async function submitCinematicSegment(args: {
  imageUrlOrBase64: string;
  prompt: string;
  durationSeconds: 5 | 10;
  aspectRatio?: "16:9" | "9:16" | "1:1";
}): Promise<{ taskId: string }> {
  const {
    imageUrlOrBase64,
    prompt,
    durationSeconds,
    aspectRatio = "16:9",
  } = args;

  const negativePrompt =
    "blur, distortion, low quality, warped geometry, melting walls, deformed architecture, " +
    "shaky camera, noise, artifacts, morphing surfaces, bent lines, wobbly structure, " +
    "jittery motion, flickering textures, plastic appearance, fisheye distortion, " +
    "floating objects, wireframe, cartoon, sketch, low polygon, unrealistic proportions, " +
    "text overlay, watermark, oversaturated colors, video game graphics, toy model, " +
    "miniature, tilt-shift, abstract, surreal, lens flare, cropped composition, " +
    "letterboxing, motion blur on furniture";

  const errors: string[] = [];
  for (const modelName of KLING_MODELS) {
    try {
      const body = {
        model_name: modelName,
        image: imageUrlOrBase64,
        prompt: prompt.slice(0, 2500),
        negative_prompt: negativePrompt.slice(0, 2500),
        aspect_ratio: aspectRatio,
        mode: "pro" as const,
        duration: String(durationSeconds) as "5" | "10",
      };
      const result = await klingFetch(KLING_IMAGE2VIDEO_PATH, {
        method: "POST",
        body,
      });
      logger.info(
        `[CINEMATIC] Kling submit ok: model=${modelName} duration=${durationSeconds}s task=${result.data.task_id}`,
      );
      return { taskId: result.data.task_id };
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(`${modelName}: ${msg}`);
      logger.warn(`[CINEMATIC] Kling model ${modelName} failed: ${msg.slice(0, 200)}`);
    }
  }
  throw new Error(`All Kling models failed for cinematic segment:\n${errors.join("\n")}`);
}

/** Check status of a single cinematic Kling task. Returns the raw video URL if succeeded. */
export async function checkCinematicSegmentStatus(taskId: string): Promise<{
  status: "submitted" | "processing" | "succeed" | "failed";
  videoUrl: string | null;
  failureMessage: string | null;
}> {
  const result = await klingFetch(`${KLING_IMAGE2VIDEO_PATH}/${taskId}`, {
    method: "GET",
  });
  const status = result.data.task_status;
  const videoUrl = result.data.task_result?.videos?.[0]?.url ?? null;
  const failureMessage =
    status === "failed" ? (result.data.task_status_msg ?? "Unknown error") : null;
  return { status, videoUrl, failureMessage };
}

// ─── Prompt Engineering ─────────────────────────────────────────────────────
//
// The prompts below were authored explicitly for the Kling v2.x image2video
// model after iteration. Three principles drive every prompt:
//
//   1. Camera movement comes FIRST and is mechanical, not poetic ("slow
//      clockwise orbit at 45° elevation completing a 180° arc"). Kling
//      reliably executes specific, named camera moves; vague directions like
//      "cinematic" produce drift.
//   2. Lighting is DESCRIBED as a real photographer would describe it (key
//      light direction, fill ratio, rim lighting, time of day). This is what
//      separates V-Ray-quality output from "AI demo" output.
//   3. The end-state of a clip determines what the next clip can pick up —
//      the OVERVIEW prompt explicitly says "ending with the camera positioned
//      directly above the living room" so the TRANSITION clip's first frame
//      is a clean entry point.

/** Stage 1 — OVERVIEW (10s): cinematic orbit around the photorealistic 3D model. */
export function buildOverviewPrompt(args: {
  description: string;
  rooms: string[];
  primaryRoom: string;
}): string {
  const { description, rooms, primaryRoom } = args;
  const roomList = rooms.length > 0 ? rooms.join(", ") : "living room, kitchen, bedrooms";
  const desc = description.slice(0, 600);

  return (
    "Cinematic 10-second aerial overview of a photorealistic 3D architectural floor plan model. " +
    "The camera performs a slow, perfectly smooth clockwise orbit at 60-degree elevation, " +
    "completing a 180-degree arc around the entire building footprint, ending with the camera " +
    `positioned directly above the ${primaryRoom.toLowerCase()}. ` +
    "Top-down architectural visualization, roof removed to reveal every furnished room. " +
    `Rooms visible: ${roomList}. ` +
    `Layout reference: ${desc}. ` +
    "Lighting: warm golden-hour key light from the upper-left at 35 degrees, soft ambient fill, " +
    "long natural shadows extending east, subtle rim lighting on furniture edges and wall caps. " +
    "Materials: polished hardwood floors with realistic reflections, matte plaster walls, brushed " +
    "nickel fixtures, fabric upholstery, marble countertops, glass for window openings. " +
    "Style: high-end real-estate marketing visualization, V-Ray-quality global illumination, " +
    "shallow architectural depth-of-field, 4K crisp detail, perfectly steady camera, " +
    "no people in this shot, no animals, no motion in the scene — only the camera moves."
  );
}

/**
 * Stage 2 — TRANSITION (5s): the camera descends from the aerial view of the
 * floor plan model into the interior of the primary room. The first frame is
 * the LAST frame of the OVERVIEW clip, so the cut is invisible.
 */
export function buildTransitionPrompt(args: {
  description: string;
  primaryRoom: string;
}): string {
  const { description, primaryRoom } = args;
  const desc = description.slice(0, 400);
  const room = primaryRoom.toLowerCase();

  return (
    "Cinematic 5-second continuous one-shot camera descent. " +
    "The camera begins as an aerial view of a 3D architectural floor plan model and smoothly " +
    `descends straight down into the ${room}, transitioning seamlessly from a top-down ` +
    "perspective to an eye-level interior view at approximately 1.5 meters height. " +
    "The descent is steady, perfectly fluid, no jerks or zooms — like a drone gliding into " +
    "an open skylight. As the camera descends, the aerial floor plan transforms into a fully " +
    "furnished, photorealistic interior room. The camera ends facing across the room at " +
    "human eye level, the room's furniture and walls fully visible. " +
    `Room context: ${desc}. ` +
    "Lighting: warm golden-hour sunlight streams through large windows on the right side, " +
    "soft natural fill bouncing off pale walls, gentle indirect lighting from above. " +
    "Materials: hardwood flooring, matte white plaster walls, fabric upholstery, neutral palette. " +
    "Style: cinematic real-estate marketing one-shot, photorealistic, " +
    "smooth professional camera operator, no jitter, no people yet — the room is empty."
  );
}

/**
 * Stage 3 — LIFESTYLE (10s): the room comes alive. Family members appear,
 * warm light fills the room, the camera pans slowly across the scene.
 *
 * The Kling source image for this stage is a freshly generated GPT-Image-1
 * eye-level interior render (see generateLifestyleImage below).
 */
export function buildLifestylePrompt(args: {
  description: string;
  primaryRoom: string;
}): string {
  const { description, primaryRoom } = args;
  const desc = description.slice(0, 400);
  const room = primaryRoom.toLowerCase();

  return (
    `Cinematic 10-second lifestyle scene inside a beautifully furnished modern ${room}. ` +
    "The camera performs a slow horizontal dolly from left to right at human eye level " +
    "(approximately 1.5 meters), revealing the entire room over the duration of the shot. " +
    "Soft handheld micro-movement only — no zoom, no rotation, no tilt. " +
    `Room context: ${desc}. ` +
    "The room comes to life as the camera pans: " +
    "A woman in a cream knit sweater sits on a contemporary L-shaped grey sofa near the " +
    "window, reading a hardcover book — she turns a page with a relaxed expression. " +
    "A man in a casual navy linen shirt sits at the wooden dining table on the right side, " +
    "leaning over to help a young child draw with colored pencils — gentle smiling interaction. " +
    "A small golden retriever sleeps curled up on a beige textured area rug near the coffee table, " +
    "its chest gently rising and falling with breath. " +
    "Lighting: warm golden-hour sunlight streams through floor-to-ceiling windows on the left, " +
    "casting long soft shadows across the hardwood floor and warm highlights on the family's faces. " +
    "Subtle dust particles drift through the sunbeams. " +
    "Materials: polished oak hardwood, matte white plaster walls, linen and wool textiles, " +
    "brass and walnut accents, fresh flowers on the dining table, an open laptop on the side table. " +
    "Style: high-end real-estate lifestyle commercial, photorealistic, cinematic shallow " +
    "depth of field, color-graded warm and inviting, 4K detail, " +
    "natural authentic family interaction, smooth professional camera, no morphing, " +
    "no distortion of faces or hands, anatomically correct people."
  );
}

// ─── Eye-Level Lifestyle Image Generation (GPT-Image-1) ──────────────────────
//
// This is the source image for the LIFESTYLE stage. It's an eye-level,
// photorealistic interior render of the primary room — generated FRESH from
// the floor plan + GPT-4o description, NOT a top-down view. Without this
// step the lifestyle stage would have nothing for Kling to animate at eye
// level (the existing renders are all top-down or 45° isometric).
//
// We pass the original 2D floor plan as the edit reference so the room shape
// and proportions match, and prompt for a fully-furnished modern interior.
// People are NOT included here (people get added by Kling at the video stage,
// where it can give them subtle natural motion instead of frozen poses).

const LIFESTYLE_IMAGE_PROMPT_TEMPLATE =
  "Photorealistic eye-level interior architecture photograph of the {ROOM} from this floor plan. " +
  "Camera at human eye level (1.5 meters height), positioned in the doorway looking across the " +
  "entire room toward the far wall, capturing the full width of the space at a wide-angle 28mm " +
  "perspective. The {ROOM} is fully furnished as a modern contemporary lifestyle space. " +
  "Furniture (must match the floor plan room dimensions exactly): {FURNITURE}. " +
  "Lighting: warm golden-hour sunlight streaming through floor-to-ceiling windows on one side, " +
  "soft natural ambient fill, subtle bounce light off pale walls, warm color temperature, " +
  "long soft shadows across polished hardwood floors, gentle indirect ceiling glow. " +
  "Materials: polished oak hardwood flooring with realistic reflections, matte white plaster walls, " +
  "neutral textile upholstery in cream and grey, brushed brass fixtures, fresh flowers in a vase. " +
  "Style: ultra-high-end real-estate lifestyle photography, ARCHITECTURAL DIGEST quality, " +
  "shallow architectural depth of field, color-graded warm and inviting, 4K crisp detail, " +
  "professional interior design photography. " +
  "IMPORTANT: NO people in this image, NO animals, NO text, NO labels, NO watermark. " +
  "The room is empty and waiting — life will be added in the next stage. " +
  "The room dimensions, wall positions, window positions and door positions must match the " +
  "floor plan EXACTLY — do not invent walls, do not move openings.";

const ROOM_FURNITURE_HINTS: Record<string, string> = {
  "living room":
    "L-shaped grey sectional sofa centered on the longest wall facing a low walnut coffee table, " +
    "a plush textured area rug under the seating area, a wood-and-glass media console with a " +
    "framed wall art piece above it, a tall floor lamp in the corner, a small accent armchair, " +
    "fresh flowers on the coffee table, large indoor plant in the corner",
  "kitchen":
    "white quartz waterfall island with three modern bar stools, matte handleless white cabinets, " +
    "stainless steel sink, integrated appliances, a large pendant light over the island, " +
    "fresh herbs in pots on the counter, open shelving with neatly arranged ceramics",
  "bedroom":
    "king-size platform bed centered on the back wall with a tufted linen headboard, two matching " +
    "walnut nightstands with brass lamps, a chunky knit throw at the foot of the bed, a tall " +
    "wardrobe on one side, soft sheer curtains framing the window, a small reading chair in " +
    "the corner",
  "dining room":
    "long live-edge walnut dining table with six contemporary upholstered dining chairs, a matte " +
    "black linear pendant light hanging directly above, a sideboard against one wall with " +
    "ceramics and a framed art piece, fresh flowers as a centerpiece",
};

/** Look up the right furniture hint for the room (case-insensitive). */
function furnitureHintForRoom(roomName: string): string {
  const key = roomName.toLowerCase().trim();
  if (ROOM_FURNITURE_HINTS[key]) return ROOM_FURNITURE_HINTS[key];
  // Fallback heuristics for slight name variations
  if (key.includes("living") || key.includes("lounge") || key.includes("family"))
    return ROOM_FURNITURE_HINTS["living room"];
  if (key.includes("kitchen")) return ROOM_FURNITURE_HINTS["kitchen"];
  if (key.includes("bed") || key.includes("master")) return ROOM_FURNITURE_HINTS["bedroom"];
  if (key.includes("dining")) return ROOM_FURNITURE_HINTS["dining room"];
  // Generic furnished interior fallback
  return (
    "modern contemporary furniture appropriate for the room function, neutral palette, " +
    "warm wood tones, fabric textiles, indoor plants, framed art, minimalist styling"
  );
}

/**
 * Generate the eye-level lifestyle image via GPT-Image-1 images.edit.
 * Uses the floor plan as the reference image (so the room shape matches) and
 * a richly detailed prompt for the empty furnished interior.
 *
 * The result is uploaded to R2 and the public URL is returned. R2 is required
 * because Kling's image field needs base64 OR a URL — and storing it on R2
 * means the URL is also surfaced to the user as a "Stage prep" thumbnail.
 */
export async function generateLifestyleImage(args: {
  floorPlanRef: string; // data URL, http(s) URL, or raw base64 — NOT a blob: URL
  description: string;
  primaryRoom: string;
  apiKey: string;
}): Promise<{ url: string; base64: string }> {
  const { floorPlanRef, description, primaryRoom, apiKey } = args;
  const client = new OpenAI({ apiKey, timeout: 180_000 });

  // ─── REJECT browser blob: URLs explicitly ────────────────────────────────
  // Production bug we hit once: the client was sending the result of
  // URL.createObjectURL(file) — a `blob:http://...` URL — as the floor plan
  // reference. blob: URLs only exist inside the browser tab that created
  // them; the server cannot fetch them. Without this check we silently fell
  // through to the `Buffer.from(string, "base64")` branch, decoded the
  // literal "blob:http://..." into ~30 bytes of garbage, and then OpenAI
  // returned a confusing "400 Invalid image file". Fail loudly here so the
  // client gets a clear, actionable error.
  if (floorPlanRef.startsWith("blob:")) {
    throw new Error(
      "Floor plan was passed as a browser blob: URL — clients must read the file " +
        "and send it as a data URL (FileReader.readAsDataURL) or upload it to a " +
        "publicly fetchable HTTP URL first.",
    );
  }
  if (!floorPlanRef || floorPlanRef.length < 10) {
    throw new Error("Floor plan reference is empty or too short.");
  }

  // ─── Resolve floor plan into a clean ArrayBuffer + mime type ──────────────
  // We always go through a STANDALONE ArrayBuffer (not a Node Buffer pool
  // slice) so the resulting Node Buffer below is `Buffer<ArrayBuffer>`,
  // which the File constructor accepts cleanly without any cast or wrap.
  // This mirrors the pattern in src/app/api/generate-3d-render/route.ts
  // (lines 147-156) that successfully calls openai.images.edit.
  let arrayBuffer: ArrayBuffer;
  let mimeType = "image/png";

  if (floorPlanRef.startsWith("http://") || floorPlanRef.startsWith("https://")) {
    const res = await fetch(floorPlanRef, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      throw new Error(`Failed to download floor plan reference: HTTP ${res.status}`);
    }
    arrayBuffer = await res.arrayBuffer();
    mimeType = res.headers.get("content-type") ?? "image/png";
  } else if (floorPlanRef.startsWith("data:")) {
    const commaIdx = floorPlanRef.indexOf(",");
    if (commaIdx < 0) {
      throw new Error("Floor plan data URL is malformed (no comma separator).");
    }
    const meta = floorPlanRef.slice(0, commaIdx);
    const b64 = floorPlanRef.slice(commaIdx + 1);
    const tmp = Buffer.from(b64, "base64");
    // Slice the underlying buffer to get a STANDALONE ArrayBuffer (not a
    // slice of Node's shared 8KB pool). This is what makes Buffer.from()
    // below return Buffer<ArrayBuffer> instead of Buffer<ArrayBufferLike>,
    // which is exactly the type the File constructor expects.
    arrayBuffer = tmp.buffer.slice(
      tmp.byteOffset,
      tmp.byteOffset + tmp.byteLength,
    ) as ArrayBuffer;
    const mimeMatch = /^data:([^;]+)/.exec(meta);
    if (mimeMatch) mimeType = mimeMatch[1];
  } else {
    // Last resort: assume raw base64. Same buffer-pool slicing trick.
    const tmp = Buffer.from(floorPlanRef, "base64");
    arrayBuffer = tmp.buffer.slice(
      tmp.byteOffset,
      tmp.byteOffset + tmp.byteLength,
    ) as ArrayBuffer;
  }

  // ─── Validate the decoded bytes look like a real image ──────────────────
  // If decoding produced a tiny buffer, the input was garbage (e.g. the
  // base64-decoded form of "blob:http://..."). Refuse here with a clear
  // error instead of forwarding nonsense to OpenAI.
  if (arrayBuffer.byteLength < 1024) {
    throw new Error(
      `Floor plan reference decoded to only ${arrayBuffer.byteLength} bytes — ` +
        `too small to be a valid image. The client likely passed a blob: URL or ` +
        `an invalid base64 string.`,
    );
  }

  // Normalize mime type to one of the GPT-Image-1-supported formats so the
  // File metadata + filename extension match what OpenAI expects to receive.
  const lowerMime = mimeType.toLowerCase();
  if (
    !lowerMime.includes("png") &&
    !lowerMime.includes("jpeg") &&
    !lowerMime.includes("jpg") &&
    !lowerMime.includes("webp")
  ) {
    mimeType = "image/png";
  }

  // ─── Construct the File EXACTLY like generate-3d-render does ─────────────
  // imageBuffer is now Buffer<ArrayBuffer> (because arrayBuffer is a
  // standalone ArrayBuffer, not a slice of Node's pool), so it satisfies
  // the BlobPart type without any wrap or cast — matching the working
  // pattern at src/app/api/generate-3d-render/route.ts:154-156.
  const imageBuffer = Buffer.from(arrayBuffer);
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : "jpg";
  const refFile = new File([imageBuffer], `floorplan.${ext}`, { type: mimeType });

  const furnitureHint = furnitureHintForRoom(primaryRoom);
  const desc = description.slice(0, 1500);
  const prompt =
    LIFESTYLE_IMAGE_PROMPT_TEMPLATE.replace(/\{ROOM\}/g, primaryRoom)
      .replace("{FURNITURE}", furnitureHint) +
    `\n\nAdditional layout context: ${desc}`;

  logger.info(`[CINEMATIC] Generating lifestyle image for room "${primaryRoom}"...`);
  const start = Date.now();

  // Landscape 1536x1024 — closest to a 16:9 cinematic frame, feeds Kling
  // image2video which generates 16:9 video output.
  const render = await client.images.edit({
    model: "gpt-image-1",
    image: refFile,
    prompt,
    size: "1536x1024",
    quality: "high",
    input_fidelity: "low", // Don't try to copy floor plan lines — only use shape as reference
  });

  const generated = render.data?.[0]?.b64_json ?? render.data?.[0]?.url;
  if (!generated) {
    throw new Error("GPT-Image-1 returned no lifestyle image");
  }

  let base64: string;
  if (generated.startsWith("http")) {
    const r = await fetch(generated, { signal: AbortSignal.timeout(30_000) });
    const arr = await r.arrayBuffer();
    base64 = Buffer.from(arr).toString("base64");
  } else {
    base64 = generated;
  }

  // Upload to R2 so we can pass a clean URL to Kling and surface it in the UI.
  let url = "";
  if (isR2Configured()) {
    const buf = Buffer.from(base64, "base64");
    const result = await uploadToR2(
      buf,
      `cinematic-lifestyle-${Date.now()}.png`,
      "image/png",
    );
    if (result.success) {
      url = result.url;
    } else {
      logger.warn("[CINEMATIC] R2 upload of lifestyle image failed:", result.error);
    }
  }

  // If R2 wasn't available, Kling will accept the raw base64 directly.
  if (!url) url = base64;

  logger.info(
    `[CINEMATIC] Lifestyle image ready in ${Date.now() - start}ms (${Math.round(base64.length / 1024)}KB)`,
  );
  return { url, base64 };
}

// ─── ffmpeg helpers (last-frame extraction + xfade stitching) ────────────────
//
// All ffmpeg operations live here so the orchestrator and status routes don't
// have to know about temp files. Each function manages its own tmp directory
// and cleans up on success or failure.

/**
 * Extract a JPEG of the LAST frame of an MP4 video.
 *
 * The trick is `-sseof -0.05` (seek to 50ms before end) followed by
 * `-frames:v 1`. We can't use `-sseof 0` because some encoders mark a few
 * frames as "non-keyframes" past the end and ffmpeg returns a black frame.
 * 50ms before end is reliably the last visible frame.
 */
export async function extractLastFrameToR2(
  videoUrl: string,
  pipelineId: string,
): Promise<string> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const { mkdtemp, writeFile, readFile, unlink, rm } = await import("fs/promises");
  const { tmpdir } = await import("os");
  const { join } = await import("path");

  const execFileAsync = promisify(execFile);

  // Resolve ffmpeg binary — prefer ffmpeg-static, fall back to system ffmpeg.
  // Inlined (instead of a shared helper) to match the exact pattern used by
  // src/app/api/concat-videos/route.ts. NOTE: the actual fix for the
  // production "spawn /ROOT/node_modules/ffmpeg-static/ffmpeg ENOENT" error
  // is `serverExternalPackages: ["ffmpeg-static"]` in next.config.ts — that
  // tells Turbopack/Next.js to NOT bundle the package, so __dirname inside
  // ffmpeg-static/index.js resolves to the real filesystem path at runtime
  // instead of Turbopack's `/ROOT/...` virtual prefix.
  let ffmpegPath: string;
  try {
    ffmpegPath = (await import("ffmpeg-static")).default as unknown as string;
  } catch {
    ffmpegPath = "ffmpeg"; // system ffmpeg
  }

  const tempDir = await mkdtemp(join(tmpdir(), `cine-frame-${pipelineId}-`));
  const inputPath = join(tempDir, "in.mp4");
  const outputPath = join(tempDir, "last.jpg");

  try {
    logger.info(`[CINEMATIC][${pipelineId}] Downloading overview for last-frame extract...`);
    const res = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Failed to download video: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(inputPath, buf);

    logger.info(`[CINEMATIC][${pipelineId}] Running ffmpeg last-frame extraction...`);
    await execFileAsync(
      ffmpegPath,
      [
        "-sseof",
        "-0.05",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "-y",
        outputPath,
      ],
      { timeout: 60_000 },
    );

    const frameBuf = await readFile(outputPath);
    if (!isR2Configured()) {
      throw new Error("R2 is not configured — last-frame upload requires R2 storage");
    }
    const result = await uploadToR2(
      frameBuf,
      `cinematic-frame-${pipelineId}.jpg`,
      "image/jpeg",
    );
    if (!result.success) {
      throw new Error(`R2 upload of last frame failed: ${result.error}`);
    }
    logger.info(
      `[CINEMATIC][${pipelineId}] Last frame uploaded: ${result.url} (${frameBuf.length} bytes)`,
    );
    return result.url;
  } finally {
    // Best-effort cleanup
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Stitch 1, 2, or 3 video segments into a single cinematic MP4 with xfade
 * crossfades between adjacent segments.
 *
 * The graceful-degradation matrix means we may receive 1, 2, or 3 inputs:
 *   • 3 inputs → full pipeline succeeded
 *   • 2 inputs → one stage failed, we still produce a meaningful video
 *   • 1 input  → only one stage succeeded; we just persist it as the "final"
 *
 * Each segment is downloaded, then ffmpeg's xfade filter graph is built
 * dynamically to chain them. Final encode is H.264 CRF 20 + preset slow +
 * faststart for browser playback. Audio track is silent (Kling's videos
 * have no audio anyway). Subtle 0.3s fade in/out at the very ends.
 */
export async function stitchCinematicSegments(args: {
  segments: Array<{ name: string; url: string; durationSeconds: number }>;
  pipelineId: string;
}): Promise<{ finalUrl: string; sizeBytes: number; durationSeconds: number }> {
  const { segments, pipelineId } = args;
  if (segments.length === 0) {
    throw new Error("No segments to stitch");
  }

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const { mkdtemp, writeFile, readFile, unlink, rm } = await import("fs/promises");
  const { tmpdir } = await import("os");
  const { join } = await import("path");

  const execFileAsync = promisify(execFile);

  // Resolve ffmpeg binary — prefer ffmpeg-static, fall back to system ffmpeg.
  // Inlined (instead of a shared helper) to match the exact pattern used by
  // src/app/api/concat-videos/route.ts. NOTE: the actual fix for the
  // production "spawn /ROOT/node_modules/ffmpeg-static/ffmpeg ENOENT" error
  // is `serverExternalPackages: ["ffmpeg-static"]` in next.config.ts — that
  // tells Turbopack/Next.js to NOT bundle the package, so __dirname inside
  // ffmpeg-static/index.js resolves to the real filesystem path at runtime
  // instead of Turbopack's `/ROOT/...` virtual prefix.
  let ffmpegPath: string;
  try {
    ffmpegPath = (await import("ffmpeg-static")).default as unknown as string;
  } catch {
    ffmpegPath = "ffmpeg"; // system ffmpeg
  }

  const tempDir = await mkdtemp(join(tmpdir(), `cine-stitch-${pipelineId}-`));
  const segPaths: string[] = [];
  const outputPath = join(tempDir, "out.mp4");
  const cleanup: string[] = [];

  try {
    // Download every segment in parallel
    logger.info(
      `[CINEMATIC][${pipelineId}] Downloading ${segments.length} segments for stitching...`,
    );
    await Promise.all(
      segments.map(async (seg, idx) => {
        const path = join(tempDir, `seg-${idx}.mp4`);
        segPaths.push(path);
        cleanup.push(path);
        const res = await fetch(seg.url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) {
          throw new Error(`Segment ${idx} (${seg.name}) download failed: HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(path, buf);
      }),
    );
    cleanup.push(outputPath);

    if (segments.length === 1) {
      // Single-segment fallback: re-encode to H.264 CRF 20 + faststart so it
      // matches the multi-segment output format and plays in every browser.
      logger.info(
        `[CINEMATIC][${pipelineId}] Single-segment stitch (re-encode pass)`,
      );
      await execFileAsync(
        ffmpegPath,
        [
          "-i",
          segPaths[0],
          "-vf",
          // 0.3s fade in / 0.3s fade out applied at start and end of the only segment
          `fade=t=in:st=0:d=0.3,fade=t=out:st=${Math.max(0, segments[0].durationSeconds - 0.3)}:d=0.3`,
          "-c:v",
          "libx264",
          "-crf",
          "20",
          "-preset",
          "slow",
          "-pix_fmt",
          "yuv420p",
          "-an",
          "-movflags",
          "+faststart",
          "-y",
          outputPath,
        ],
        { timeout: 300_000 },
      );
    } else {
      // Multi-segment xfade pipeline.
      //
      // Filter graph for 3 segments (durations d0, d1, d2; xfade 0.5s):
      //   [0:v][1:v]xfade=transition=fade:duration=0.5:offset=(d0-0.5)[v01]
      //   [v01][2:v]xfade=transition=fade:duration=0.5:offset=(d0+d1-0.5-0.5)[vout]
      //
      // Each xfade reduces total duration by `duration`. For 2 segments we
      // only need one xfade. The last [vout] gets fade in/out applied.
      const inputs: string[] = [];
      for (const p of segPaths) {
        inputs.push("-i", p);
      }

      const filterParts: string[] = [];
      let prevLabel = "[0:v]";
      let runningOffset = 0; // running visible duration of the merged graph so far
      for (let i = 1; i < segments.length; i++) {
        const prevDur = segments[i - 1].durationSeconds;
        // For the first xfade, offset = prevDur - XFADE_DURATION.
        // For subsequent xfades, offset = runningOffset + prevDur - XFADE_DURATION.
        const offset = (i === 1 ? 0 : runningOffset) + prevDur - XFADE_DURATION;
        const outLabel = i === segments.length - 1 ? "[vraw]" : `[v${i}]`;
        filterParts.push(
          `${prevLabel}[${i}:v]xfade=transition=fade:duration=${XFADE_DURATION}:offset=${offset.toFixed(
            3,
          )}${outLabel}`,
        );
        prevLabel = outLabel;
        runningOffset = offset; // running offset = where this segment "began" in merged time
      }

      // Apply gentle fade-in and fade-out to the final composed output. The
      // total visible duration accounts for the xfade overlaps.
      const totalVisible =
        segments.reduce((sum, s) => sum + s.durationSeconds, 0) -
        (segments.length - 1) * XFADE_DURATION;
      const fadeOutStart = Math.max(0, totalVisible - 0.4);
      filterParts.push(
        `${prevLabel}fade=t=in:st=0:d=0.4,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.4[vout]`,
      );

      const filterGraph = filterParts.join(";");
      logger.info(
        `[CINEMATIC][${pipelineId}] xfade graph: ${filterGraph.slice(0, 200)}`,
      );

      await execFileAsync(
        ffmpegPath,
        [
          ...inputs,
          "-filter_complex",
          filterGraph,
          "-map",
          "[vout]",
          "-c:v",
          "libx264",
          "-crf",
          "20",
          "-preset",
          "slow",
          "-pix_fmt",
          "yuv420p",
          "-an",
          "-movflags",
          "+faststart",
          "-y",
          outputPath,
        ],
        { timeout: 300_000 },
      );
    }

    const finalBuf = await readFile(outputPath);
    if (!isR2Configured()) {
      throw new Error("R2 is not configured — final cinematic video upload requires R2");
    }
    const safeName = `cinematic-${pipelineId}.mp4`;
    const upload = await uploadVideoToR2(finalBuf, safeName);
    if (!upload.success) {
      throw new Error(`Final video R2 upload failed: ${upload.error}`);
    }

    const totalDuration =
      segments.reduce((sum, s) => sum + s.durationSeconds, 0) -
      Math.max(0, (segments.length - 1) * XFADE_DURATION);
    logger.info(
      `[CINEMATIC][${pipelineId}] Stitched cinematic uploaded: ${upload.url} ` +
        `(${finalBuf.length} bytes, ${totalDuration.toFixed(1)}s visible)`,
    );

    return {
      finalUrl: upload.url,
      sizeBytes: finalBuf.length,
      durationSeconds: totalDuration,
    };
  } finally {
    for (const p of cleanup) {
      await unlink(p).catch(() => {});
    }
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Persist a Kling segment to R2 ───────────────────────────────────────────
//
// Kling video URLs expire (anywhere from a few hours to 24h depending on
// the model). For the cinematic pipeline we want every successful stage to
// be permanently available even if the user comes back the next day.

export async function persistKlingVideoToR2(args: {
  klingUrl: string;
  pipelineId: string;
  stage: string;
}): Promise<string> {
  const { klingUrl, pipelineId, stage } = args;
  if (!isR2Configured()) {
    // No R2 → return the raw Kling URL. The cinematic pipeline will still
    // work in this same session as long as the URL hasn't expired yet.
    logger.warn(
      `[CINEMATIC][${pipelineId}] R2 not configured, returning raw Kling URL for stage ${stage}`,
    );
    return klingUrl;
  }
  const res = await fetch(klingUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Failed to download Kling segment: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const upload = await uploadVideoToR2(buf, `cinematic-${pipelineId}-${stage}.mp4`);
  if (!upload.success) {
    throw new Error(`R2 upload of ${stage} segment failed: ${upload.error}`);
  }
  logger.info(
    `[CINEMATIC][${pipelineId}] ${stage} persisted to R2: ${upload.url} (${buf.length} bytes)`,
  );
  return upload.url;
}

// ─── Redis state helpers ─────────────────────────────────────────────────────

function pipelineKey(pipelineId: string): string {
  return `cinematic:${pipelineId}`;
}

/** Save (or overwrite) the pipeline state in Redis with a 24h TTL. */
export async function savePipelineState(state: CinematicPipelineState): Promise<void> {
  if (!redisConfigured) {
    // Dev fallback: still proceed, but warn loudly. The polling endpoint
    // will return "not found" if Redis isn't there.
    logger.warn(
      `[CINEMATIC][${state.pipelineId}] Redis not configured — pipeline state cannot persist`,
    );
    return;
  }
  await redis.set(pipelineKey(state.pipelineId), JSON.stringify(state), {
    ex: PIPELINE_TTL_SECONDS,
  });
}

/** Load a pipeline state from Redis. Returns null if missing/expired. */
export async function loadPipelineState(
  pipelineId: string,
): Promise<CinematicPipelineState | null> {
  if (!redisConfigured) return null;
  const raw = await redis.get<string | object>(pipelineKey(pipelineId));
  if (!raw) return null;
  try {
    if (typeof raw === "string") {
      return JSON.parse(raw) as CinematicPipelineState;
    }
    return raw as CinematicPipelineState;
  } catch (err) {
    logger.error(`[CINEMATIC][${pipelineId}] Failed to parse pipeline state:`, err);
    return null;
  }
}

/**
 * Acquire a per-pipeline mutex so only one polling caller advances the state
 * machine at a time. Returns true if the lock was acquired (caller may
 * proceed); false if another caller is already advancing.
 *
 * Uses Redis SET NX with a 90s TTL — long enough to cover stitching, short
 * enough that a crashed worker doesn't permanently lock the pipeline.
 */
export async function acquirePipelineLock(pipelineId: string): Promise<boolean> {
  if (!redisConfigured) return true; // No locking in dev — that's fine
  const lockKey = `cinematic:lock:${pipelineId}`;
  // Upstash redis SET supports NX + EX
  const result = await redis.set(lockKey, "1", { nx: true, ex: 90 });
  return result === "OK";
}

export async function releasePipelineLock(pipelineId: string): Promise<void> {
  if (!redisConfigured) return;
  await redis.del(`cinematic:lock:${pipelineId}`);
}

// ─── Pipeline status helpers ────────────────────────────────────────────────

/**
 * Compute the overall pipeline progress (0-100) from the per-stage state.
 * Used by the UI's main progress bar. Weights:
 *   overview   → 0-33%
 *   transition → 33-50%
 *   lifestyle  → 50-90%
 *   stitch     → 90-100%
 */
export function computeOverallProgress(state: CinematicPipelineState): number {
  const stageProgress = (s: CinematicStageState | CinematicStitchState): number => {
    switch (s.status) {
      case "complete":
        return 1.0;
      case "processing":
        return 0.6;
      case "submitted":
        return 0.25;
      case "preparing":
        return 0.1;
      case "failed":
        return 1.0; // counts as "done" for the bar so we don't get stuck
      default:
        return 0;
    }
  };

  const w = {
    overview: 0.33,
    transition: 0.17,
    lifestyle: 0.4,
    stitch: 0.1,
  };

  const pct =
    stageProgress(state.stages.overview) * w.overview +
    stageProgress(state.stages.transition) * w.transition +
    stageProgress(state.stages.lifestyle) * w.lifestyle +
    stageProgress(state.stages.stitch) * w.stitch;

  return Math.round(pct * 100);
}

/**
 * Decide the overall pipeline status from the per-stage state.
 *   • complete  → stitch is complete (final video ready)
 *   • partial   → stitch failed but at least one segment is available
 *   • failed    → every stage failed
 *   • processing → anything else
 */
export function deriveOverallStatus(
  state: CinematicPipelineState,
): CinematicPipelineStatus {
  const { overview, transition, lifestyle, stitch } = state.stages;
  if (stitch.status === "complete" && stitch.finalUrl) return "complete";

  const allFailed =
    overview.status === "failed" &&
    transition.status === "failed" &&
    lifestyle.status === "failed";
  if (allFailed) return "failed";

  // Partial = stitch attempted-and-failed, but at least one segment exists
  if (stitch.status === "failed") {
    const anyHas =
      !!overview.persistedUrl ||
      !!transition.persistedUrl ||
      !!lifestyle.persistedUrl;
    return anyHas ? "partial" : "failed";
  }
  return "processing";
}
