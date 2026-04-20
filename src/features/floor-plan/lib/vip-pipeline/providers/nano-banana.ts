/**
 * Nano Banana Pro provider — Gemini 3 Pro multimodal image generation.
 * Uses @google/genai SDK with generateContent() + responseModalities: ["image"].
 */

import { GoogleGenAI } from "@google/genai";
import type { GeneratedImage } from "../types";
import { ImageGenError } from "./types";

export const MODEL_ID = "gemini-3-pro-image-preview";
export const COST_PER_IMAGE = 0.134;
const TIMEOUT_MS = 30_000;

function createClient(): GoogleGenAI {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key)
    throw new ImageGenError("GOOGLE_AI_API_KEY not set", MODEL_ID, "auth");
  return new GoogleGenAI({ apiKey: key });
}

export async function generateImage(
  prompt: string,
  negativePrompt?: string,
): Promise<GeneratedImage> {
  const startMs = Date.now();
  const client = createClient();

  const fullPrompt = negativePrompt
    ? `${prompt}\n\nAvoid: ${negativePrompt}`
    : prompt;

  try {
    const response = await Promise.race([
      client.models.generateContent({
        model: MODEL_ID,
        contents: fullPrompt,
        config: {
          responseModalities: ["image"],
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new ImageGenError("Nano Banana: timeout after 30s", MODEL_ID, "timeout")), TIMEOUT_MS),
      ),
    ]);

    // Walk candidates[0].content.parts[] to find inlineData with image
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === "SAFETY" || finishReason === "IMAGE_SAFETY") {
        throw new ImageGenError(
          `Nano Banana: content filter blocked (${finishReason})`,
          MODEL_ID,
          "content_filter",
        );
      }
      throw new ImageGenError(
        "Nano Banana: no parts in response",
        MODEL_ID,
        "unknown",
      );
    }

    const imagePart = parts.find(
      (p) => p.inlineData?.data && p.inlineData.mimeType?.startsWith("image/"),
    );
    if (!imagePart?.inlineData?.data) {
      throw new ImageGenError(
        "Nano Banana: no inlineData image in response parts",
        MODEL_ID,
        "unknown",
      );
    }

    return {
      model: MODEL_ID,
      base64: imagePart.inlineData.data,
      width: 1024,
      height: 1024,
      generationTimeMs: Date.now() - startMs,
    };
  } catch (err) {
    if (err instanceof ImageGenError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;

    let kind: ImageGenError["kind"] = "unknown";
    if (msg.includes("abort") || msg.includes("timeout") || msg.includes("ABORT"))
      kind = "timeout";
    else if (status === 429) kind = "rate_limit";
    else if (status === 401 || status === 403) kind = "auth";
    else if (
      msg.includes("SAFETY") ||
      msg.includes("safety") ||
      msg.includes("blocked")
    )
      kind = "content_filter";

    throw new ImageGenError(`Nano Banana: ${msg}`, MODEL_ID, kind, err);
  }
}
