/**
 * SAM 3D Service — Meta's image-to-3D model via fal.ai hosted API.
 * Converts building images into GLB/PLY 3D models.
 */

import { fal } from "@fal-ai/client";
import type {
  Sam3dApiResponse,
  Sam3dConversionJob,
} from "@/types/sam3d";
import { generateId } from "@/lib/utils";

// ─── Configuration ──────────────────────────────────────────────────────────

const FAL_ENDPOINT = "fal-ai/sam-3/3d-objects";
const COST_PER_GENERATION = 0.02;
const FILE_RETENTION_DAYS = 7;
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes — 3D generation can take up to 30s+

// Simple in-memory cache: imageUrl → job result
const jobCache = new Map<string, Sam3dConversionJob>();

// Concurrency tracking (fal.ai free tier = 2 concurrent)
let activeRequests = 0;
const MAX_CONCURRENT = 2;

// ─── Initialization ─────────────────────────────────────────────────────────

function ensureFalKey(): void {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY environment variable is not configured");
  }
  fal.config({ credentials: key });
}

// ─── Error Handling ─────────────────────────────────────────────────────────

class Sam3dError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public retryable: boolean
  ) {
    super(message);
    this.name = "Sam3dError";
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const err = error as Record<string, unknown> | null;
      const status = typeof err?.status === "number" ? err.status : 0;

      // Don't retry client errors (422, 400, etc.)
      if (status >= 400 && status < 500) {
        throw error;
      }

      // Exponential backoff for 5xx errors
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Convert a building image to a 3D model via SAM 3D.
 * Returns GLB and optional PLY download URLs.
 */
export async function convertImageTo3D(
  imageUrl: string,
  options?: { seed?: number; textPrompt?: string }
): Promise<Sam3dConversionJob> {
  ensureFalKey();

  // Check cache first
  const cacheKey = `${imageUrl}:${options?.seed ?? "default"}`;
  const cached = jobCache.get(cacheKey);
  if (cached && cached.status === "completed") {
    return cached;
  }

  // Check concurrency limit
  if (activeRequests >= MAX_CONCURRENT) {
    throw new Sam3dError(
      "Too many concurrent 3D generation requests. Please wait and try again.",
      429,
      true
    );
  }

  const job: Sam3dConversionJob = {
    id: generateId(),
    status: "processing",
    imageUrl,
    createdAt: new Date().toISOString(),
  };

  activeRequests++;
  try {
    const result = await withRetry(async () => {
      const input: Record<string, unknown> = { image_url: imageUrl };
      if (options?.seed !== undefined) input.seed = options.seed;
      if (options?.textPrompt) input.text_prompt = options.textPrompt;

      const response = await fal.subscribe(FAL_ENDPOINT, {
        input: input as Record<string, unknown> & { image_url: string },
        pollInterval: 2000,
        timeout: REQUEST_TIMEOUT_MS,
      });

      return response.data as unknown as Sam3dApiResponse;
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // Build GLB metadata
    if (result.mesh) {
      job.glbModel = {
        requestId: job.id,
        format: "glb",
        fileSize: result.mesh.file_size ?? 0,
        downloadUrl: result.mesh.url,
        seed: result.seed,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        costUsd: COST_PER_GENERATION,
      };
    }

    // Build PLY metadata (Gaussian splat)
    if (result.gaussian_splat) {
      job.plyModel = {
        requestId: job.id,
        format: "ply",
        fileSize: result.gaussian_splat.file_size ?? 0,
        downloadUrl: result.gaussian_splat.url,
        seed: result.seed,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        costUsd: 0, // Included in the generation cost
      };
    }

    job.status = "completed";
    job.completedAt = now.toISOString();
    // Cache the result
    jobCache.set(cacheKey, job);

    return job;
  } catch (error: unknown) {
    job.status = "failed";
    const err = error as Record<string, unknown> | null;
    job.error = typeof err?.message === "string" ? err.message : "3D generation failed";

    console.error("[SAM 3D] Generation failed", {
      jobId: job.id,
      error: job.error,
    });

    throw error;
  } finally {
    activeRequests--;
  }
}

/**
 * Submit an async 3D generation request and return the request ID for polling.
 */
export async function submitAsync(
  imageUrl: string,
  options?: { seed?: number; textPrompt?: string }
): Promise<{ requestId: string }> {
  ensureFalKey();

  const input: Record<string, unknown> = { image_url: imageUrl };
  if (options?.seed !== undefined) input.seed = options.seed;
  if (options?.textPrompt) input.text_prompt = options.textPrompt;

  const { request_id } = await fal.queue.submit(FAL_ENDPOINT, {
    input: input as Record<string, unknown> & { image_url: string },
  });
  return { requestId: request_id };
}

/**
 * Check the status of an async 3D generation request.
 */
export async function checkStatus(
  requestId: string
): Promise<{ status: string; responseUrl?: string }> {
  ensureFalKey();

  const status = await fal.queue.status(FAL_ENDPOINT, {
    requestId,
    logs: false,
  });

  return {
    status: status.status,
  };
}

/**
 * Get the result of a completed async request.
 */
export async function getResult(
  requestId: string
): Promise<Sam3dApiResponse> {
  ensureFalKey();

  const result = await fal.queue.result(FAL_ENDPOINT, { requestId });
  return result.data as unknown as Sam3dApiResponse;
}

/**
 * Get current concurrency info.
 */
export function getConcurrencyInfo(): { active: number; max: number; available: number } {
  return {
    active: activeRequests,
    max: MAX_CONCURRENT,
    available: Math.max(0, MAX_CONCURRENT - activeRequests),
  };
}

/**
 * Clear cached results (useful for testing or freeing memory).
 */
export function clearCache(): void {
  jobCache.clear();
}
