/**
 * KOS — AWS S3 Mumbai (ap-south-1) client.
 *
 * Separate from BuildFlow's Cloudflare R2 client (`src/lib/r2.ts`) by
 * design — Kalzen documents and customer drawings land in a Kalzen-
 * owned bucket in ap-south-1 (per the locked architecture decision),
 * with independent credentials and lifecycle policies. The two SDKs
 * are the same package (`@aws-sdk/client-s3`), so no new dependency
 * is needed; only the `endpoint` and region differ.
 *
 * Two intentional deviations from `src/lib/r2.ts`:
 *   1. NO data-URI / "graceful fallback" path. The R2 client falls
 *      back to base64 data URIs when unconfigured — that's fine for
 *      a hobby-tier preview render, but dropping a Kalzen source PDF
 *      or a customer drawing on the floor would be a multi-tenant
 *      data integrity bug. Missing creds → throw immediately so the
 *      route handler returns a specific KOS_S3_001 to the caller.
 *   2. NO module-level singleton client. Each tenant has its own
 *      credentials; we build a fresh `S3Client` per tenant on demand.
 *      The cost is negligible (lazy AWS SDK init), and it keeps the
 *      "secrets resolved per-tenant from env" property pure.
 *
 * IMPORTANT — secret hygiene:
 *   `tenant.s3Config` only stores the env var NAMES (`accessKeyRef`,
 *   `secretKeyRef`). The runtime reads `process.env[ref]` here.
 *   Secrets must never round-trip through Postgres.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Tenant } from "@prisma/client";
import { KosError } from "@/features/kos/lib/kos-errors";

/**
 * Shape of `Tenant.s3Config`. Prisma types it as `JsonValue | null`,
 * so we narrow at the boundary and surface a specific error if the
 * tenant row is misconfigured (rather than a generic "undefined is
 * not an object" downstream).
 */
interface KosTenantS3Config {
  bucket: string;
  region: string;
  accessKeyRef: string;
  secretKeyRef: string;
}

function readS3Config(tenant: Tenant): KosTenantS3Config {
  const raw = tenant.s3Config as unknown;
  if (!raw || typeof raw !== "object") {
    throw new KosError(
      "KOS_S3_002",
      `Tenant "${tenant.slug}" has no s3Config — cannot build S3 client. Re-run the tenant seed (\`npm run seed:kos\`) or update the Tenant row to populate { bucket, region, accessKeyRef, secretKeyRef }.`,
      500,
    );
  }
  const cfg = raw as Partial<KosTenantS3Config>;
  const missing: string[] = [];
  if (!cfg.bucket) missing.push("bucket");
  if (!cfg.region) missing.push("region");
  if (!cfg.accessKeyRef) missing.push("accessKeyRef");
  if (!cfg.secretKeyRef) missing.push("secretKeyRef");
  if (missing.length > 0) {
    throw new KosError(
      "KOS_S3_003",
      `Tenant "${tenant.slug}" s3Config is missing required field(s): ${missing.join(", ")}.`,
      500,
    );
  }
  return cfg as KosTenantS3Config;
}

/**
 * Build a configured S3 client for a tenant. Reads the actual access
 * key + secret from env vars named in `tenant.s3Config.{accessKeyRef,
 * secretKeyRef}`. Throws `KOS_S3_001` if either env var is unset —
 * better a loud failure here than a silent 403 from AWS later.
 *
 * Caller is responsible for `client.destroy()` if running outside a
 * long-lived process. In the Next.js runtime each request is a fresh
 * lambda; the client is GC'd with the request.
 */
export function getKosS3Client(tenant: Tenant): S3Client {
  const cfg = readS3Config(tenant);

  const accessKeyId = process.env[cfg.accessKeyRef];
  const secretAccessKey = process.env[cfg.secretKeyRef];

  if (!accessKeyId || !secretAccessKey) {
    const missing: string[] = [];
    if (!accessKeyId) missing.push(cfg.accessKeyRef);
    if (!secretAccessKey) missing.push(cfg.secretKeyRef);
    throw new KosError(
      "KOS_S3_001",
      `S3 credentials not configured for tenant "${tenant.slug}" — missing env var(s): ${missing.join(", ")}. Set these in the Vercel project (production) or .env.local (development) before exercising any KOS storage path.`,
      500,
    );
  }

  const config: S3ClientConfig = {
    region: cfg.region,
    credentials: { accessKeyId, secretAccessKey },
    // NOTE: we deliberately do NOT set `endpoint`. The default AWS
    // endpoint resolution for `region: "ap-south-1"` lands on
    // s3.ap-south-1.amazonaws.com, which is what we want. Setting an
    // explicit endpoint would be needed for R2 (different host) or
    // LocalStack — neither applies here.
  };

  return new S3Client(config);
}

/**
 * Returns the bucket name from tenant config without instantiating a
 * client. Useful for routes that just need to build a key reference
 * (e.g. logging, error messages) without making an SDK call.
 */
export function getKosBucket(tenant: Tenant): string {
  return readS3Config(tenant).bucket;
}

/**
 * Generate a presigned PUT URL for direct browser-to-S3 upload.
 * Modeled on `createPresignedUploadUrl` in `src/lib/r2.ts` but adapted
 * for the strict tenant-scoped, fail-loud KOS contract.
 *
 * Returns `{ uploadUrl, key, publicGetHint }`:
 *   • `uploadUrl`     — the presigned PUT the browser uses.
 *   • `key`           — the S3 object key the upload lands at.
 *   • `publicGetHint` — `s3://{bucket}/{key}` for logs/UI. The KOS
 *                       buckets are private; an actual GET URL must
 *                       be generated separately when serving the file
 *                       (the document viewer route does that — that
 *                       work belongs to Week 2).
 *
 * `expiresIn` defaults to 900 seconds (15 min) — long enough for a
 * mobile upload over a flaky connection, short enough that a leaked
 * URL is useless within the same hour.
 */
export async function createKosPresignedUploadUrl(
  tenant: Tenant,
  key: string,
  contentType: string,
  expiresIn = 900,
): Promise<{ uploadUrl: string; key: string; publicGetHint: string }> {
  if (!key || key.startsWith("/")) {
    throw new KosError(
      "KOS_S3_004",
      `S3 key must be a non-empty string with no leading slash. Got "${key}".`,
      400,
    );
  }

  const bucket = getKosBucket(tenant);
  const client = getKosS3Client(tenant);

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      // Do NOT include Metadata — presigned URLs sign x-amz-meta-*
      // headers which the browser client can't send, causing
      // signature-mismatch failures. Same lesson as `r2.ts`.
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn });

    return {
      uploadUrl,
      key,
      publicGetHint: `s3://${bucket}/${key}`,
    };
  } catch (err) {
    throw new KosError(
      "KOS_S3_005",
      `Failed to presign PUT for s3://${bucket}/${key}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      500,
    );
  }
}

// ─── Week 2 helpers ───────────────────────────────────────────────────

export type KosS3Kind = "documents" | "drawings" | "outputs" | "attachments";

/**
 * Canonical S3 key builder. Pure — no I/O. Keys always start with the
 * kind segment, then the tenantId, then any additional path segments,
 * so a single bucket cleanly hosts multiple tenants and key prefixes
 * stay greppable.
 *
 * Examples:
 *   kosS3Key(t, "documents", docId, "source.pdf")
 *     → "documents/{tenantId}/{docId}/source.pdf"
 *   kosS3Key(t, "outputs", jobId, "report.pdf")
 *     → "outputs/{tenantId}/{jobId}/report.pdf"
 */
export function kosS3Key(
  tenant: Tenant,
  kind: KosS3Kind,
  ...segments: string[]
): string {
  if (!tenant?.id) {
    throw new KosError(
      "KOS_S3_006",
      "kosS3Key called without a resolved tenant — refusing to build an unscoped key.",
      500,
    );
  }
  const cleanSegments = segments.map((s) => {
    if (s == null || s === "") {
      throw new KosError(
        "KOS_S3_007",
        "kosS3Key segments must be non-empty strings — got empty segment.",
        500,
      );
    }
    // Strip leading / trailing slashes; reject any segment containing
    // ".." (path-traversal guard, defence-in-depth even though S3
    // treats keys as flat strings).
    const trimmed = String(s).replace(/^\/+|\/+$/g, "");
    if (trimmed.includes("..")) {
      throw new KosError(
        "KOS_S3_008",
        `kosS3Key segment "${s}" contains ".." — rejected.`,
        400,
      );
    }
    return trimmed;
  });
  return [kind, tenant.id, ...cleanSegments].join("/");
}

/**
 * Server-side direct upload — used by the ingestion worker for
 * derivative artifacts (preview PNGs, extracted text snapshots, etc.).
 *
 * Returns the canonical `{ key, eTag }`. The bucket is implicit from
 * the tenant — callers never specify it.
 */
export async function uploadKosObject(
  tenant: Tenant,
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<{ key: string; eTag: string }> {
  if (!key || key.startsWith("/")) {
    throw new KosError(
      "KOS_S3_004",
      `uploadKosObject: invalid key "${key}" (must be non-empty, no leading slash).`,
      400,
    );
  }
  const bucket = getKosBucket(tenant);
  const client = getKosS3Client(tenant);
  try {
    const result = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    // eTag is wrapped in quotes by the SDK; strip them for callers
    // that want to use it as a comparison value.
    const eTag = (result.ETag ?? "").replace(/^"|"$/g, "");
    return { key, eTag };
  } catch (err) {
    throw new KosError(
      "KOS_S3_009",
      `uploadKosObject failed for s3://${bucket}/${key}: ${
        err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      }`,
      500,
    );
  }
}

/**
 * Presigned GET URL for a KOS object. Used by the BD console to let
 * staff download / view source PDFs without granting AWS credentials
 * to the browser.
 *
 * Default expiry: 5 minutes — long enough for the browser to start a
 * download, short enough that a leaked URL is nearly useless.
 */
export async function createKosPresignedDownloadUrl(
  tenant: Tenant,
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  if (!key || key.startsWith("/")) {
    throw new KosError(
      "KOS_S3_004",
      `createKosPresignedDownloadUrl: invalid key "${key}".`,
      400,
    );
  }
  const bucket = getKosBucket(tenant);
  const client = getKosS3Client(tenant);
  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return await getSignedUrl(client, command, {
      expiresIn: expiresInSeconds,
    });
  } catch (err) {
    throw new KosError(
      "KOS_S3_010",
      `Failed to presign GET for s3://${bucket}/${key}: ${
        err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      }`,
      500,
    );
  }
}

/**
 * Result of a HEAD on an S3 object. Always populated when the object
 * exists; consumers that just need a yes/no should read `.exists` —
 * `if (!head.exists) ...` (not `if (!head)`, since a falsy result is
 * still an object).
 */
export interface KosHeadObjectResult {
  exists: boolean;
  contentLength?: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
}

/**
 * Verify an object exists in S3 and surface its size + content-type.
 * Used by the upload-confirm endpoint to make sure the browser PUT
 * actually landed AND to verify the byte count matches the claimed
 * upload size.
 *
 * Returns `{ exists: true, contentLength, ... }` on 200; `{ exists:
 * false }` on 404 / 403. Throws KosError on any other error (network,
 * region misconfiguration) so the caller gets a specific failure
 * rather than a silent `exists: false`.
 *
 * Note (5I PR 1 extension): previously returned a bare `Promise<boolean>`.
 * All existing callers were migrated to read `.exists` explicitly. If
 * you see a `const exists = await headKosObject(...)` style usage,
 * fix it — `exists` is now an object, and `!exists` is always false.
 */
export async function headKosObject(
  tenant: Tenant,
  key: string,
): Promise<KosHeadObjectResult> {
  const bucket = getKosBucket(tenant);
  const client = getKosS3Client(tenant);
  try {
    const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      exists: true,
      contentLength:
        typeof out.ContentLength === "number" ? out.ContentLength : undefined,
      contentType: out.ContentType ?? undefined,
      lastModified: out.LastModified ?? undefined,
      etag: out.ETag ? out.ETag.replace(/^"|"$/g, "") : undefined,
    };
  } catch (err) {
    // AWS SDK v3 surfaces 404 via `NotFound` / `$metadata.httpStatusCode`.
    const meta = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata;
    const status = meta?.httpStatusCode;
    if (status === 404 || status === 403) return { exists: false };
    throw new KosError(
      "KOS_S3_011",
      `HEAD failed for s3://${bucket}/${key}: ${
        err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      }`,
      500,
    );
  }
}

/**
 * Stream an object out of S3. The body is returned as a Node
 * `ReadableStream` (web-stream API) suitable for direct piping into a
 * Next.js `NextResponse`, or for buffered reads (`await
 * stream.getReader().read()` loops) in the ingestion worker.
 */
export async function streamKosObject(
  tenant: Tenant,
  key: string,
): Promise<{
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number;
}> {
  const bucket = getKosBucket(tenant);
  const client = getKosS3Client(tenant);
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!result.Body) {
      throw new KosError(
        "KOS_S3_012",
        `S3 GET returned no body for s3://${bucket}/${key}.`,
        500,
      );
    }
    // The SDK v3 Body is a stream; .transformToWebStream() is the
    // canonical conversion to a standard ReadableStream.
    const body = (result.Body as {
      transformToWebStream(): ReadableStream<Uint8Array>;
    }).transformToWebStream();
    return {
      body,
      contentType: result.ContentType ?? "application/octet-stream",
      contentLength: Number(result.ContentLength ?? 0),
    };
  } catch (err) {
    if (err instanceof KosError) throw err;
    throw new KosError(
      "KOS_S3_013",
      `GET failed for s3://${bucket}/${key}: ${
        err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      }`,
      500,
    );
  }
}

/**
 * Buffer the entire object into memory. Convenience wrapper around
 * `streamKosObject` for callers that need a Buffer (e.g. pdf-parse
 * which doesn't accept a stream).
 *
 * The caller is responsible for bounding the request size BEFORE
 * calling this — current upload validators cap PDFs at 50 MB, so
 * memory pressure stays bounded.
 */
export async function fetchKosObjectAsBuffer(
  tenant: Tenant,
  key: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const { body, contentType } = await streamKosObject(tenant, key);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const buffer = Buffer.alloc(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { buffer, contentType };
}
