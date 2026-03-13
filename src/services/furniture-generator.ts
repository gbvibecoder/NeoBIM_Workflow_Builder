/**
 * Furniture Generator — Phase 3: AI-powered furniture model generation
 *
 * Uses 3D AI Studio (3daistudio.com) Hunyuan 3D API to generate high-quality
 * GLB furniture models, then uploads them to R2 CDN for the threejs-builder.
 *
 * 3D AI Studio supports:
 *   - Hunyuan 3D Rapid: 35 credits/model (~$0.35 on Studio plan)
 *   - Hunyuan 3D Pro: 60 credits/model (~$0.60 on Studio plan)
 *   - PBR textures: +20 credits
 *   - Output: GLB with PBR materials
 *
 * Designed as a batch job (POST /api/generate-furniture) to pre-populate
 * the R2 CDN. Once generated, models are cached permanently.
 *
 * Pricing reference (Studio plan $29/mo = 3,200 credits):
 *   - Rapid + PBR: 55 credits → ~58 models/month
 *   - Pro + PBR: 80 credits → ~40 models/month
 */

import { getAllAIPrompts } from "./furniture-catalog";

// ─── 3D AI Studio Configuration ─────────────────────────────────────────────

const API_BASE = "https://api.3daistudio.com";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 72; // 72 × 5s = 6 min max

type ModelEdition = "rapid" | "pro";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GenerationJob {
  file: string;
  prompt: string;
  targetH: number;
  status: "pending" | "generating" | "uploading" | "done" | "failed";
  taskId?: string;
  glbUrl?: string;
  r2Url?: string;
  error?: string;
  durationMs?: number;
  creditsUsed?: number;
}

export interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  jobs: GenerationJob[];
  totalCreditsUsed: number;
  totalDurationMs: number;
}

// ─── API Helpers ────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.THREE_D_AI_STUDIO_API_KEY || process.env.THREEDAI_API_KEY;
  if (!key) throw new Error("THREEDAI_API_KEY not configured — get your key from https://www.3daistudio.com/Platform/API");
  return key;
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`3D AI Studio API ${res.status}: ${body}`);
  }
  return res;
}

// ─── Core Generation ────────────────────────────────────────────────────────

/**
 * Generate a single furniture model via 3D AI Studio Hunyuan 3D.
 *
 * @param prompt - Description of the furniture item
 * @param edition - "rapid" (35 credits, faster) or "pro" (60 credits, higher quality)
 * @param enablePbr - Whether to include PBR textures (+20 credits)
 */
async function generateModel(
  prompt: string,
  edition: ModelEdition = "rapid",
  enablePbr = true
): Promise<{ glbUrl: string; taskId: string }> {
  // Step 1: Submit generation request
  const createRes = await apiFetch(`/v1/3d-models/tencent/generate/${edition}/`, {
    method: "POST",
    body: JSON.stringify({
      model: "3.1",
      prompt: `High quality 3D furniture model: ${prompt}. Photorealistic materials, detailed geometry, suitable for architectural visualization.`,
      enable_pbr: enablePbr,
      face_count: 30000,
    }),
  });

  const createData = (await createRes.json()) as {
    task_id: string;
    created_at: string;
  };
  const taskId = createData.task_id;

  console.log(`[3DAI] Task created: ${taskId} (${edition}, pbr=${enablePbr})`);

  // Step 2: Poll status until FINISHED
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const pollRes = await apiFetch(`/v1/generation-request/${taskId}/status/`);
    const data = (await pollRes.json()) as {
      status: "PENDING" | "IN_PROGRESS" | "FINISHED" | "FAILED";
      progress?: number;
      results?: Array<{
        asset_url: string;
        asset_type?: string;
        thumbnail?: string;
      }>;
      error?: string;
    };

    if (data.status === "FINISHED" && data.results?.length) {
      const glbUrl = data.results[0].asset_url;
      console.log(`[3DAI] Task ${taskId} FINISHED → ${glbUrl.substring(0, 60)}...`);
      return { glbUrl, taskId };
    }

    if (data.status === "FAILED") {
      throw new Error(data.error ?? "Generation failed (credits refunded automatically)");
    }

    if (i % 6 === 0) {
      console.log(`[3DAI] Task ${taskId}: ${data.status} (${data.progress ?? "?"}%)`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Generation timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000).toFixed(0)}s`);
}

/**
 * Upload a GLB model to R2 CDN under the `models/` prefix.
 * Uses a stable key (models/filename.glb) so the builder can reference it.
 */
async function uploadModelToR2(glbUrl: string, filename: string): Promise<string> {
  // Download the model from 3D AI Studio CDN
  const modelRes = await fetch(glbUrl);
  if (!modelRes.ok) throw new Error(`Failed to download model: ${modelRes.status}`);
  const modelBuffer = Buffer.from(await modelRes.arrayBuffer());

  console.log(`[3DAI] Downloaded ${filename}: ${(modelBuffer.length / 1024).toFixed(0)}KB`);

  // Upload to R2 with stable key for CDN access
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME || "buildflow-assets";
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials not configured (need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const key = `models/${filename}`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: modelBuffer,
      ContentType: "model/gltf-binary",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return publicUrl ? `${publicUrl}/${key}` : `https://${bucketName}.${accountId}.r2.cloudflarestorage.com/${key}`;
}

// ─── Batch Generation ───────────────────────────────────────────────────────

/**
 * Check which furniture models already exist on R2 CDN.
 */
async function checkExistingModels(files: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  const r2Base = process.env.R2_PUBLIC_URL || "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev";

  await Promise.all(
    files.map(async (file) => {
      try {
        const res = await fetch(`${r2Base}/models/${file}`, { method: "HEAD" });
        if (res.ok) existing.add(file);
      } catch {
        // Not found — will need to generate
      }
    })
  );

  return existing;
}

/**
 * Calculate credits needed for a generation.
 */
function creditsPerModel(edition: ModelEdition, pbr: boolean): number {
  const base = edition === "pro" ? 60 : 35;
  return base + (pbr ? 20 : 0);
}

/**
 * Generate all missing furniture models from the catalog.
 * Skips models that already exist on R2 CDN.
 *
 * @param edition - "rapid" (cheaper, faster) or "pro" (higher quality)
 * @param concurrency - Number of models to generate in parallel (default: 2)
 * @param enablePbr - Include PBR textures (recommended, +20 credits each)
 * @param onProgress - Callback for progress updates
 */
export async function generateAllFurniture(
  edition: ModelEdition = "rapid",
  concurrency = 2,
  enablePbr = true,
  onProgress?: (job: GenerationJob, index: number, total: number) => void
): Promise<BatchResult> {
  const startTime = Date.now();
  const allPrompts = getAllAIPrompts(); // reuse same catalog format

  // Check which models already exist
  const existing = await checkExistingModels(allPrompts.map((p) => p.file));

  const jobs: GenerationJob[] = allPrompts.map((p) => ({
    file: p.file,
    prompt: p.prompt,
    targetH: p.targetH,
    status: existing.has(p.file) ? ("done" as const) : ("pending" as const),
    r2Url: existing.has(p.file)
      ? `${process.env.R2_PUBLIC_URL || "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev"}/models/${p.file}`
      : undefined,
  }));

  const pendingJobs = jobs.filter((j) => j.status === "pending");
  const creditsEach = creditsPerModel(edition, enablePbr);

  console.log(`[3DAI] Batch: ${allPrompts.length} total, ${existing.size} cached, ${pendingJobs.length} to generate (${edition}+${enablePbr ? "pbr" : "nopbr"} = ${creditsEach} credits each)`);

  // Process in batches
  for (let i = 0; i < pendingJobs.length; i += concurrency) {
    const batch = pendingJobs.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async (job) => {
        const jobStart = Date.now();
        try {
          job.status = "generating";
          onProgress?.(job, jobs.indexOf(job), jobs.length);

          console.log(`[3DAI] Generating: ${job.file} — "${job.prompt.substring(0, 60)}..."`);
          const { glbUrl, taskId } = await generateModel(job.prompt, edition, enablePbr);
          job.taskId = taskId;
          job.glbUrl = glbUrl;
          job.creditsUsed = creditsEach;

          // Upload to R2
          job.status = "uploading";
          onProgress?.(job, jobs.indexOf(job), jobs.length);

          job.r2Url = await uploadModelToR2(glbUrl, job.file);
          job.status = "done";
          job.durationMs = Date.now() - jobStart;

          console.log(`[3DAI] Done: ${job.file} (${(job.durationMs / 1000).toFixed(1)}s, ${creditsEach} credits) → ${job.r2Url}`);
        } catch (err) {
          job.status = "failed";
          job.error = err instanceof Error ? err.message : String(err);
          job.durationMs = Date.now() - jobStart;

          console.error(`[3DAI] Failed: ${job.file} — ${job.error}`);
        }
        onProgress?.(job, jobs.indexOf(job), jobs.length);
      })
    );
  }

  const succeededJobs = jobs.filter((j) => j.status === "done" && !existing.has(j.file));
  const result: BatchResult = {
    total: jobs.length,
    succeeded: jobs.filter((j) => j.status === "done").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    skipped: existing.size,
    jobs,
    totalCreditsUsed: succeededJobs.length * creditsEach,
    totalDurationMs: Date.now() - startTime,
  };

  console.log(`[3DAI] Batch complete: ${result.succeeded}/${result.total} ok, ${result.failed} failed, ${result.skipped} cached. Credits: ${result.totalCreditsUsed}, Time: ${(result.totalDurationMs / 1000).toFixed(0)}s`);

  return result;
}

/**
 * Generate a single specific furniture model by filename.
 */
export async function generateSingleFurniture(
  file: string,
  prompt: string,
  edition: ModelEdition = "rapid"
): Promise<{ r2Url: string; durationMs: number; creditsUsed: number }> {
  const start = Date.now();

  console.log(`[3DAI] Single: ${file} — "${prompt}"`);
  const { glbUrl } = await generateModel(prompt, edition, true);
  const r2Url = await uploadModelToR2(glbUrl, file);

  const durationMs = Date.now() - start;
  const creditsUsed = creditsPerModel(edition, true);

  console.log(`[3DAI] Single done: ${file} (${(durationMs / 1000).toFixed(1)}s, ${creditsUsed} credits) → ${r2Url}`);

  return { r2Url, durationMs, creditsUsed };
}

/**
 * Check if 3D AI Studio API is configured.
 */
export function isFurnitureGenerationAvailable(): boolean {
  return !!(process.env.THREE_D_AI_STUDIO_API_KEY || process.env.THREEDAI_API_KEY);
}
