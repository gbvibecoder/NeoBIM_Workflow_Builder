/**
 * Shared Kling HTTP client — JWT auth, fetch wrapper, retry loop.
 *
 * Extracted from video-service.ts (legacy) and cinematic-pipeline.ts (parallel
 * implementation) so both sites consume the same code. The cinematic pipeline
 * is out of scope for this phase (see FORBIDDEN files in the migration prompt),
 * so for now ONLY video-service.ts imports from here. A follow-up phase will
 * point cinematic-pipeline.ts at this module too.
 *
 * Public surface:
 *   • generateKlingJwt()   — HS256 JWT signer
 *   • klingFetch(path, init) — authed fetch with opt-in 1303 retry loop
 *   • Constants: KLING_BASE_URL, KLING_IMAGE2VIDEO_PATH, KLING_TEXT2VIDEO_PATH,
 *                KLING_OMNI_PATH, MODELS, JWT_EXPIRY_SECONDS, COST_PER_SECOND
 *   • Types: KlingTaskResponse, VideoServiceError
 *
 * Design rule: this module has ZERO knowledge of prompts, segments, pipelines,
 * or business logic. It is the narrowest wire-level adapter around Kling's
 * HTTP API.
 */

import crypto from "crypto";
import { logger } from "@/lib/logger";

// ─── Configuration ──────────────────────────────────────────────────────────

export const KLING_BASE_URL = "https://api.klingai.com";
export const KLING_IMAGE2VIDEO_PATH = "/v1/videos/image2video";
export const KLING_TEXT2VIDEO_PATH = "/v1/videos/text2video";
export const KLING_OMNI_PATH = "/v1/videos/omni-video";

export const COST_PER_SECOND = 0.10;
export const JWT_EXPIRY_SECONDS = 1800;

/** Models tried in priority order. v2-1-master = highest quality, v2-6 fallback. */
export const MODELS = ["kling-v2-1-master", "kling-v2-6"] as const;
export type KlingModel = (typeof MODELS)[number];

/** 1303 = parallel-task-slot exhausted. Backoff + retry constants. */
const KLING_1303_RETRY_DELAY_MS = 30_000;
const KLING_1303_MAX_RETRIES = 3;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KlingTaskResponse {
  code: number;
  message: string;
  request_id: string;
  data: {
    task_id: string;
    task_status: "submitted" | "processing" | "succeed" | "failed";
    task_status_msg?: string;
    task_result?: {
      /** image2video / text2video shape */
      videos?: Array<{ id: string; url: string; duration: string }>;
      /** omni-video shape (some Kling 3.0 Omni responses use this) */
      works?: Array<{
        resource?: {
          resource?: string;
          width?: number;
          height?: number;
          duration?: string;
        };
      }>;
    };
  };
}

export class VideoServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public retryable: boolean,
  ) {
    super(message);
    this.name = "VideoServiceError";
  }
}

// ─── JWT ────────────────────────────────────────────────────────────────────

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateKlingJwt(): string {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new VideoServiceError(
      "KLING_ACCESS_KEY and KLING_SECRET_KEY environment variables are required",
      500,
      false,
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

  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

// ─── fetch wrapper ──────────────────────────────────────────────────────────

export interface KlingFetchOptions {
  method: "GET" | "POST";
  body?: unknown;
  /**
   * When true, the 1303 (parallel slot exhausted) backoff loop runs (30s × 3
   * attempts). When false, 1303 is surfaced immediately so callers can fall
   * through to an alternate model without wasting wall-clock time.
   *
   * Default: true — preserves the pre-extraction behavior.
   */
  retryOn1303?: boolean;
}

/**
 * Perform a signed request to Kling. Handles:
 *   • JWT minting per call (cheap — avoids expiry races)
 *   • HTTP 2xx → JSON parse
 *   • Kling code === 0 → return; code !== 0 → throw
 *   • 1303 opt-in retry backoff
 *   • 1102 ("balance empty") → friendly error
 */
export async function klingFetch(
  path: string,
  options: KlingFetchOptions,
): Promise<KlingTaskResponse> {
  const retryOn1303 = options.retryOn1303 !== false; // default true
  const maxAttempts = retryOn1303 ? KLING_1303_MAX_RETRIES : 0;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
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
        const errData = (await res.json()) as { code?: number; message?: string };
        errorCode = errData?.code;
        if (errData?.code === 1102) {
          errorMessage =
            "Kling account balance is empty — please top up your Kling AI account at klingai.com to generate professional videos";
        } else if (errData?.message) {
          errorMessage = `Kling API error: ${errData.message} (code ${errData.code})`;
        }
      } catch {
        const text = await res.text().catch(() => "Unknown error");
        errorMessage = `Kling API HTTP ${res.status}: ${text.slice(0, 300)}`;
      }

      if (errorCode === 1303 && retryOn1303 && attempt < maxAttempts) {
        logger.warn(
          `[KLING] Rate limited (1303), waiting 30s before retry... (attempt ${attempt + 1}/${maxAttempts})`,
        );
        await new Promise((r) => setTimeout(r, KLING_1303_RETRY_DELAY_MS));
        continue;
      }

      logger.error("[KLING] HTTP error", {
        status: res.status,
        path,
        errorMessage,
      });
      throw new VideoServiceError(errorMessage, res.status, res.status >= 500);
    }

    const data = (await res.json()) as KlingTaskResponse;

    if (data.code !== 0) {
      if (data.code === 1303 && retryOn1303 && attempt < maxAttempts) {
        logger.warn(
          `[KLING] Rate limited (1303) via code, waiting 30s... (attempt ${attempt + 1}/${maxAttempts})`,
        );
        await new Promise((r) => setTimeout(r, KLING_1303_RETRY_DELAY_MS));
        continue;
      }

      logger.error("[KLING] code != 0", {
        code: data.code,
        message: data.message,
        requestId: data.request_id,
      });
      const msg =
        data.code === 1102
          ? "Kling account balance is empty — please top up your Kling AI account at klingai.com"
          : `Kling API error: ${data.message} (code ${data.code})`;
      throw new VideoServiceError(msg, 400, false);
    }

    return data;
  }

  throw new VideoServiceError(
    "Kling API: max 1303 retries exceeded",
    429,
    true,
  );
}

/**
 * Extract a playable video URL from a Kling task response, handling both the
 * `videos[]` and `works[].resource.resource` response shapes.
 *
 * Fixes the latent bug (audit Issue #7) where the Omni endpoint may return
 * the Kling 3.0 `works` shape and the naive reader silently returned null.
 */
export function extractKlingVideoUrl(
  result: KlingTaskResponse,
): string | null {
  const videosUrl = result.data.task_result?.videos?.[0]?.url;
  if (videosUrl) return videosUrl;
  const worksUrl = result.data.task_result?.works?.[0]?.resource?.resource;
  return worksUrl ?? null;
}
