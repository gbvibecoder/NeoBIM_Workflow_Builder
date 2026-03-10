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
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

// ─── Config ────────────────────────────────────────────────────────────────

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "";
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "";
const BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "buildflow-files";
const PUBLIC_URL = process.env.R2_PUBLIC_URL ?? ""; // e.g. https://files.yourdomain.com

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB cap for PDFs/XLSX
const MAX_IFC_SIZE = 50 * 1024 * 1024; // 50MB cap for IFC files
const CLEANUP_DAYS_FILES = 25; // PDFs & XLSX
const CLEANUP_DAYS_IFC = 3;   // IFC files (session-like, short-lived)

// ─── Client ────────────────────────────────────────────────────────────────

let _client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) return null;
  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
    });
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
  const uniqueId = Math.random().toString(36).slice(2, 10);
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
  const uniqueId = Math.random().toString(36).slice(2, 10);
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
  const uniqueId = Math.random().toString(36).slice(2, 10);
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

// ─── Cleanup ───────────────────────────────────────────────────────────────

interface CleanupResult {
  filesDeleted: number;
  ifcDeleted: number;
  errors: number;
}

/**
 * Cleanup R2 storage:
 * - `files/` prefix: delete files older than 25 days (PDFs, XLSX)
 * - `ifc/` prefix: delete files older than 3 days
 */
export async function cleanupOldFiles(): Promise<CleanupResult> {
  const client = getClient();
  if (!client) return { filesDeleted: 0, ifcDeleted: 0, errors: 0 };

  const fileCutoff = new Date();
  fileCutoff.setDate(fileCutoff.getDate() - CLEANUP_DAYS_FILES);

  const ifcCutoff = new Date();
  ifcCutoff.setDate(ifcCutoff.getDate() - CLEANUP_DAYS_IFC);

  let filesDeleted = 0;
  let ifcDeleted = 0;
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

      for (const obj of listResult.Contents ?? []) {
        if (!obj.Key || !obj.LastModified) continue;

        if (obj.LastModified < cutoff) {
          try {
            await client!.send(
              new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: obj.Key,
              }),
            );
            deleted++;
          } catch {
            errs++;
          }
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

  console.log(`[R2 Cleanup] files: ${filesDeleted} deleted (>${CLEANUP_DAYS_FILES}d), ifc: ${ifcDeleted} deleted (>${CLEANUP_DAYS_IFC}d), errors: ${errors}`);
  return { filesDeleted, ifcDeleted, errors };
}

// ─── Storage Info ──────────────────────────────────────────────────────────

interface StorageInfo {
  files: { count: number; sizeMB: string };
  ifc: { count: number; sizeMB: string };
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

  const [filesInfo, ifcInfo] = await Promise.all([
    countPrefix("files/"),
    countPrefix("ifc/"),
  ]);

  return {
    files: { count: filesInfo.count, sizeMB: (filesInfo.sizeBytes / 1024 / 1024).toFixed(2) },
    ifc: { count: ifcInfo.count, sizeMB: (ifcInfo.sizeBytes / 1024 / 1024).toFixed(2) },
    totalSizeMB: ((filesInfo.sizeBytes + ifcInfo.sizeBytes) / 1024 / 1024).toFixed(2),
  };
}
