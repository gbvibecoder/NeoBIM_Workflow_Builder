/**
 * Canonical OpenAI image-generation utilities.
 *
 * Every image-producing call site in this codebase MUST import OPENAI_IMAGE_MODEL
 * from here. Direct string literals like "gpt-image-1" or "dall-e-3" are forbidden
 * and enforced by scripts/check-no-deprecated-image-models.sh.
 *
 * Architectural rule: when a reference image / sketch / floor plan / photo is
 * available at the call site, it MUST be passed via images.edit() with
 * input_fidelity tuned for the use case — never described in text and submitted
 * to images.generate(). Generic output is the failure mode this rule prevents.
 */

type SupportedImageModel = "gpt-image-1.5" | "gpt-image-1";

const DEFAULT_MODEL: SupportedImageModel = "gpt-image-1.5";
const ALLOWED_OVERRIDES: ReadonlySet<SupportedImageModel> = new Set<SupportedImageModel>([
  "gpt-image-1.5",
  "gpt-image-1",
]);

function resolveImageModel(): SupportedImageModel {
  const override = process.env.IMAGE_MODEL_OVERRIDE;
  if (override && ALLOWED_OVERRIDES.has(override as SupportedImageModel)) {
    if (override !== DEFAULT_MODEL) {
      // Permanent escape hatch — logs whenever it's flipped to a non-default model
      // so the override never silently controls production.
      console.warn(
        `[image-gen] OVERRIDE ACTIVE: using ${override} instead of ${DEFAULT_MODEL}`,
      );
    }
    return override as SupportedImageModel;
  }
  if (override) {
    console.warn(
      `[image-gen] IMAGE_MODEL_OVERRIDE="${override}" is not a supported value; falling back to ${DEFAULT_MODEL}`,
    );
  }
  return DEFAULT_MODEL;
}

export const OPENAI_IMAGE_MODEL: SupportedImageModel = resolveImageModel();

/**
 * Normalize an OpenAI images.* response to a usable URL.
 *
 * Handles both URL responses (legacy DALL-E behavior, no longer used but kept
 * for compatibility) and b64_json responses (gpt-image-1.x always returns these).
 * When only b64 is present, uploads to R2 if configured; otherwise returns a
 * data URI.
 */
export async function normalizeImageResponse(
  image:
    | { url?: string; b64_json?: string; revised_prompt?: string }
    | undefined,
  filenamePrefix: string,
): Promise<{ url: string; revisedPrompt: string }> {
  if (!image) throw new Error("No image data in response");

  if (image.url) {
    return { url: image.url, revisedPrompt: image.revised_prompt ?? "" };
  }

  if (image.b64_json) {
    let resultUrl = "";
    try {
      const { uploadToR2, isR2Configured } = await import("@/lib/r2");
      if (isR2Configured()) {
        const buffer = Buffer.from(image.b64_json, "base64");
        const upload = await uploadToR2(
          buffer,
          `${filenamePrefix}-${Date.now()}.png`,
          "image/png",
        );
        if (upload.success) resultUrl = upload.url;
      }
    } catch {
      // R2 errors are non-fatal — fall back to data URI below
    }
    if (!resultUrl) resultUrl = `data:image/png;base64,${image.b64_json}`;
    return { url: resultUrl, revisedPrompt: image.revised_prompt ?? "" };
  }

  throw new Error("No image data in response (neither url nor b64_json)");
}

/**
 * Fetch an HTTP URL and return as a base64 data URL.
 * Used by callers that need an inlined image (e.g., GN-011 Three.js scene).
 */
export async function fetchAsDataUrl(
  url: string,
  mimeType: string = "image/png",
): Promise<string> {
  if (url.startsWith("data:")) return url;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
