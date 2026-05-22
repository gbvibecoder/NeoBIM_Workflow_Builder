/**
 * KOS BIM (Week 5A) — Autodesk APS file upload + Model Derivative
 * translation.
 *
 * The full pipeline for one source file:
 *   1. uploadFileToAps        — 3-step signed-S3 multipart upload → URN
 *   2. startTranslationJob    — submit SVF2 (+ properties) translation
 *   3. pollTranslationStatus  — backoff-poll the manifest to READY/FAILED
 *   4. getTranslationManifest — fetch derivative pointers (geometry, etc.)
 *   5. getTranslationMetadata — fetch the property bags (panel params)
 *
 * The signed-S3 upload is the non-trivial bit. APS no longer accepts a
 * direct PUT to its own host; instead it hands out pre-signed AWS S3 URLs:
 *   GET  .../objects/<key>/signeds3upload?parts=N  → { uploadKey, urls[] }
 *   PUT  each 5 MB chunk to its signed URL          → S3 returns an ETag
 *   POST .../objects/<key>/signeds3upload           → { objectId }  (URN)
 * The objectId is then URL-safe-base64-encoded to form the Model
 * Derivative `urn`.
 */

import { promises as fs } from "node:fs";
import {
  KOS_APS_BASE_URL,
  KOS_APS_BUCKET_KEY,
  KOS_APS_UPLOAD_PART_SIZE_BYTES,
  KOS_APS_UPLOAD_MAX_PARTS,
  KOS_BIM_MAX_FILE_SIZE_BYTES,
  KOS_APS_POLL_INITIAL_DELAY_MS,
  KOS_APS_POLL_MAX_DELAY_MS,
  KOS_APS_POLL_MAX_DURATION_MS,
} from "@/features/kos/lib/kos-bim-constants";
import {
  fetchWithRetry,
  sleep,
  backoffDelayMs,
} from "@/features/kos/lib/aps-http";
import { getApsAccessToken } from "@/features/kos/services/aps-auth";
import { KosError } from "@/features/kos/lib/kos-errors";
import type {
  ApsManifest,
  ApsPollResult,
  ApsTranslationMetadata,
  ApsTranslationStatus,
  ApsUploadResult,
  ApsViewable,
  ApsPropertyObject,
} from "@/features/kos/types/bim";

const LOG = "[aps-translation]";

// ─── URN encoding ───────────────────────────────────────────────────────

/**
 * APS Model Derivative wants the objectId encoded as URL-safe base64 with
 * no padding (`+`→`-`, `/`→`_`, strip `=`). Per the APS spec.
 */
export function toBase64Urn(objectId: string): string {
  return Buffer.from(objectId, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// ─── Step 1–3: signed-S3 upload ─────────────────────────────────────────

export interface UploadFileToApsArgs {
  filePath: string;
  /** Unique object key within the bucket (e.g. "<familyId>-<filename>"). */
  objectKey: string;
  contentType: string;
  fileSize: number;
}

export async function uploadFileToAps(
  args: UploadFileToApsArgs,
): Promise<ApsUploadResult> {
  // contentType is part of the public args (and used upstream for the KOS
  // S3 upload) but the APS signed-S3 PUT must NOT bind a content type, so
  // it is intentionally not consumed here.
  const { filePath, objectKey, fileSize } = args;

  if (fileSize > KOS_BIM_MAX_FILE_SIZE_BYTES) {
    throw new KosError(
      "KOS_APS_004_TOO_LARGE",
      `File "${objectKey}" is ${(fileSize / 1024 / 1024).toFixed(
        1,
      )} MB, over the ${(KOS_BIM_MAX_FILE_SIZE_BYTES / 1024 / 1024).toFixed(
        0,
      )} MB APS limit. Reduce the file or raise KOS_BIM_MAX_FILE_SIZE_MB (APS hard cap is ~200 MB).`,
      413,
    );
  }
  if (fileSize <= 0) {
    throw new KosError(
      "KOS_APS_004",
      `File "${objectKey}" is empty (0 bytes) — refusing to upload.`,
      400,
    );
  }

  const partCount = Math.max(
    1,
    Math.ceil(fileSize / KOS_APS_UPLOAD_PART_SIZE_BYTES),
  );
  if (partCount > KOS_APS_UPLOAD_MAX_PARTS) {
    throw new KosError(
      "KOS_APS_004",
      `File "${objectKey}" would need ${partCount} parts (> ${KOS_APS_UPLOAD_MAX_PARTS} max). File is too large for a single signed-S3 batch.`,
      413,
    );
  }

  const token = await getApsAccessToken();
  const encodedKey = encodeURIComponent(objectKey);
  const baseObjUrl = `${KOS_APS_BASE_URL}/oss/v2/buckets/${encodeURIComponent(
    KOS_APS_BUCKET_KEY,
  )}/objects/${encodedKey}/signeds3upload`;

  // ── Step 1: request signed URLs for all parts ──────────────────────
  const signRes = await fetchWithRetry(
    `${baseObjUrl}?parts=${partCount}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
    { label: `APS signed-upload request (${objectKey})`, exhaustedCode: "KOS_APS_004" },
  );

  if (!signRes.ok) {
    const detail = await safeText(signRes);
    throw new KosError(
      "KOS_APS_004",
      `Failed to obtain signed-S3 upload URLs for "${objectKey}": HTTP ${signRes.status} — ${detail}`,
      502,
    );
  }

  const signJson = (await signRes.json()) as {
    uploadKey?: string;
    urls?: string[];
  };
  if (!signJson.uploadKey || !signJson.urls?.length) {
    throw new KosError(
      "KOS_APS_004",
      `APS signed-upload response for "${objectKey}" missing uploadKey/urls. Got keys: ${Object.keys(
        signJson,
      ).join(", ")}.`,
      502,
    );
  }
  if (signJson.urls.length < partCount) {
    throw new KosError(
      "KOS_APS_004",
      `APS returned ${signJson.urls.length} signed URL(s) but ${partCount} parts are needed for "${objectKey}".`,
      502,
    );
  }

  // ── Step 2: PUT each chunk to its signed URL (serial, streaming) ───
  const eTags: string[] = [];
  const fh = await fs.open(filePath, "r");
  try {
    for (let i = 0; i < partCount; i++) {
      const start = i * KOS_APS_UPLOAD_PART_SIZE_BYTES;
      const length = Math.min(KOS_APS_UPLOAD_PART_SIZE_BYTES, fileSize - start);
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, start);
      if (bytesRead !== length) {
        throw new KosError(
          "KOS_APS_004",
          `Short read on part ${i + 1}/${partCount} of "${objectKey}": expected ${length} bytes, got ${bytesRead}.`,
          500,
        );
      }
      const eTag = await putChunkToSignedUrl(
        signJson.urls[i],
        buf,
        i + 1,
        partCount,
        objectKey,
      );
      eTags.push(eTag);
    }
  } finally {
    await fh.close();
  }

  // ── Step 3: finalize the upload ────────────────────────────────────
  // eTags are required by APS when the object was uploaded in multiple
  // parts; harmless for a single part. `size` lets APS validate the total.
  const finalizeRes = await fetchWithRetry(
    baseObjUrl,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        uploadKey: signJson.uploadKey,
        size: fileSize,
        eTags,
      }),
    },
    { label: `APS finalize upload (${objectKey})`, exhaustedCode: "KOS_APS_004" },
  );

  if (!finalizeRes.ok) {
    const detail = await safeText(finalizeRes);
    throw new KosError(
      "KOS_APS_004",
      `Failed to finalize signed-S3 upload for "${objectKey}": HTTP ${finalizeRes.status} — ${detail}`,
      502,
    );
  }

  const finalizeJson = (await finalizeRes.json()) as {
    objectId?: string;
    objectKey?: string;
  };
  if (!finalizeJson.objectId) {
    throw new KosError(
      "KOS_APS_004",
      `APS finalize response for "${objectKey}" missing objectId. Got keys: ${Object.keys(
        finalizeJson,
      ).join(", ")}.`,
      502,
    );
  }

  return {
    objectId: finalizeJson.objectId,
    base64Urn: toBase64Urn(finalizeJson.objectId),
  };
}

/**
 * PUT one chunk to a pre-signed S3 URL. No Authorization header — the URL
 * itself is signed. S3 returns the part's ETag in the response header,
 * which APS needs at finalize. Retries 5xx + network errors.
 */
async function putChunkToSignedUrl(
  signedUrl: string,
  body: Buffer,
  partNumber: number,
  partCount: number,
  objectKey: string,
): Promise<string> {
  const res = await fetchWithRetry(
    signedUrl,
    {
      method: "PUT",
      // Buffer body is replayable across retries; do NOT set Content-Type
      // (the presigned URL doesn't sign it — a mismatch would 403). A Node
      // Buffer is a Uint8Array at runtime (a valid BodyInit); the cast just
      // widens the DOM lib's narrower type.
      body: body as unknown as BodyInit,
    },
    {
      label: `APS upload part ${partNumber}/${partCount} (${objectKey})`,
      maxAttempts: 3,
      baseDelayMs: 1000,
      exhaustedCode: "KOS_APS_004",
    },
  );

  if (!res.ok) {
    const detail = await safeText(res);
    throw new KosError(
      "KOS_APS_004",
      `S3 PUT failed for part ${partNumber}/${partCount} of "${objectKey}": HTTP ${res.status} — ${detail}`,
      502,
    );
  }

  // S3 wraps the ETag in quotes; strip them. Absence is unexpected but
  // not fatal — finalize can still succeed for single-part uploads.
  return (res.headers.get("etag") ?? "").replace(/^"|"$/g, "");
}

// ─── Translation job submission ─────────────────────────────────────────

/** Output format spec keyed by source extension. All → SVF2 (2d + 3d). */
function outputFormatsFor(fileExtension: string) {
  const ext = fileExtension.toLowerCase();
  const isRevit = ext === ".rfa" || ext === ".rvt";
  // Every supported extension translates to SVF2 with both 2D and 3D
  // views. For Revit sources we additionally request master views: they
  // surface the family-TYPE parameters (panel width/height/thickness/
  // material) that otherwise stay hidden in the default 3D view — exactly
  // the data the SKU derivation reads.
  return [
    {
      type: "svf2",
      views: ["2d", "3d"],
      ...(isRevit ? { advanced: { generateMasterViews: true } } : {}),
    },
  ];
}

export async function startTranslationJob(
  base64Urn: string,
  fileExtension: string,
): Promise<{ jobId: string; urn: string }> {
  const token = await getApsAccessToken();

  const res = await fetchWithRetry(
    `${KOS_APS_BASE_URL}/modelderivative/v2/designdata/job`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        // Force a fresh translation, overwriting any prior derivative.
        "x-ads-force": "true",
      },
      body: JSON.stringify({
        input: { urn: base64Urn },
        output: { formats: outputFormatsFor(fileExtension) },
      }),
    },
    {
      label: "APS translation job",
      maxAttempts: 3,
      baseDelayMs: 1500,
      exhaustedCode: "KOS_APS_005",
    },
  );

  // 409 → already translating. Idempotent: treat as success.
  if (res.status === 409) {
    return { jobId: "", urn: base64Urn };
  }

  if (res.status !== 200 && res.status !== 201) {
    const detail = await safeText(res);
    throw new KosError(
      "KOS_APS_005",
      `APS translation job submission failed: HTTP ${res.status} — ${detail}`,
      502,
    );
  }

  const json = (await res.json()) as { result?: string; urn?: string; id?: string };
  return { jobId: json.id ?? "", urn: json.urn ?? base64Urn };
}

// ─── Manifest polling ────────────────────────────────────────────────────

function mapManifestStatus(raw: string | undefined): ApsTranslationStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "success":
      return "READY";
    case "failed":
    case "timeout":
      return "FAILED";
    case "pending":
    case "inprogress":
    default:
      return "TRANSLATING";
  }
}

export async function pollTranslationStatus(
  base64Urn: string,
  options: {
    initialDelayMs?: number;
    maxDelayMs?: number;
    maxDurationMs?: number;
  } = {},
): Promise<ApsPollResult> {
  const initialDelayMs = options.initialDelayMs ?? KOS_APS_POLL_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? KOS_APS_POLL_MAX_DELAY_MS;
  const maxDurationMs = options.maxDurationMs ?? KOS_APS_POLL_MAX_DURATION_MS;

  const deadline = Date.now() + maxDurationMs;
  let pollIndex = 0;

  // Initial settle delay — the manifest often 404s for the first few
  // seconds after job submission.
  await sleep(initialDelayMs);

  for (;;) {
    let manifest: ApsManifest | null = null;
    let httpStatus = 0;
    try {
      const res = await fetchManifestResponse(base64Urn);
      httpStatus = res.status;
      if (res.ok) {
        manifest = (await res.json()) as ApsManifest;
      } else if (res.status !== 404) {
        // Non-404 error during polling — log and keep trying until the
        // hard timeout (could be a transient 5xx that fetchWithRetry
        // already exhausted, so treat conservatively).
        console.warn(
          `${LOG} manifest poll for ${base64Urn.slice(0, 12)}… returned HTTP ${res.status}`,
        );
      }
    } catch (err) {
      // Network/exhausted — log, keep polling within the deadline.
      console.warn(
        `${LOG} manifest poll error (${base64Urn.slice(0, 12)}…): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (manifest) {
      const status = mapManifestStatus(manifest.status);
      const progress = manifest.progress ?? "";
      if (status === "READY") {
        return { status, progress, manifest };
      }
      if (status === "FAILED") {
        return { status, progress, manifest };
      }
      // else still TRANSLATING — fall through to backoff.
    }

    if (Date.now() >= deadline) {
      throw new KosError(
        "KOS_APS_006_TIMEOUT",
        `APS translation for urn ${base64Urn.slice(0, 16)}… did not reach a terminal state within ${(
          maxDurationMs / 1000
        ).toFixed(
          0,
        )}s (last HTTP ${httpStatus || "n/a"}). Try a smaller file, or re-run — partial translations can be resumed by re-submitting the job.`,
        504,
      );
    }

    pollIndex++;
    const delay = backoffDelayMs(pollIndex, initialDelayMs, maxDelayMs);
    // Don't sleep past the deadline.
    await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
  }
}

// ─── Manifest + metadata fetch ───────────────────────────────────────────

async function fetchManifestResponse(base64Urn: string): Promise<Response> {
  const token = await getApsAccessToken(["data:read"]);
  return fetchWithRetry(
    `${KOS_APS_BASE_URL}/modelderivative/v2/designdata/${base64Urn}/manifest`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
    { label: "APS manifest", maxAttempts: 3, exhaustedCode: "KOS_APS_006" },
  );
}

export async function getTranslationManifest(
  base64Urn: string,
): Promise<ApsManifest> {
  const res = await fetchManifestResponse(base64Urn);
  if (!res.ok) {
    const detail = await safeText(res);
    throw new KosError(
      "KOS_APS_006",
      `Failed to fetch APS manifest for urn ${base64Urn.slice(0, 16)}…: HTTP ${res.status} — ${detail}`,
      502,
    );
  }
  return (await res.json()) as ApsManifest;
}

/**
 * Fetch the translation's metadata + the property bags of its primary
 * viewable. NEVER throws — APS metadata is best-effort, and partial data
 * (even none) is still useful. On any error we log and return empties so
 * the ingestion orchestrator can still persist a READY family with raw
 * geometry pointers.
 */
export async function getTranslationMetadata(
  base64Urn: string,
): Promise<ApsTranslationMetadata> {
  const empty: ApsTranslationMetadata = {
    properties: [],
    hierarchy: null,
    viewables: [],
  };

  try {
    const token = await getApsAccessToken(["data:read"]);

    // ── List viewables ──────────────────────────────────────────────
    const metaRes = await fetchWithRetry(
      `${KOS_APS_BASE_URL}/modelderivative/v2/designdata/${base64Urn}/metadata`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      },
      { label: "APS metadata", maxAttempts: 3, exhaustedCode: "KOS_APS_006" },
    );
    if (!metaRes.ok) {
      console.warn(
        `${LOG} metadata list HTTP ${metaRes.status} for ${base64Urn.slice(0, 12)}… — continuing with no properties.`,
      );
      return empty;
    }
    const metaJson = (await metaRes.json()) as {
      data?: { metadata?: ApsViewable[] };
    };
    const viewables = metaJson.data?.metadata ?? [];
    if (viewables.length === 0) {
      console.warn(
        `${LOG} no viewables for ${base64Urn.slice(0, 12)}… (empty geometry is common for unparametrised .rfa families).`,
      );
      return { ...empty, viewables };
    }

    // Prefer the first 3D viewable; fall back to the first of any kind.
    const primary =
      viewables.find(
        (v) =>
          (v.role ?? "").toLowerCase() === "3d" ||
          (v.type ?? "").toLowerCase() === "geometry",
      ) ?? viewables[0];

    // ── Fetch properties for the primary viewable (poll past 202) ────
    const properties = await fetchViewableProperties(
      base64Urn,
      primary.guid,
      token,
    );

    return { properties, hierarchy: null, viewables };
  } catch (err) {
    console.warn(
      `${LOG} getTranslationMetadata failed for ${base64Urn.slice(0, 12)}… — returning partial data: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return empty;
  }
}

/**
 * GET .../metadata/<guid>/properties. APS returns 202 while the property
 * extraction job is still running; poll (bounded) until 200. Returns
 * `data.collection` — the array of per-object property bags.
 */
async function fetchViewableProperties(
  base64Urn: string,
  guid: string,
  token: string,
): Promise<ApsPropertyObject[]> {
  const url = `${KOS_APS_BASE_URL}/modelderivative/v2/designdata/${base64Urn}/metadata/${guid}/properties`;
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetchWithRetry(
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      },
      { label: "APS properties", maxAttempts: 3, exhaustedCode: "KOS_APS_006" },
    );

    if (res.status === 202) {
      // Still extracting — wait and retry.
      await sleep(backoffDelayMs(attempt, 2000, 15_000));
      continue;
    }
    if (!res.ok) {
      console.warn(
        `${LOG} properties HTTP ${res.status} for guid ${guid.slice(0, 8)}… — returning empty.`,
      );
      return [];
    }
    const json = (await res.json()) as {
      data?: { collection?: ApsPropertyObject[] };
    };
    return json.data?.collection ?? [];
  }
  console.warn(
    `${LOG} properties for guid ${guid.slice(0, 8)}… still 202 after ${maxAttempts} polls — returning empty.`,
  );
  return [];
}

// ─── Credit estimation ───────────────────────────────────────────────────

/**
 * Rough APS credit estimate for cost reporting. NOT billed by us — APS
 * bills on its own meter; this is a planning figure derived from the APS
 * pricing docs (Model Derivative is ~free for SVF2 today, but we keep a
 * conservative estimate so the run summary surfaces a number).
 */
export function estimateApsCredits(
  fileSizeBytes: number,
  fileType: string,
): number {
  const mb = fileSizeBytes / (1024 * 1024);
  const ext = fileType.toLowerCase();
  if (ext === ".rfa" || ext === ".rvt") {
    return Math.round(50 + Math.max(0, mb - 50) * 10);
  }
  if (ext === ".dwg") {
    return Math.round(30 + mb * 5);
  }
  if (ext === ".ifc") {
    return 50;
  }
  return Math.round(40 + mb * 5);
}

// ─── shared ──────────────────────────────────────────────────────────────

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 500) || "(empty body)";
  } catch {
    return "(body unreadable)";
  }
}
