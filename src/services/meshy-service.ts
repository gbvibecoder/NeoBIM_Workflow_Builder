/**
 * Meshy API Service — Hi-Fi 3D Reconstruction from multi-view renders.
 * Converts concept render images into detailed, textured GLB 3D models
 * using Meshy v2 image-to-3d API.
 *
 * Docs: https://docs.meshy.ai/api-image-to-3d-v2
 */

import { generateId } from "@/lib/utils";

// ─── Configuration ──────────────────────────────────────────────────────────

const MESHY_API_BASE = "https://api.meshy.ai/openapi/v2";
const COST_PER_GENERATION = 0.10; // ~$0.10 per image-to-3d task
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 80; // 80 × 3s = 4 min max

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MeshyTaskInput {
  /** URL of the primary image to reconstruct */
  imageUrl: string;
  /** Optional building description to guide reconstruction */
  description?: string;
  /** Topology: "quad" produces cleaner meshes for architecture */
  topology?: "quad" | "triangle";
  /** Target polycount — higher = more detail */
  targetPolycount?: number;
}

export interface MeshyTask {
  id: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "expired";
  progress: number;
  modelUrl?: string;
  thumbnailUrl?: string;
  textureUrls?: string[];
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface HiFi3DResult {
  taskId: string;
  glbUrl: string;
  thumbnailUrl: string;
  textureUrls: string[];
  costUsd: number;
  durationMs: number;
}

// ─── Error Handling ─────────────────────────────────────────────────────────

class MeshyError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public retryable: boolean
  ) {
    super(message);
    this.name = "MeshyError";
  }
}

function ensureMeshyKey(): string {
  const key = process.env.MESHY_API_KEY;
  if (!key) {
    throw new MeshyError(
      "MESHY_API_KEY environment variable is not configured",
      500,
      false
    );
  }
  return key;
}

async function meshyFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = ensureMeshyKey();
  const res = await fetch(`${MESHY_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const retryable = res.status >= 500 || res.status === 429;
    throw new MeshyError(
      `Meshy API error ${res.status}: ${body}`,
      res.status,
      retryable
    );
  }

  return res;
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Create a Meshy image-to-3D task.
 * Returns the task ID for polling.
 */
async function createTask(input: MeshyTaskInput): Promise<string> {
  const res = await meshyFetch("/image-to-3d", {
    method: "POST",
    body: JSON.stringify({
      image_url: input.imageUrl,
      ai_model: "meshy-4",
      topology: input.topology ?? "quad",
      target_polycount: input.targetPolycount ?? 30000,
      should_remesh: true,
      enable_pbr: true,
    }),
  });

  const data = (await res.json()) as { result: string };
  return data.result; // task ID
}

/**
 * Poll a Meshy task until completion or failure.
 */
async function pollTask(taskId: string): Promise<MeshyTask> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const res = await meshyFetch(`/image-to-3d/${taskId}`);
    const data = (await res.json()) as {
      id: string;
      status: string;
      progress: number;
      model_urls?: { glb?: string };
      thumbnail_url?: string;
      texture_urls?: string[];
      created_at: number;
      finished_at?: number;
      task_error?: { message?: string };
    };

    if (data.status === "SUCCEEDED") {
      return {
        id: data.id,
        status: "succeeded",
        progress: 100,
        modelUrl: data.model_urls?.glb,
        thumbnailUrl: data.thumbnail_url,
        textureUrls: data.texture_urls ?? [],
        createdAt: new Date(data.created_at).toISOString(),
        completedAt: data.finished_at
          ? new Date(data.finished_at).toISOString()
          : new Date().toISOString(),
      };
    }

    if (data.status === "FAILED" || data.status === "EXPIRED") {
      return {
        id: data.id,
        status: data.status === "FAILED" ? "failed" : "expired",
        progress: data.progress,
        createdAt: new Date(data.created_at).toISOString(),
        error: data.task_error?.message ?? `Task ${data.status.toLowerCase()}`,
      };
    }

    // Still processing — wait and retry
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new MeshyError(
    "Meshy task timed out after polling",
    408,
    true
  );
}

/**
 * Full pipeline: submit image → poll → return GLB URL.
 * This is the main entry point for the GN-010 node.
 */
export async function reconstructHiFi3D(
  input: MeshyTaskInput
): Promise<HiFi3DResult> {
  const startTime = Date.now();

  console.log("[Meshy] Starting Hi-Fi 3D reconstruction", {
    imageUrl: input.imageUrl.slice(0, 80),
    topology: input.topology ?? "quad",
    targetPolycount: input.targetPolycount ?? 30000,
  });

  // Step 1: Create task
  const taskId = await createTask(input);

  console.log("[Meshy] Task created", { taskId });

  // Step 2: Poll until complete
  const task = await pollTask(taskId);

  if (task.status !== "succeeded" || !task.modelUrl) {
    throw new MeshyError(
      `3D reconstruction failed: ${task.error ?? "Unknown error"}`,
      500,
      false
    );
  }

  const durationMs = Date.now() - startTime;

  console.log("[Meshy] Reconstruction completed", {
    taskId,
    durationMs,
    costUsd: COST_PER_GENERATION,
  });

  return {
    taskId: task.id,
    glbUrl: task.modelUrl,
    thumbnailUrl: task.thumbnailUrl ?? "",
    textureUrls: task.textureUrls ?? [],
    costUsd: COST_PER_GENERATION,
    durationMs,
  };
}

/**
 * Check if the Meshy API key is configured.
 */
export function isMeshyConfigured(): boolean {
  return !!process.env.MESHY_API_KEY;
}

/**
 * Get a unique request ID for tracking.
 */
export function getMeshyRequestId(): string {
  return generateId();
}
