/**
 * Imagen 4 Standard provider — Google dedicated image generation API.
 * Uses @google/genai SDK with generateImages() (dedicated endpoint).
 */

import { GoogleGenAI } from "@google/genai";
import type { GeneratedImage } from "../types";
import { ImageGenError } from "./types";

export const MODEL_ID = "imagen-4.0-generate-001";
export const COST_PER_IMAGE = 0.04;
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
    ? `${prompt}\n\nNegative: ${negativePrompt}`
    : prompt;

  try {
    const response = await Promise.race([
      client.models.generateImages({
        model: MODEL_ID,
        prompt: fullPrompt,
        config: {
          numberOfImages: 1,
          aspectRatio: "1:1",
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new ImageGenError("Imagen 4: timeout after 30s", MODEL_ID, "timeout")), TIMEOUT_MS),
      ),
    ]);

    const generated = response.generatedImages?.[0];
    if (!generated?.image?.imageBytes) {
      const raiReason = generated?.raiFilteredReason;
      if (raiReason) {
        throw new ImageGenError(
          `Imagen 4: content filter blocked (${raiReason})`,
          MODEL_ID,
          "content_filter",
        );
      }
      throw new ImageGenError(
        "Imagen 4: no imageBytes in response",
        MODEL_ID,
        "unknown",
      );
    }

    return {
      model: MODEL_ID,
      base64: generated.image.imageBytes,
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
      msg.includes("blocked") ||
      msg.includes("rai")
    )
      kind = "content_filter";

    throw new ImageGenError(`Imagen 4: ${msg}`, MODEL_ID, kind, err);
  }
}
