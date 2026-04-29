/**
 * gpt-image-1.5 provider for the Brief-to-Renders pipeline.
 *
 * Mirrors `src/features/floor-plan/lib/vip-pipeline/providers/gpt-image.ts`
 * (the canonical pattern in this codebase) but adapted for Phase 4's
 * needs:
 *
 *   • Reference-image first: when the brief has embedded references
 *     (sketches, mood boards, plans), call `images.edit()` with
 *     `input_fidelity: "high"` so the renders honour the source's
 *     visual anchors (per CLAUDE.md's architectural rule and the
 *     execution-plan's strict-faithfulness contract).
 *   • Aspect ratio comes from the source brief — `"3:2"`, `"2:3"`,
 *     `"1:1"`, with `"16:9"` and `"9:16"` accepted as aliases for the
 *     closest supported landscape / portrait size. Anything else
 *     throws `UnsupportedAspectRatioError`.
 *   • `OPENAI_IMAGE_MODEL` is imported from the canonical module —
 *     no model literals here. The lint guard at
 *     `scripts/check-no-deprecated-image-models.sh` enforces this.
 *   • Hard timeout via `AbortSignal.timeout(120_000)` — high quality
 *     landscape renders can hit 60-90 s, leaving 30-60 s headroom.
 *
 * Cost constants are documented inline. They reflect public OpenAI
 * pricing for `gpt-image-1.5` at high quality as of 2026-04-28; verify
 * before shipping when the model bumps.
 */

import OpenAI, { toFile } from "openai";

import { OPENAI_IMAGE_MODEL } from "@/features/ai/services/image-generation";

// ─── Hard limits ────────────────────────────────────────────────────

/** AbortSignal timeout for a single image generation call. */
const GPT_IMAGE_TIMEOUT_MS = 120_000;

/** Cap on number of reference images fetched and passed to images.edit(). */
const MAX_REFERENCE_IMAGES = 4;

// ─── Cost table ────────────────────────────────────────────────────
//
// gpt-image-1.5 high-quality public pricing (2026-04-28):
//   • 1024x1024 → $0.19
//   • 1024x1536 → $0.25
//   • 1536x1024 → $0.25
//
// VIP's `stage-2-images.ts` only documents the medium-quality 1024 cost
// ($0.034). Phase 4 ships at high quality with non-square sizes, so we
// own a fresh constant table here. Verify against OpenAI's dashboard
// quarterly — Phase 5's cost-audit section in PHASE_5_REPORT will
// re-validate.
export const GPT_IMAGE_15_HIGH_COST_USD: Record<SupportedSize, number> = {
  "1024x1024": 0.19,
  "1024x1536": 0.25,
  "1536x1024": 0.25,
};

// ─── Public types ───────────────────────────────────────────────────

export type SupportedSize = "1024x1024" | "1024x1536" | "1536x1024";
/**
 * Per the OpenAI SDK v6 type definitions, `input_fidelity` accepts only
 * `"low" | "high"` for `images.edit()`. Phase 4 hard-codes `"high"`
 * everywhere for the strict-faithfulness contract; the parameter is
 * kept on the public API so Phase 6 can A/B if needed.
 */
export type InputFidelity = "low" | "high";

export interface GenerateShotImageArgs {
  /** S2-assembled prompt body. */
  prompt: string;
  /** Aspect ratio as stored on `ShotResult.aspectRatio` (e.g. `"3:2"`). */
  aspectRatio: string;
  /**
   * R2 URLs for the brief's reference images. When non-empty, we use
   * `images.edit()` with these as anchors. Capped at MAX_REFERENCE_IMAGES.
   */
  referenceImageUrls: string[];
  /** Phase 4 hard-codes "high" but exposes for Phase 6 A/B testing. */
  inputFidelity: InputFidelity;
  /**
   * Pipeline-derived idempotency key (`{jobId}:{ai}:{si}`) — surfaced
   * to OpenAI as the user metadata field for traceability.
   */
  requestId: string;
}

export interface GenerateShotImageResult {
  /** Base64-encoded PNG body (no data: prefix). */
  imageBase64: string;
  /** Computed dollars based on size + quality + cost table. */
  costUsd: number;
  widthPx: number;
  heightPx: number;
  openaiRequestId: string | null;
}

// ─── Typed errors ──────────────────────────────────────────────────

export class UnsupportedAspectRatioError extends Error {
  readonly code = "UNSUPPORTED_ASPECT_RATIO";
  readonly userMessage =
    "The shot's aspect ratio is not supported by the image generator.";
  constructor(readonly aspectRatio: string) {
    super(`Unsupported aspect ratio "${aspectRatio}".`);
    this.name = "UnsupportedAspectRatioError";
  }
}

export class ImageGenRateLimitError extends Error {
  readonly code = "IMAGE_GEN_RATE_LIMITED";
  readonly userMessage =
    "The image generator is rate-limiting requests. Will retry.";
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ImageGenRateLimitError";
  }
}

export class ImageGenProviderError extends Error {
  readonly code = "IMAGE_GEN_PROVIDER_ERROR";
  readonly userMessage =
    "The image generator returned an error. The shot will be marked failed.";
  constructor(
    message: string,
    readonly kind: "auth" | "content_filter" | "timeout" | "unknown",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ImageGenProviderError";
  }
}

// ─── Aspect-ratio normalisation ────────────────────────────────────

/**
 * Map a Phase 3 aspect-ratio string onto the size gpt-image-1.5 supports.
 *
 * Accepted: 3:2, 2:3, 1:1, 16:9, 9:16. Anything else throws.
 */
export function normalizeAspectRatio(aspectRatio: string): SupportedSize {
  const trimmed = aspectRatio.trim();
  switch (trimmed) {
    case "1:1":
      return "1024x1024";
    case "3:2":
    case "16:9":
      return "1536x1024";
    case "2:3":
    case "9:16":
      return "1024x1536";
    default:
      throw new UnsupportedAspectRatioError(aspectRatio);
  }
}

function dimensionsFromSize(size: SupportedSize): { widthPx: number; heightPx: number } {
  const [w, h] = size.split("x").map((n) => Number.parseInt(n, 10));
  return { widthPx: w, heightPx: h };
}

// ─── Client factory ────────────────────────────────────────────────

function createClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new ImageGenProviderError("OPENAI_API_KEY not set", "auth");
  }
  return new OpenAI({ apiKey: key, timeout: GPT_IMAGE_TIMEOUT_MS, maxRetries: 0 });
}

// ─── Reference-image fetcher ───────────────────────────────────────

async function fetchReferenceFiles(
  urls: string[],
  signal: AbortSignal,
): Promise<File[]> {
  const limit = urls.slice(0, MAX_REFERENCE_IMAGES);
  const files: File[] = [];
  for (let i = 0; i < limit.length; i++) {
    const url = limit[i];
    const res = await fetch(url, { signal });
    if (!res.ok) {
      // One bad ref shouldn't fail the whole shot — skip and continue.
      // Image gen still works (just with fewer anchors).
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = guessExtensionFromUrl(url);
    const file = await toFile(buffer, `ref-${i}.${ext}`);
    files.push(file);
  }
  return files;
}

function guessExtensionFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".webp")) return "webp";
  return "png";
}

// ─── Main entry point ──────────────────────────────────────────────

export async function generateShotImage(
  args: GenerateShotImageArgs,
): Promise<GenerateShotImageResult> {
  const size = normalizeAspectRatio(args.aspectRatio);
  const { widthPx, heightPx } = dimensionsFromSize(size);
  const costUsd = GPT_IMAGE_15_HIGH_COST_USD[size];

  const client = createClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GPT_IMAGE_TIMEOUT_MS);

  try {
    let response;

    if (args.referenceImageUrls.length > 0) {
      // images.edit() path — strict-faithfulness anchored on brief refs.
      const referenceFiles = await fetchReferenceFiles(
        args.referenceImageUrls,
        controller.signal,
      );

      if (referenceFiles.length > 0) {
        response = await client.images.edit(
          {
            model: OPENAI_IMAGE_MODEL,
            image: referenceFiles,
            prompt: args.prompt,
            n: 1,
            size,
            quality: "high",
            input_fidelity: args.inputFidelity,
            user: args.requestId,
          },
          { signal: controller.signal },
        );
      } else {
        // Every ref fetch failed — fall back to generate() so the shot
        // still produces output. Phase 5 cost audit may surface this as
        // a quality regression to investigate.
        response = await client.images.generate(
          {
            model: OPENAI_IMAGE_MODEL,
            prompt: args.prompt,
            n: 1,
            size,
            quality: "high",
            output_format: "png",
            user: args.requestId,
          },
          { signal: controller.signal },
        );
      }
    } else {
      // No brief reference images (rare for our use case — most briefs
      // have at least one site photo or sketch). Use generate() and
      // accept the slight quality drop.
      response = await client.images.generate(
        {
          model: OPENAI_IMAGE_MODEL,
          prompt: args.prompt,
          n: 1,
          size,
          quality: "high",
          output_format: "png",
          user: args.requestId,
        },
        { signal: controller.signal },
      );
    }

    const image = response.data?.[0];
    if (!image?.b64_json) {
      throw new ImageGenProviderError(
        "OpenAI returned no b64_json in response",
        "unknown",
      );
    }

    return {
      imageBase64: image.b64_json,
      costUsd,
      widthPx,
      heightPx,
      openaiRequestId: getOpenaiRequestId(response),
    };
  } catch (err) {
    if (err instanceof UnsupportedAspectRatioError) throw err;
    if (err instanceof ImageGenRateLimitError) throw err;
    if (err instanceof ImageGenProviderError) throw err;

    const status = (err as { status?: number }).status;
    const message = err instanceof Error ? err.message : String(err);

    if (status === 429) {
      throw new ImageGenRateLimitError(
        `OpenAI rate-limited (429): ${message}`,
        err,
      );
    }
    if (status === 401 || status === 403) {
      throw new ImageGenProviderError(
        `OpenAI auth (${status}): ${message}`,
        "auth",
        err,
      );
    }
    if (
      message.includes("content_policy") ||
      message.includes("safety") ||
      message.includes("rejected")
    ) {
      throw new ImageGenProviderError(
        `OpenAI content filter: ${message}`,
        "content_filter",
        err,
      );
    }
    if (
      message.includes("abort") ||
      message.includes("timeout") ||
      (err as { name?: string }).name === "AbortError"
    ) {
      throw new ImageGenProviderError(
        `OpenAI timeout: ${message}`,
        "timeout",
        err,
      );
    }
    throw new ImageGenProviderError(
      `OpenAI unknown error: ${message}`,
      "unknown",
      err,
    );
  } finally {
    clearTimeout(timer);
  }
}

function getOpenaiRequestId(response: unknown): string | null {
  if (typeof response !== "object" || response === null) return null;
  const v = (response as { _request_id?: unknown })._request_id;
  return typeof v === "string" ? v : null;
}
