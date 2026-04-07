import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkEndpointRateLimit } from "@/lib/rate-limit";
import { formatErrorResponse, UserErrors } from "@/lib/user-errors";
import OpenAI from "openai";

// ─── Floor Plan → 3D Photorealistic Render ──────────────────────────────────
// Pipeline: GPT-Image-1 images.edit — the model SEES the floor plan image
// directly, preserving exact room layout, proportions, and adjacencies.
// GPT-4o Vision provides a short room description for furniture/material detail.
// ─────────────────────────────────────────────────────────────────────────────

// ─── GPT-4o extracts room names + furniture for the render prompt ───────────
const ANALYSIS_PROMPT = `You are an expert architectural analyst. Look at this 2D floor plan and list:

1. Every room name and its approximate dimensions
2. What furniture belongs in each room (be specific: "king bed centered, 2 nightstands, wardrobe on east wall")
3. Flooring type per room (hardwood for living/bedrooms, tile for kitchen/bath)
4. Door and window positions per room

Keep it SHORT — under 800 words. Focus on room names, furniture, and materials. Do NOT describe room positions/layout — the image itself will handle spatial accuracy.`;

// ─── Render prompts ─────────────────────────────────────────────────────────
// Full-layout views use images.edit with high fidelity (model SEES the floor plan).
// Room-specific views generate zoomed-in interior renders of individual rooms.
//
// The "FILL CANVAS" instruction is critical for slider alignment: when the
// route picks a non-square output size to match the floor plan ratio
// (1536×1024 landscape or 1024×1536 portrait), we need GPT-Image-1 to fill
// the entire frame edge-to-edge so the rendered building lines up with the
// 2D floor plan in the BEFORE/AFTER comparison.
const RENDER_PROMPTS: Record<string, string> = {
  topDown:
    "Transform this 2D floor plan into a photorealistic 3D top-down view from directly above with roof removed. LAYOUT_DESC. CRITICAL: This must be the original floor plan brought to life in 3D — SAME room positions, SAME proportions, SAME wall positions, SAME adjacencies. The 3D render MUST FILL THE ENTIRE IMAGE CANVAS edge-to-edge — no empty borders, no whitespace, no margins, no centered framing. The complete floor plan should occupy the FULL frame at the same proportions as the source image. Realistic furniture, flooring textures, proper shadows. Professional interior design rendering.",
  birdsEye:
    "Transform this 2D floor plan into a photorealistic 3D isometric bird's-eye cutaway view at exactly 45 degrees with the roof removed, showing ALL rooms simultaneously. LAYOUT_DESC. CRITICAL: Preserve the EXACT room arrangement, sizes, proportions, and wall positions from the floor plan — do NOT move, resize, add, or remove any room. The 3D render MUST FILL THE ENTIRE IMAGE CANVAS edge-to-edge — no empty borders, no whitespace, no margins. Realistic furniture as described, warm oak flooring in living areas, tile in bathrooms/kitchen, warm natural lighting. Include room name labels. Ultra-detailed architectural rendering.",
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

// Room-specific interior render prompt — ROOM_NAME and LAYOUT_DESC get replaced
const ROOM_INTERIOR_PROMPT =
  "Photorealistic 3D interior photograph of ONLY the ROOM_NAME from this floor plan. " +
  "Camera at eye level (1.5m height), standing inside the ROOM_NAME looking across the room. " +
  "Show ONLY this one room — do NOT show other rooms or the full layout. " +
  "LAYOUT_DESC. " +
  "Realistic materials, warm natural lighting from windows, modern furniture exactly as described for this room. " +
  "The room dimensions and shape must match the floor plan. " +
  "Professional interior design photography, sharp detail, 8K quality. No text or labels.";

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
      console.log(`[generate-3d-render] Rate limited, retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
      return withRetry(fn, retries - 1, delayMs * 1.5);
    }
    throw err;
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

    // ── Rate limit: 10 renders per minute ──
    const rl = await checkEndpointRateLimit(session.user.id, "generate-3d-render", 10, "1 m");
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many render requests. Please wait a moment and try again." },
        { status: 429 }
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
    const cachedDescription = (formData.get("cachedDescription") as string) || null;

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

    // ── STEP 1: GPT-4o Vision extracts room names + furniture details ──
    // If the frontend already has a cached description from a prior call, skip GPT-4o.
    // This avoids 4x redundant GPT-4o calls when rendering all views.
    let roomDescription: string;

    if (cachedDescription) {
      roomDescription = cachedDescription;
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
        max_tokens: 1200,
        temperature: 0.1,
      });

      const desc = analysis.choices[0]?.message?.content;
      if (!desc) {
        return NextResponse.json(
          { error: "Failed to analyze floor plan. GPT-4o returned no description." },
          { status: 502 }
        );
      }
      roomDescription = desc;
    }

    // ── STEP 2: Generate render ──
    let render;

    if (isRoomInterior && roomName) {
      // ── Room-specific interior: zoomed-in eye-level view of ONE room ──
      const roomPrompt = ROOM_INTERIOR_PROMPT
        .replace(/ROOM_NAME/g, roomName)
        .replace("LAYOUT_DESC", roomDescription.substring(0, 2000));

      render = await withRetry(() =>
        client.images.edit({
          model: "gpt-image-1",
          image: editImageFile,
          prompt: roomPrompt,
          size: "1024x1024",
          quality: "high",
          input_fidelity: "low",
        })
      );
    } else {
      // ── Full-layout view: top-down or bird's eye of entire floor plan ──
      const renderTemplate = RENDER_PROMPTS[layoutAngle || "topDown"] || RENDER_PROMPTS.topDown;
      const renderPrompt = renderTemplate.replace("LAYOUT_DESC", roomDescription.substring(0, 2000));

      // Pick the closest GPT-Image-1 size for the original floor plan ratio
      // so the rendered building visually aligns with the BEFORE in the
      // comparison slider. Square / landscape / portrait → matching output.
      const layoutSize = pickRenderSize(originalWidth, originalHeight);

      render = await withRetry(async () => {
        try {
          return await client.images.edit({
            model: "gpt-image-1",
            image: editImageFile,
            prompt: renderPrompt,
            size: layoutSize,
            quality: "high",
            input_fidelity: "high",
          });
        } catch {
          // Fallback to square if the model rejects the non-square request
          return await client.images.edit({
            model: "gpt-image-1",
            image: editImageFile,
            prompt: renderPrompt,
            size: "1024x1024",
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

    return NextResponse.json({
      success: true,
      image: resultDataUrl,
      angle,
      description: roomDescription.substring(0, 500),
      fullDescription: roomDescription, // Frontend caches this to avoid redundant GPT-4o calls
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
