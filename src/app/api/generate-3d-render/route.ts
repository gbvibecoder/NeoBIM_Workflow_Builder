import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEndpointRateLimit, isAdminUser } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import { OPENAI_IMAGE_MODEL } from "@/features/ai/services/image-generation";
import OpenAI from "openai";
import { z } from "zod";
import { logger } from "@/lib/logger";

// ─── Floor Plan → 3D Photorealistic Render ──────────────────────────────────
// Pipeline: GPT-Image-1 images.edit — the model SEES the floor plan image
// directly, preserving exact room layout, proportions, and adjacencies.
// GPT-4o Vision extracts STRUCTURAL metadata (room count, room names, footprint,
// building type) used only for UI labels and downstream context — never
// injected into the image-generation prompt, to keep it neutral and
// geometry-first regardless of whether the plan is residential, commercial,
// or mixed-use.
// ─────────────────────────────────────────────────────────────────────────────

// ─── GPT-4o extracts STRUCTURAL metadata as JSON ─────────────────────────────
// JSON-only output is parsed downstream. No furniture, no materials, no
// residential assumptions — those biases leaked into the image prompt on the
// previous version and caused complex commercial plans to hallucinate as
// generic 2-bedroom apartments.
const ANALYSIS_PROMPT = `You are an architectural analyst. Look at this 2D floor plan and extract STRUCTURAL information only. Output EXACTLY this JSON object and nothing else — no prose, no markdown fences:

{"buildingType":"residential|commercial|mixed-use|industrial|other","roomCount":<integer>,"rooms":[<up to 8 room names as they appear in the drawing, using generic labels like "Room 1", "Bathroom", "Corridor" if the room is unlabeled>],"footprint":"rectangle|L-shape|U-shape|irregular","openingsVisible":<boolean>}

Rules:
- Do NOT invent rooms that are not clearly enclosed in the drawing.
- Do NOT guess furniture, materials, or finishes.
- Use the labels printed on the drawing when present; otherwise use a generic descriptor.
- roomCount must equal the length of the rooms array.`;

// ─── Render prompts ─────────────────────────────────────────────────────────
// Full-layout views use images.edit with high fidelity (model SEES the floor
// plan). Room-specific views generate zoomed-in interior renders of individual
// rooms.
//
// Neutral, geometry-first prompts: they never prescribe materials (no "oak",
// no "tile"), never assume building type, and never inject upstream text
// descriptions. The model's only job is to reproduce the input's walls,
// rooms, openings, and footprint photorealistically.
//
// The "FILL CANVAS" instruction is critical for slider alignment: when the
// route picks a non-square output size to match the floor plan ratio
// (1536×1024 landscape or 1024×1536 portrait), the image must fill the frame
// so the rendered building aligns with the 2D plan in the BEFORE/AFTER
// comparison.
const RENDER_PROMPTS: Record<string, string> = {
  topDown:
    "Photorealistic 3D top-down architectural render of the provided 2D floor plan. The result must EXACTLY match the input floor plan: same walls in the same positions, same room count, same room shapes, same openings, same overall footprint and proportions. Render realistic materials appropriate to each room's apparent function. Natural soft daylight. The render must fill the entire image canvas edge-to-edge with no borders, no whitespace, no margins, no centered framing. Roof removed. No text, no labels, no dimension lines, no annotations.",
  birdsEye:
    "Photorealistic 3D isometric bird's-eye cutaway render of the provided 2D floor plan at exactly 45 degrees, roof removed, showing every enclosed space simultaneously. The result must EXACTLY match the input floor plan: same walls in the same positions, same room count, same room shapes, same openings, same overall footprint and proportions. Render realistic materials appropriate to each room's apparent function. Natural soft daylight. Ultra-detailed architectural visualization. The render must fill the entire image canvas edge-to-edge with no borders, no whitespace, no margins. No text, no labels, no dimension lines, no annotations.",
};

// ─── Output size selection ──────────────────────────────────────────────────
// GPT-Image-1 only supports 3 output sizes for images.edit:
//   1024×1024 (square), 1536×1024 (landscape 3:2), 1024×1536 (portrait 2:3).
// We pick the closest match to the floor plan's aspect ratio so the rendered
// building visually aligns with the original 2D plan in the comparison slider.
type RenderSize = "1024x1024" | "1536x1024" | "1024x1536";

function pickRenderSize(width: number, height: number): RenderSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "1024x1024";
  }
  const ratio = width / height;
  // > 1.2 → clearly landscape, < 0.8 → clearly portrait, otherwise square
  if (ratio > 1.2) return "1536x1024";
  if (ratio < 0.8) return "1024x1536";
  return "1024x1024";
}

// Room-specific interior render prompt — ROOM_NAME gets replaced at call-site.
// No LAYOUT_DESC injection, no material prescriptions, no residential styling
// cues. The model sees the source image and must preserve the room's real
// shape and openings on its own.
const ROOM_INTERIOR_PROMPT =
  "Photorealistic eye-level interior photograph of the ROOM_NAME in the provided floor plan. " +
  "Camera at approximately 1.5 meters height, standing inside ROOM_NAME looking across the room. " +
  "Show ONLY this one room — do NOT show other rooms or the full layout. " +
  "The room's shape, walls, and openings must match the floor plan exactly. " +
  "Realistic materials and furnishings appropriate to the room's function. " +
  "Natural soft daylight. Professional architectural photography, sharp detail. " +
  "No text, no labels, no annotations.";

// ─── Structural analysis schema ──────────────────────────────────────────────
// GPT-4o's JSON output is validated and coerced through this schema. Every
// field has a `.catch()` default so a malformed model response still yields
// a usable object — the render continues, only the UI labels are weaker.
const StructuralAnalysisSchema = z.object({
  buildingType: z
    .enum(["residential", "commercial", "mixed-use", "industrial", "other"])
    .catch("other"),
  roomCount: z.number().int().nonnegative().max(64).catch(0),
  rooms: z.array(z.string().min(1).max(80)).max(12).catch([]),
  footprint: z
    .enum(["rectangle", "L-shape", "U-shape", "irregular"])
    .catch("irregular"),
  openingsVisible: z.boolean().catch(true),
});

type StructuralAnalysis = z.infer<typeof StructuralAnalysisSchema>;

const DEFAULT_STRUCTURAL: StructuralAnalysis = {
  buildingType: "other",
  roomCount: 0,
  rooms: [],
  footprint: "irregular",
  openingsVisible: true,
};

/**
 * Locate the first JSON object inside a raw GPT response. Handles ```json
 * fences``` and preamble prose that ignores our "no prose" instruction.
 */
function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) return fence[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return trimmed.slice(first, last + 1);
}

/** Parse + validate GPT-4o JSON. Never throws — falls back to defaults. */
function parseStructural(raw: string): StructuralAnalysis {
  const json = extractJsonObject(raw);
  if (!json) {
    logger.debug(
      "[generate-3d-render] No JSON object found in GPT-4o analysis response"
    );
    return DEFAULT_STRUCTURAL;
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(json);
  } catch (err) {
    logger.debug(
      `[generate-3d-render] GPT-4o JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return DEFAULT_STRUCTURAL;
  }
  const result = StructuralAnalysisSchema.safeParse(candidate);
  if (!result.success) {
    logger.debug(
      `[generate-3d-render] Structural schema rejected payload: ${result.error.message}`
    );
    return DEFAULT_STRUCTURAL;
  }
  // Keep roomCount consistent with the rooms array we actually kept.
  const rooms = result.data.rooms;
  return { ...result.data, roomCount: rooms.length > 0 ? rooms.length : result.data.roomCount };
}

/**
 * Short, neutral prose description derived from the structural JSON. Used as
 * `fullDescription` in the API response so the cinematic walkthrough pipeline
 * (which reads `description.slice(0, 600)`) keeps receiving a sensible string
 * without any residential bias from the previous prompt.
 */
function buildNeutralProse(s: StructuralAnalysis): string {
  const rooms = s.rooms.length > 0 ? s.rooms.join(", ") : "rooms not enumerated";
  return `Floor plan analysis — building type: ${s.buildingType}; footprint: ${s.footprint}; room count: ${s.roomCount}; rooms: ${rooms}.`;
}

// Retry helper for transient OpenAI rate limits (429) — does NOT retry billing/quota errors
async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 8000): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const apiErr = err as { error?: { code?: string } };
    // Don't retry billing/quota errors — those won't resolve by waiting
    const errCode = apiErr?.error?.code || "";
    const isBilling = msg.includes("quota") || msg.includes("billing") ||
                      msg.includes("insufficient") || msg.includes("hard_limit") ||
                      errCode === "insufficient_quota" || errCode === "billing_hard_limit_reached";
    if (isBilling) throw err;

    if (retries > 0 && (msg.includes("429") || msg.includes("rate") || msg.includes("Rate"))) {
      logger.debug(`[generate-3d-render] Rate limited, retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
      return withRetry(fn, retries - 1, delayMs * 1.5);
    }
    throw err;
  }
}

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
  try {
    // ── Auth ──
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        formatErrorResponse(UserErrors.UNAUTHORIZED),
        { status: 401 }
      );
    }

    const userRole = ((session.user as { role?: string }).role) || "FREE";
    const userEmail = session.user.email || "";
    const isAdmin = isAdminUser(userEmail) || userRole === "PLATFORM_ADMIN" || userRole === "TEAM_ADMIN";

    // ── Rate limit: 10 renders per minute ──
    if (!isAdmin) {
      const rl = await checkEndpointRateLimit(session.user.id, "generate-3d-render", 10, "1 m");
      if (!rl.success) {
        return NextResponse.json(
          { error: "Too many render requests. Please wait a moment and try again." },
          { status: 429 }
        );
      }
    }

    // ── Plan gate: 3D renders require Starter or above ──
    // FREE and MINI users are blocked entirely — this is a premium feature.
    if (!isAdmin && (userRole === "FREE" || userRole === "MINI")) {
      return NextResponse.json(
        { error: { title: "Upgrade required", message: "3D photorealistic renders are available on Starter and above. Upgrade to turn your floor plans into stunning 3D visuals!", code: "PLAN_001", action: "View Plans", actionUrl: "/dashboard/billing" } },
        { status: 403 }
      );
    }

    // ── API key check ──
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key not configured." },
        { status: 500 }
      );
    }

    // ── Parse request ──
    const formData = await req.formData();
    const imageFile = formData.get("image") as File | null;
    const angle = (formData.get("angle") as string) || "birdsEye";
    // The client caches the structural JSON from the first call so follow-up
    // calls (room interiors) can skip GPT-4o entirely. Room-interior renders
    // do not need the structural payload either — they only use ROOM_NAME in
    // the prompt — but we still accept + reuse it so the response stays
    // self-consistent across a render session.
    const cachedStructuralRaw = formData.get("cachedStructural");
    const cachedStructural =
      typeof cachedStructuralRaw === "string" && cachedStructuralRaw.length > 0
        ? cachedStructuralRaw
        : null;

    // Optional original-image dimensions sent by the client (read from
    // <img>.naturalWidth/Height on upload). Used to pick a non-square output
    // size so the slider BEFORE/AFTER align. Falls back to square if absent.
    const rawOriginalWidth = formData.get("originalWidth");
    const rawOriginalHeight = formData.get("originalHeight");
    const originalWidth = rawOriginalWidth ? parseInt(String(rawOriginalWidth), 10) : 0;
    const originalHeight = rawOriginalHeight ? parseInt(String(rawOriginalHeight), 10) : 0;

    if (!imageFile) {
      return NextResponse.json(
        { error: "No image file provided" },
        { status: 400 }
      );
    }

    if (imageFile.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Image must be under 10MB" },
        { status: 400 }
      );
    }

    // ── Convert image to base64 + File object for images.edit ──
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = imageFile.type || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    // Create a File object for GPT-Image-1 images.edit (it needs to SEE the floor plan)
    const imageBuffer = Buffer.from(arrayBuffer);
    const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
    const editImageFile = new File([imageBuffer], `floorplan.${ext}`, { type: mimeType });

    const client = new OpenAI({ apiKey });

    // ── Determine render type: room-specific interior vs full-layout ──
    const isRoomInterior = angle.startsWith("roomInterior:");
    const roomName = isRoomInterior ? angle.split(":")[1] : null;
    const layoutAngle = isRoomInterior ? null : angle;

    // ── STEP 1: Structural analysis (full-layout only) ──
    // Room-interior renders do not need structural data — their prompt only
    // uses ROOM_NAME, which the client already knows. Skipping GPT-4o here
    // cuts ~1-3 seconds and one vision call per room.
    //
    // For the full-layout call we either reuse a client-supplied cached
    // structural JSON or run GPT-4o with response_format=json_object. Every
    // parse failure falls through to DEFAULT_STRUCTURAL so the image render
    // still proceeds.
    let structural: StructuralAnalysis = DEFAULT_STRUCTURAL;

    if (!isRoomInterior) {
      if (cachedStructural) {
        structural = parseStructural(cachedStructural);
      } else {
        const analysis = await client.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: dataUrl, detail: "high" },
                },
                { type: "text", text: ANALYSIS_PROMPT },
              ],
            },
          ],
          max_tokens: 400,
          temperature: 0.1,
          response_format: { type: "json_object" },
        });

        const raw = analysis.choices[0]?.message?.content;
        if (!raw) {
          logger.debug(
            "[generate-3d-render] GPT-4o returned empty analysis — using defaults"
          );
        } else {
          structural = parseStructural(raw);
        }
      }
    }

    // ── STEP 2: Generate render ──
    let render;

    if (isRoomInterior && roomName) {
      // ── Room-specific interior: zoomed-in eye-level view of ONE room ──
      const roomPrompt = ROOM_INTERIOR_PROMPT.replace(/ROOM_NAME/g, roomName);

      render = await withRetry(() =>
        client.images.edit({
          model: OPENAI_IMAGE_MODEL,
          image: editImageFile,
          prompt: roomPrompt,
          size: "1024x1024",
          quality: "high",
          input_fidelity: "low",
        })
      );
    } else {
      // ── Full-layout view: top-down or bird's eye of entire floor plan ──
      // Prompts are intentionally static + neutral — no structural text is
      // injected here. The model sees the floor plan image and must preserve
      // its geometry from the image alone.
      const renderPrompt =
        RENDER_PROMPTS[layoutAngle || "topDown"] || RENDER_PROMPTS.topDown;

      // Pick the closest GPT-Image-1 size for the original floor plan ratio
      // so the rendered building visually aligns with the BEFORE in the
      // comparison slider. Square / landscape / portrait → matching output.
      const layoutSize = pickRenderSize(originalWidth, originalHeight);

      render = await withRetry(async () => {
        try {
          return await client.images.edit({
            model: OPENAI_IMAGE_MODEL,
            image: editImageFile,
            prompt: renderPrompt,
            size: layoutSize,
            quality: "high",
            input_fidelity: "high",
          });
        } catch {
          // Fallback: let the model choose the best size itself rather than
          // forcing 1024x1024 (which mangles rectangular plans).
          return await client.images.edit({
            model: OPENAI_IMAGE_MODEL,
            image: editImageFile,
            prompt: renderPrompt,
            size: "auto",
            quality: "high",
            input_fidelity: "high",
          });
        }
      });
    }

    const generatedImage = render.data?.[0]?.b64_json ?? render.data?.[0]?.url;
    if (!generatedImage) {
      return NextResponse.json(
        { error: "GPT-Image-1 did not return an image." },
        { status: 502 }
      );
    }

    // ── Return as data URL ──
    // images.edit may return b64_json or a URL depending on the response format
    const resultDataUrl = generatedImage.startsWith("data:")
      ? generatedImage
      : generatedImage.startsWith("http")
        ? generatedImage
        : `data:image/png;base64,${generatedImage}`;

    // Report the rendered size so the client can use it for slider alignment
    // (room interiors are always square; full-layout follows the picker).
    const renderedSize: RenderSize = isRoomInterior
      ? "1024x1024"
      : pickRenderSize(originalWidth, originalHeight);
    const [renderedWidth, renderedHeight] = renderedSize.split("x").map((n) => parseInt(n, 10));

    await recordToolExecution(session.user.id, "3d-render");

    // Neutral prose derived from the structural JSON — kept in the response
    // for backward compatibility with the cinematic walkthrough pipeline,
    // which reads `description.slice(0, 600)`. Room-interior calls skip the
    // structural analysis entirely, so they return the DEFAULT_STRUCTURAL
    // prose stub; that's fine because the client caches structural from the
    // first (full-layout) call and forwards it to the cinematic endpoint
    // itself.
    const fullDescription = buildNeutralProse(structural);

    return NextResponse.json({
      success: true,
      image: resultDataUrl,
      angle,
      description: fullDescription.substring(0, 500),
      fullDescription,
      structural, // { buildingType, roomCount, rooms, footprint, openingsVisible }
      renderedSize,
      renderedWidth,
      renderedHeight,
    });
  } catch (error: unknown) {
    console.error("[generate-3d-render] Full error:", JSON.stringify(error, Object.getOwnPropertyNames(error instanceof Error ? error : {}), 2));
    console.error("[generate-3d-render] Error object:", error);

    const message =
      error instanceof Error ? error.message : "Unknown error during 3D render generation";

    // Extract OpenAI API error details if available
    const apiError = (error as { status?: number; error?: { message?: string; type?: string; code?: string } });
    const apiStatus = apiError?.status;
    const apiMessage = apiError?.error?.message;
    const apiCode = apiError?.error?.code;
    const detailedError = apiMessage || message;

    console.error("[generate-3d-render] API status:", apiStatus, "code:", apiCode, "message:", apiMessage);

    // Billing/quota errors — these won't resolve by retrying
    const isBilling = detailedError.includes("quota") || detailedError.includes("billing") ||
                      detailedError.includes("exceeded") || detailedError.includes("insufficient") ||
                      apiCode === "insufficient_quota" || apiCode === "billing_hard_limit_reached";
    if (isBilling) {
      return NextResponse.json(
        {
          error: "OpenAI billing limit reached. Add credits or increase your spending limit at platform.openai.com/settings/organization/billing.",
          details: detailedError,
          code: apiCode,
        },
        { status: 402 }
      );
    }

    if (apiStatus === 429 || message.includes("429") || message.includes("rate")) {
      return NextResponse.json(
        {
          error: `Rate limited by OpenAI. Please wait a moment and try again. Details: ${detailedError}`,
          details: detailedError,
          code: apiCode,
        },
        { status: 429 }
      );
    }
    if (message.includes("API key") || message.includes("401") || apiStatus === 401) {
      return NextResponse.json(
        { error: "Invalid OpenAI API key.", details: detailedError },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: detailedError },
      { status: 500 }
    );
  }
}
