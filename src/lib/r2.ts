/**
 * Cloudflare R2 Storage Client
 *
 * R2 is S3-compatible — we use the AWS S3 SDK with R2 endpoint.
 * Free tier: 10GB storage, 10M reads/mo, 1M writes/mo.
 *
 * Env vars required:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *
 * Optional:
 *   R2_PUBLIC_URL — custom domain or R2.dev public URL for the bucket
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ─── Config ────────────────────────────────────────────────────────────────

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY || "";
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY || "";
const BUCKET_NAME = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || "buildflow-files";
const PUBLIC_URL = process.env.R2_PUBLIC_URL ?? ""; // e.g. https://files.yourdomain.com

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB cap for PDFs/XLSX
const MAX_IFC_SIZE = 100 * 1024 * 1024; // 100MB cap for IFC files
const MAX_BRIEF_SIZE = 50 * 1024 * 1024; // 50MB cap for Brief-to-Renders inputs (PDF/DOCX)
// 30 MB cap for the Brief-to-Renders editorial PDF output.
// Empirically a 12-shot PDF lands at 8-15 MB after jspdf compression — the
// generic 5 MB cap on `uploadToR2` was a hard blocker (the upload silently
// failed-open to a data URI, which Stage 4 then rejected as "r2_unconfigured").
const MAX_EDITORIAL_PDF_SIZE = 30 * 1024 * 1024;
const CLEANUP_DAYS_FILES = 25; // PDFs & XLSX
const CLEANUP_DAYS_IFC = 3;   // IFC files (session-like, short-lived)
const CLEANUP_DAYS_BRIEFS = 25; // Uploaded briefs — same retention as files/

// ─── Client ────────────────────────────────────────────────────────────────

let _client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) return null;
  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
      // Disable default CRC32 checksum — R2 doesn't support x-amz-sdk-checksum-algorithm
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }
  return _client;
}

/** Check if R2 is configured */
export function isR2Configured(): boolean {
  return !!(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

// ─── Upload ────────────────────────────────────────────────────────────────

interface UploadResult {
  success: true;
  url: string;
  key: string;
  size: number;
}

interface UploadError {
  success: false;
  error: string;
}

/**
 * Upload a file (base64 or Buffer) to R2.
 * Returns a public URL on success, or an error on failure.
 * Enforces 5MB file size cap.
 */
export async function uploadToR2(
  fileBuffer: Buffer,
  filename: string,
  contentType: string,
): Promise<UploadResult | UploadError> {
  const client = getClient();
  if (!client) {
    return { success: false, error: "R2 not configured" };
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    return { success: false, error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` };
  }

  // Key format: files/2026/03/10/uuid-filename.pdf
  const now = new Date();
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const uniqueId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const key = `files/${datePath}/${uniqueId}-${filename}`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
        // Store upload timestamp for cleanup
        Metadata: {
          "uploaded-at": now.toISOString(),
        },
      }),
    );

    const url = PUBLIC_URL
      ? `${PUBLIC_URL}/${key}`
      : `https://${BUCKET_NAME}.${ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

    return { success: true, url, key, size: fileBuffer.length };
  } catch (err) {
    console.error("[R2] Upload failed:", err);
    return { success: false, error: String(err) };
  }
}

const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB for videos

/**
 * Upload a video file to R2 under the `videos/` prefix.
 * Max 50MB. Returns a permanent URL.
 */
export async function uploadVideoToR2(
  fileBuffer: Buffer,
  filename: string,
): Promise<UploadResult | UploadError> {
  const client = getClient();
  if (!client) return { success: false, error: "R2 not configured" };
  if (fileBuffer.length > MAX_VIDEO_SIZE) {
    return { success: false, error: `Video exceeds ${MAX_VIDEO_SIZE / 1024 / 1024}MB limit` };
  }

  const now = new Date();
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const uniqueId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const key = `videos/${datePath}/${uniqueId}-${filename}`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: "video/mp4",
        Metadata: { "uploaded-at": now.toISOString() },
      }),
    );

    const url = PUBLIC_URL
      ? `${PUBLIC_URL}/${key}`
      : `https://${BUCKET_NAME}.${ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

    return { success: true, url, key, size: fileBuffer.length };
  } catch (err) {
    console.error("[R2] Video upload failed:", err);
    return { success: false, error: String(err) };
  }
}

// ─── Presigned Upload URL ───────────────────────────────────────────────────

/**
 * Generate a presigned PUT URL for direct browser-to-R2 upload.
 * Bypasses server body size limits (e.g. Vercel 4.5MB cap).
 * Returns { uploadUrl, key, publicUrl } — client PUTs directly to uploadUrl.
 */
export async function createPresignedUploadUrl(
  filename: string,
  contentType: string,
  expiresIn = 600, // 10 minutes
  keyPrefix = "videos",
  useDirectUrl = false,
): Promise<{ uploadUrl: string; key: string; publicUrl: string } | null> {
  const client = getClient();
  if (!client) return null;

  const now = new Date();
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const uniqueId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const safePrefix = keyPrefix.replace(/^\/+|\/+$/g, ""); // strip leading/trailing slashes
  const key = `${safePrefix}/${datePath}/${uniqueId}-${filename}`;

  try {
    // NOTE: Do NOT include Metadata here — presigned URLs sign x-amz-meta-*
    // headers, and the browser client can't send them, causing signature mismatch.
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    const rawUrl = await getSignedUrl(client, command, { expiresIn });

    // ── uploadUrl mode selector ────────────────────────────────────────
    // Default (false): same-origin /r2-upload/ proxy. Avoids browser CORS
    //   preflight and is the historical path used for community-videos.
    //   DOWNSIDE: routes through Vercel infrastructure, which enforces a
    //   ~4.5 MB body cap even on rewrites — anything larger 413s.
    // useDirectUrl=true: return the raw R2 endpoint so the browser PUTs
    //   straight to Cloudflare R2. Required for files larger than the
    //   Vercel body cap (e.g., 18 MB IFC files). Requires R2 bucket CORS
    //   to allow PUT from the calling origin — handled by ensureBucketCors.
    let uploadUrl: string;
    if (useDirectUrl) {
      uploadUrl = rawUrl;
    } else {
      const r2Base = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET_NAME}/`;
      uploadUrl = rawUrl.replace(r2Base, "/r2-upload/");
    }

    const publicUrl = PUBLIC_URL
      ? `${PUBLIC_URL}/${key}`
      : `https://${BUCKET_NAME}.${ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

    return { uploadUrl, key, publicUrl };
  } catch (err) {
    console.error("[R2] Presigned URL generation failed:", err);
    return null;
  }
}

/**
 * Upload a base64 data URI to R2.
 * Extracts the binary from the data URI, uploads it, returns a permanent URL.
 * Falls back gracefully — returns the original data URI if upload fails.
 */
export async function uploadBase64ToR2(
  dataUri: string,
  filename: string,
  contentType: string,
): Promise<string> {
  if (!isR2Configured()) return dataUri; // graceful fallback

  try {
    // Extract base64 from data URI (format: data:mime;base64,XXXX)
    const base64Data = dataUri.includes(",") ? dataUri.split(",")[1] : dataUri;
    const buffer = Buffer.from(base64Data, "base64");

    const result = await uploadToR2(buffer, filename, contentType);
    if (result.success) {
      return result.url;
    }

    console.warn("[R2] Upload failed, falling back to base64:", result.error);
    return dataUri; // graceful fallback
  } catch (err) {
    console.warn("[R2] Upload error, falling back to base64:", err);
    return dataUri; // graceful fallback
  }
}

// ─── IFC Upload ────────────────────────────────────────────────────────────

/**
 * Upload an IFC file to R2 under the `ifc/` prefix.
 * Max 50MB. Stored for 3 days only (cleaned up by cron).
 * Returns the public URL on success, or null on failure.
 */
export async function uploadIFCToR2(
  fileBuffer: Buffer | Uint8Array,
  filename: string,
): Promise<{ url: string; key: string } | null> {
  const client = getClient();
  if (!client) return null;

  const buf = fileBuffer instanceof Buffer ? fileBuffer : Buffer.from(fileBuffer);

  if (buf.length > MAX_IFC_SIZE) {
    console.warn(`[R2] IFC file exceeds ${MAX_IFC_SIZE / 1024 / 1024}MB limit`);
    return null;
  }

  const now = new Date();
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const uniqueId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const key = `ifc/${datePath}/${uniqueId}-${filename}`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buf,
        ContentType: "application/x-step",
        Metadata: {
          "uploaded-at": now.toISOString(),
        },
      }),
    );

    const url = PUBLIC_URL
      ? `${PUBLIC_URL}/${key}`
      : `https://${BUCKET_NAME}.${ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

    return { url, key };
  } catch (err) {
    console.error("[R2] IFC upload failed:", err);
    return null;
  }
}

// ─── Brief Upload (Brief-to-Renders pipeline) ─────────────────────────────

/**
 * Upload a brief document (PDF or DOCX) to R2 under the `briefs/` prefix.
 *
 * - Cap: 50 MB (vs `uploadToR2`'s 5 MB cap, which is intentional for the
 *   existing PDF/XLSX export path — DO NOT raise that cap).
 * - Retention: 25 days, swept by the `cleanupOldFiles` cron.
 * - Key format: `briefs/YYYY/MM/DD/<uuid12>-<filename>`.
 *
 * Returns the same `{ url, key, size }` shape as `uploadToR2` on
 * success, or an error envelope on failure.
 */
export async function uploadBriefToR2(
  fileBuffer: Buffer | Uint8Array,
  filename: string,
  contentType: string,
): Promise<UploadResult | UploadError> {
  const client = getClient();
  if (!client) {
    return { success: false, error: "R2 not configured" };
  }

  const buf = fileBuffer instanceof Buffer ? fileBuffer : Buffer.from(fileBuffer);

  if (buf.length > MAX_BRIEF_SIZE) {
    return {
      success: false,
      error: `File exceeds ${MAX_BRIEF_SIZE / 1024 / 1024}MB limit`,
    };
  }

  const now = new Date();
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const uniqueId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const key = `briefs/${datePath}/${uniqueId}-${filename}`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buf,
        ContentType: contentType,
        Metadata: { "uploaded-at": now.toISOString() },
      }),
    );

    const url = PUBLIC_URL
      ? `${PUBLIC_URL}/${key}`
      : `https://${BUCKET_NAME}.${ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

    return { success: true, url, key, size: buf.length };
  } catch (err) {
    console.error("[R2] Brief upload failed:", err);
    return { success: false, error: String(err) };
  }
}

// ─── Editorial PDF Upload (Brief-to-Renders pipeline output) ─────────────

/**
 * Upload the compiled editorial PDF (cover + 12 shot pages) to R2 under
 * the `briefs-pdfs/` flat key. Cap: 30 MB (empirically 12 photoreal
 * shots after jspdf compression land at 8-15 MB).
 *
 * Why a dedicated function:
 *   • The generic `uploadToR2` enforces a 5 MB cap, which silently
 *     failed-open in `uploadBase64ToR2` and made Stage 4 think R2 was
 *     unconfigured. See the failing case in
 *     `src/features/brief-renders/services/brief-pipeline/stage-4-pdf-compile.ts`.
 *   • An explicit success/error envelope (no graceful fallback to a data
 *     URI) lets the caller surface the *real* reason for failure to the
 *     user, satisfying the project-wide specific-errors rule.
 *
 * Idempotency: callers pass a deterministic `briefs-pdfs-{jobId}.pdf` key,
 * so re-running the compile overwrites in place. No date-prefixed path.
 */
export async function uploadEditorialPdfToR2(
  pdfBuffer: Buffer | Uint8Array,
  key: string,
): Promise<UploadResult | UploadError> {
  const client = getClient();
  if (!client) {
    return { success: false, error: "R2 not configured" };
  }

  const buf = pdfBuffer instanceof Buffer ? pdfBuffer : Buffer.from(pdfBuffer);

  if (buf.length > MAX_EDITORIAL_PDF_SIZE) {
    return {
      success: false,
      error: `Editorial PDF size ${(buf.length / 1024 / 1024).toFixed(2)} MB exceeds ${MAX_EDITORIAL_PDF_SIZE / 1024 / 1024} MB cap`,
    };
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buf,
        ContentType: "application/pdf",
        Metadata: { "uploaded-at": new Date().toISOString() },
      }),
    );

    const url = PUBLIC_URL
      ? `${PUBLIC_URL}/${key}`
      : `https://${BUCKET_NAME}.${ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;

    return { success: true, url, key, size: buf.length };
  } catch (err) {
    console.error("[R2] Editorial PDF upload failed:", err);
    return {
      success: false,
      error:
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}

// ─── Building Assets Upload (GLB + IFC + Metadata) ────────────────────────

export interface BuildingAssetUrls {
  glbUrl: string;
  ifcUrl: string;
  metadataUrl: string;
}

/**
 * Upload all building assets (GLB model, IFC file, metadata JSON) to R2 in parallel.
 * Returns public URLs for all three files, or null if R2 is not configured.
 */
export async function uploadBuildingAssets(
  glbBuffer: Buffer,
  ifcContent: string,
  metadataJson: string,
  buildingId: string,
): Promise<BuildingAssetUrls | null> {
  const client = getClient();
  if (!client) return null;

  const now = new Date();
  const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const prefix = `buildings/${datePath}/${buildingId}`;

  const ifcBuffer = Buffer.from(ifcContent, "utf-8");
  const metaBuffer = Buffer.from(metadataJson, "utf-8");

  const uploads = [
    { key: `${prefix}/model.glb`, body: glbBuffer, contentType: "model/gltf-binary" },
    { key: `${prefix}/model.ifc`, body: ifcBuffer, contentType: "application/x-step" },
    { key: `${prefix}/metadata.json`, body: metaBuffer, contentType: "application/json" },
  ];

  try {
    await Promise.all(
      uploads.map((u) =>
        client.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: u.key,
            Body: u.body,
            ContentType: u.contentType,
            Metadata: { "uploaded-at": now.toISOString(), "building-id": buildingId },
          }),
        ),
      ),
    );

    const baseUrl = PUBLIC_URL
      ? PUBLIC_URL
      : `https://${BUCKET_NAME}.${ACCOUNT_ID}.r2.cloudflarestorage.com`;

    return {
      glbUrl: `${baseUrl}/${uploads[0].key}`,
      ifcUrl: `${baseUrl}/${uploads[1].key}`,
      metadataUrl: `${baseUrl}/${uploads[2].key}`,
    };
  } catch (err) {
    console.error("[R2] Building assets upload failed:", err);
    return null;
  }
}

// ─── Cleanup ───────────────────────────────────────────────────────────────

interface CleanupResult {
  filesDeleted: number;
  ifcDeleted: number;
  briefsDeleted: number;
  errors: number;
}

/**
 * Cleanup R2 storage:
 * - `files/` prefix:  delete files older than 25 days (PDFs, XLSX)
 * - `ifc/` prefix:    delete files older than 3 days
 * - `briefs/` prefix: delete files older than 25 days (Brief-to-Renders inputs)
 */
export async function cleanupOldFiles(): Promise<CleanupResult> {
  const client = getClient();
  if (!client) return { filesDeleted: 0, ifcDeleted: 0, briefsDeleted: 0, errors: 0 };

  const fileCutoff = new Date();
  fileCutoff.setDate(fileCutoff.getDate() - CLEANUP_DAYS_FILES);

  const ifcCutoff = new Date();
  ifcCutoff.setDate(ifcCutoff.getDate() - CLEANUP_DAYS_IFC);

  const briefsCutoff = new Date();
  briefsCutoff.setDate(briefsCutoff.getDate() - CLEANUP_DAYS_BRIEFS);

  let filesDeleted = 0;
  let ifcDeleted = 0;
  let briefsDeleted = 0;
  let errors = 0;

  // Helper to clean a prefix with a given cutoff
  async function cleanPrefix(prefix: string, cutoff: Date): Promise<{ deleted: number; errors: number }> {
    let deleted = 0;
    let errs = 0;
    let continuationToken: string | undefined;

    do {
      const listResult = await client!.send(
        new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 500,
        }),
      );

      const toDelete = (listResult.Contents ?? []).filter(
        (obj) => obj.Key && obj.LastModified && obj.LastModified < cutoff,
      );

      // Delete in parallel batches of 20 for throughput
      for (let i = 0; i < toDelete.length; i += 20) {
        const batch = toDelete.slice(i, i + 20);
        const results = await Promise.allSettled(
          batch.map((obj) =>
            client!.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: obj.Key! })),
          ),
        );
        for (const r of results) {
          if (r.status === "fulfilled") deleted++;
          else errs++;
        }
      }

      continuationToken = listResult.IsTruncated
        ? listResult.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return { deleted, errors: errs };
  }

  // Clean PDFs/XLSX (25 days)
  const fileResult = await cleanPrefix("files/", fileCutoff);
  filesDeleted = fileResult.deleted;
  errors += fileResult.errors;

  // Clean IFC files (3 days)
  const ifcResult = await cleanPrefix("ifc/", ifcCutoff);
  ifcDeleted = ifcResult.deleted;
  errors += ifcResult.errors;

  // Clean Brief-to-Renders inputs (25 days)
  const briefsResult = await cleanPrefix("briefs/", briefsCutoff);
  briefsDeleted = briefsResult.deleted;
  errors += briefsResult.errors;

  return { filesDeleted, ifcDeleted, briefsDeleted, errors };
}

// ─── CORS Configuration ───────────────────────────────────────────────────

/**
 * Ensure the R2 bucket has the correct CORS rules for presigned URL uploads.
 * This must be called at least once; safe to call repeatedly (idempotent).
 *
 * Allows PUT/GET/HEAD/DELETE from the production domain and localhost.
 */
export async function ensureBucketCors(
  allowedOrigins?: string[],
): Promise<{ success: boolean; error?: string }> {
  const client = getClient();
  if (!client) return { success: false, error: "R2 not configured" };

  const origins = allowedOrigins ?? [
    "https://trybuildflow.in",
    "https://www.trybuildflow.in",
    "http://localhost:3000",
    "http://localhost:3001",
  ];

  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: BUCKET_NAME,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: origins,
              AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag", "Content-Length", "Content-Type"],
              MaxAgeSeconds: 86400, // 24 hours
            },
          ],
        },
      }),
    );

    return { success: true };
  } catch (err) {
    console.error("[R2] Failed to set CORS:", err);
    return { success: false, error: String(err) };
  }
}

/** Read current CORS configuration from the bucket. */
export async function getBucketCors(): Promise<unknown> {
  const client = getClient();
  if (!client) return null;

  try {
    const result = await client.send(
      new GetBucketCorsCommand({ Bucket: BUCKET_NAME }),
    );
    return result.CORSRules;
  } catch {
    return null;
  }
}

// ─── Chunked Upload (bypasses Vercel 4.5MB body limit) ────────────────────

/**
 * Upload a temp chunk to R2 under `temp/{uploadId}/chunk-{index}`.
 * Each chunk should be ≤ 4MB. Assembled later by `assembleAndUploadVideo`.
 */
export async function uploadTempChunk(
  uploadId: string,
  chunkIndex: number,
  buffer: Buffer,
): Promise<{ success: boolean; error?: string }> {
  const client = getClient();
  if (!client) return { success: false, error: "R2 not configured" };

  const key = `temp/${uploadId}/chunk-${String(chunkIndex).padStart(4, "0")}`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: "application/octet-stream",
      }),
    );
    return { success: true };
  } catch (err) {
    console.error("[R2] Chunk upload failed:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Download all temp chunks, concatenate, and upload as a single video.
 * Cleans up temp chunks afterward (fire-and-forget).
 */
export async function assembleAndUploadVideo(
  uploadId: string,
  totalChunks: number,
  filename: string,
): Promise<UploadResult | UploadError> {
  const client = getClient();
  if (!client) return { success: false, error: "R2 not configured" };

  // Download all chunks in parallel
  const chunkPromises = Array.from({ length: totalChunks }, async (_, i) => {
    const key = `temp/${uploadId}/chunk-${String(i).padStart(4, "0")}`;
    const result = await client.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Empty chunk ${i}`);
    return Buffer.from(bytes);
  });

  let chunks: Buffer[];
  try {
    chunks = await Promise.all(chunkPromises);
  } catch (err) {
    console.error("[R2] Chunk download failed:", err);
    return { success: false, error: `Failed to read chunks: ${err}` };
  }

  const fullBuffer = Buffer.concat(chunks);
  const result = await uploadVideoToR2(fullBuffer, filename);

  // Clean up temp chunks (fire-and-forget)
  cleanupTempChunks(client, uploadId, totalChunks).catch(() => {});

  return result;
}

async function cleanupTempChunks(
  client: S3Client,
  uploadId: string,
  totalChunks: number,
): Promise<void> {
  await Promise.allSettled(
    Array.from({ length: totalChunks }, (_, i) => {
      const key = `temp/${uploadId}/chunk-${String(i).padStart(4, "0")}`;
      return client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    }),
  );
}

// ─── Targeted Deletion ────────────────────────────────────────────────────

/**
 * Best-effort: parse a public R2 URL (custom domain, r2.dev URL, or our
 * /r2-models//r2-textures/ Next.js rewrites) and return the underlying
 * object key. Returns null if the URL doesn't look like an R2 object we own.
 */
export function extractR2KeyFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  // Ignore data URIs
  if (url.startsWith("data:")) return null;
  try {
    // Relative path style from next.config.ts rewrites:
    //   /r2-models/foo.glb   → models/foo.glb
    //   /r2-textures/foo.jpg → textures/foo.jpg
    // (rewrite source/destination is in next.config.ts)
    if (url.startsWith("/r2-models/")) {
      const tail = url.slice("/r2-models/".length).split("?")[0];
      return tail ? `models/${tail}` : null;
    }
    if (url.startsWith("/r2-textures/")) {
      const tail = url.slice("/r2-textures/".length).split("?")[0];
      return tail ? `textures/${tail}` : null;
    }
    if (url.startsWith("/r2-")) {
      // Generic fallback for any future /r2-<prefix>/ rewrite — strip the
      // leading /r2- and treat the next segment as the prefix.
      const m = /^\/r2-([^/]+)\/(.+)$/.exec(url.split("?")[0]);
      if (m) return `${m[1]}/${m[2]}`;
      return null;
    }
    const parsed = new URL(url);
    // Custom public URL
    if (PUBLIC_URL && url.startsWith(PUBLIC_URL)) {
      return parsed.pathname.replace(/^\/+/, "") || null;
    }
    // r2.dev URLs: https://<bucket>.<accountid>.r2.dev/<key>
    if (parsed.hostname.endsWith(".r2.dev") || parsed.hostname.endsWith(".r2.cloudflarestorage.com")) {
      // path-style: /<bucket>/<key>
      const path = parsed.pathname.replace(/^\/+/, "");
      if (path.startsWith(`${BUCKET_NAME}/`)) return path.slice(BUCKET_NAME.length + 1) || null;
      return path || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Delete a single object from R2 by key. Best-effort: returns true on
 * success, false on failure. Never throws — callers should not gate critical
 * paths on this.
 */
export async function deleteFromR2(key: string): Promise<boolean> {
  const client = getClient();
  if (!client || !key) return false;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    return true;
  } catch (err) {
    console.warn("[r2/deleteFromR2] failed for key", key, err);
    return false;
  }
}

/**
 * Delete many R2 objects by key in parallel. Returns counts.
 * Failures are swallowed per-key — never throws.
 */
export async function deleteManyFromR2(keys: string[]): Promise<{ deleted: number; failed: number }> {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (unique.length === 0) return { deleted: 0, failed: 0 };
  const results = await Promise.allSettled(unique.map((k) => deleteFromR2(k)));
  let deleted = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) deleted++;
    else failed++;
  }
  return { deleted, failed };
}

// ─── Storage Info ──────────────────────────────────────────────────────────

interface StorageInfo {
  files: { count: number; sizeMB: string };
  ifc: { count: number; sizeMB: string };
  briefs: { count: number; sizeMB: string };
  totalSizeMB: string;
}

/** Get current storage usage split by category. */
export async function getStorageInfo(): Promise<StorageInfo | null> {
  const client = getClient();
  if (!client) return null;

  async function countPrefix(prefix: string) {
    let count = 0;
    let sizeBytes = 0;
    let continuationToken: string | undefined;

    do {
      const listResult = await client!.send(
        new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );

      for (const obj of listResult.Contents ?? []) {
        count++;
        sizeBytes += obj.Size ?? 0;
      }

      continuationToken = listResult.IsTruncated
        ? listResult.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return { count, sizeBytes };
  }

  const [filesInfo, ifcInfo, briefsInfo] = await Promise.all([
    countPrefix("files/"),
    countPrefix("ifc/"),
    countPrefix("briefs/"),
  ]);

  return {
    files: { count: filesInfo.count, sizeMB: (filesInfo.sizeBytes / 1024 / 1024).toFixed(2) },
    ifc: { count: ifcInfo.count, sizeMB: (ifcInfo.sizeBytes / 1024 / 1024).toFixed(2) },
    briefs: { count: briefsInfo.count, sizeMB: (briefsInfo.sizeBytes / 1024 / 1024).toFixed(2) },
    totalSizeMB: ((filesInfo.sizeBytes + ifcInfo.sizeBytes + briefsInfo.sizeBytes) / 1024 / 1024).toFixed(2),
  };
}
