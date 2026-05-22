/**
 * KOS BIM (Week 5A) — single source of truth for the Autodesk APS
 * ingestion pipeline. Endpoints, polling cadence, OAuth scopes, and the
 * env-derived limits all live here so a credential rotation or a policy
 * change is one edit, not a grep.
 *
 * SECRET HYGIENE: this module reads the *non-secret* APS config (bucket
 * key, policy, size limits) from env at import time. The CLIENT_ID /
 * CLIENT_SECRET are NEVER read here — `aps-auth.ts` reads them lazily at
 * the moment of the token request so they can't leak into a constant
 * that might be logged.
 */

import type { KosApsBucketPolicy } from "@/features/kos/types/bim";

// ─── APS REST endpoints ────────────────────────────────────────────────

export const KOS_APS_BASE_URL = "https://developer.api.autodesk.com";
export const KOS_APS_AUTH_URL =
  "https://developer.api.autodesk.com/authentication/v2/token";

// ─── Bucket config (non-secret, env-driven) ────────────────────────────

/**
 * APS OSS bucket key. Globally unique across all of Autodesk; lowercase
 * alphanumeric + hyphens only. A 409 on create means the name is taken —
 * change `APS_BUCKET_KEY`.
 */
export const KOS_APS_BUCKET_KEY =
  process.env.APS_BUCKET_KEY ?? "kos-buildflow-bim-dev";

/** transient (24h) | temporary (30d) | persistent. Default transient. */
export const KOS_APS_BUCKET_POLICY: KosApsBucketPolicy = ((): KosApsBucketPolicy => {
  const raw = (process.env.APS_BUCKET_POLICY ?? "transient").trim().toLowerCase();
  if (raw === "temporary" || raw === "persistent") return raw;
  return "transient";
})();

// ─── Test-mode limits ───────────────────────────────────────────────────

/** Week 5A test phase processes at most this many files per run. */
export const KOS_BIM_TEST_FILE_LIMIT = 5;

/** True when KOS_BIM_TEST_MODE is explicitly "true". */
export const KOS_BIM_TEST_MODE = process.env.KOS_BIM_TEST_MODE === "true";

/**
 * APS hard upload ceiling (~200 MB). Files larger than this are rejected
 * before upload so we never burn an upload + translation on a doomed file.
 */
export const KOS_BIM_MAX_FILE_SIZE_MB = (() => {
  const parsed = Number(process.env.KOS_BIM_MAX_FILE_SIZE_MB);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 200;
})();

export const KOS_BIM_MAX_FILE_SIZE_BYTES =
  KOS_BIM_MAX_FILE_SIZE_MB * 1024 * 1024;

/** Local Dincel/Kalzen package root (the folder of family subfolders). */
export const KOS_BIM_LOCAL_PACKAGE_PATH =
  process.env.KOS_BIM_LOCAL_PACKAGE_PATH ??
  "/Users/govindbhujbal/Desktop/package_a";

// ─── Signed-S3 multipart upload ─────────────────────────────────────────

/** APS signed-S3 part size. 5 MB is the S3 multipart minimum. */
export const KOS_APS_UPLOAD_PART_SIZE_BYTES = 5 * 1024 * 1024;

/** APS caps a single signed-S3 upload at 10000 parts. */
export const KOS_APS_UPLOAD_MAX_PARTS = 10000;

// ─── Translation polling cadence ────────────────────────────────────────

export const KOS_APS_POLL_INITIAL_DELAY_MS = 5_000;
export const KOS_APS_POLL_MAX_DELAY_MS = 60_000;
/** Hard timeout — give up on a translation after 10 minutes. */
export const KOS_APS_POLL_MAX_DURATION_MS = 600_000;

// ─── OAuth scopes ───────────────────────────────────────────────────────

export const KOS_APS_DEFAULT_SCOPES = [
  "data:read",
  "data:write",
  "data:create",
  "bucket:create",
  "bucket:read",
] as const;

// ─── Supported source extensions ────────────────────────────────────────

export const SUPPORTED_BIM_EXTENSIONS = [
  ".rfa",
  ".dwg",
  ".rvt",
  ".ifc",
] as const;

export type SupportedBimExtension = (typeof SUPPORTED_BIM_EXTENSIONS)[number];

/** MIME type APS expects for each source extension. */
export const KOS_BIM_MIME_BY_EXTENSION: Record<string, string> = {
  ".rfa": "application/octet-stream",
  ".rvt": "application/octet-stream",
  ".dwg": "image/vnd.dwg",
  ".ifc": "application/x-step",
};
