/**
 * GPT Image 1.5 provider — OpenAI image generation.
 * Uses the existing getClient() pattern from src/features/ai/services/openai.ts.
 */

import OpenAI from "openai";
import type { GeneratedImage } from "../types";
import { ImageGenError } from "./types";
import { OPENAI_IMAGE_MODEL } from "@/features/ai/services/image-generation";

export const MODEL_ID = OPENAI_IMAGE_MODEL;
export const COST_PER_IMAGE = 0.034; // $0.034 at 1024x1024, medium quality
const TIMEOUT_MS = 30_000;

function createClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ImageGenError("OPENAI_API_KEY not set", MODEL_ID, "auth");
  return new OpenAI({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 0 });
}

export async function generateImage(
  prompt: string,
  negativePrompt?: string,
): Promise<GeneratedImage> {
  const startMs = Date.now();
  const client = createClient();

  try {
    const fullPrompt = negativePrompt
      ? `${prompt}\n\nDo NOT include: ${negativePrompt}`
      : prompt;

    const response = await client.images.generate({
      model: MODEL_ID,
      prompt: fullPrompt,
      n: 1,
      size: "1024x1024",
      quality: "medium",
      output_format: "png",
    });

    const image = response.data?.[0];
    if (!image?.b64_json) {
      throw new ImageGenError(
        "GPT Image 1.5: no b64_json in response",
        MODEL_ID,
        "unknown",
      );
    }

    return {
      model: MODEL_ID,
      base64: image.b64_json,
      width: 1024,
      height: 1024,
      generationTimeMs: Date.now() - startMs,
    };
  } catch (err) {
    if (err instanceof ImageGenError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;

    let kind: ImageGenError["kind"] = "unknown";
    if (msg.includes("abort") || msg.includes("timeout")) kind = "timeout";
    else if (status === 429) kind = "rate_limit";
    else if (status === 401 || status === 403) kind = "auth";
    else if (
      msg.includes("content_policy") ||
      msg.includes("safety") ||
      msg.includes("rejected")
    )
      kind = "content_filter";

    throw new ImageGenError(`GPT Image 1.5: ${msg}`, MODEL_ID, kind, err);
  }
}
