/**
 * KOS BIM (Week 5A) — Autodesk APS OSS bucket management.
 *
 * The pipeline uploads source files into a single APS OSS bucket before
 * translation. `ensureApsBucketExists` is idempotent: it checks for the
 * bucket and creates it only if absent, tolerating the create race. A 409
 * on create means the *global* name is taken by another Autodesk account
 * (bucket keys are global, not account-scoped) — that's a configuration
 * error the operator must fix by changing APS_BUCKET_KEY, so we surface a
 * distinct KOS_APS_003_BUCKET_TAKEN.
 */

import {
  KOS_APS_BASE_URL,
  KOS_APS_BUCKET_KEY,
  KOS_APS_BUCKET_POLICY,
} from "@/features/kos/lib/kos-bim-constants";
import { fetchWithRetry } from "@/features/kos/lib/aps-http";
import { getApsAccessToken } from "@/features/kos/services/aps-auth";
import { KosError } from "@/features/kos/lib/kos-errors";
import type {
  ApsBucketObject,
  KosApsBucketPolicy,
} from "@/features/kos/types/bim";

/**
 * Ensure the APS OSS bucket exists, creating it if necessary. Safe to
 * call before every run — it's a cheap GET when the bucket is already
 * there.
 */
export async function ensureApsBucketExists(
  bucketKey: string = KOS_APS_BUCKET_KEY,
  policy: KosApsBucketPolicy = KOS_APS_BUCKET_POLICY,
): Promise<void> {
  const token = await getApsAccessToken(["bucket:read", "bucket:create"]);

  // ── Step 1: does it already exist? ──────────────────────────────────
  const detailsRes = await fetchWithRetry(
    `${KOS_APS_BASE_URL}/oss/v2/buckets/${encodeURIComponent(bucketKey)}/details`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
    { label: `APS bucket details (${bucketKey})`, exhaustedCode: "KOS_APS_003" },
  );

  if (detailsRes.status === 200) return; // exists — done.

  // 403 here can mean "exists but owned by another app" → treat as taken.
  if (detailsRes.status === 403) {
    const detail = await safeText(detailsRes);
    throw new KosError(
      "KOS_APS_003_BUCKET_TAKEN",
      `APS bucket "${bucketKey}" exists but is not accessible to this app (HTTP 403). Bucket keys are GLOBAL across Autodesk — change APS_BUCKET_KEY to a unique value. APS said: ${detail}`,
      409,
    );
  }

  if (detailsRes.status !== 404) {
    const detail = await safeText(detailsRes);
    throw new KosError(
      "KOS_APS_003",
      `Unexpected HTTP ${detailsRes.status} checking APS bucket "${bucketKey}" details: ${detail}`,
      502,
    );
  }

  // ── Step 2: 404 → create it ─────────────────────────────────────────
  const createRes = await fetchWithRetry(
    `${KOS_APS_BASE_URL}/oss/v2/buckets`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ bucketKey, policyKey: policy }),
    },
    { label: `APS bucket create (${bucketKey})`, exhaustedCode: "KOS_APS_003" },
  );

  if (createRes.status === 200 || createRes.status === 201) return;

  // 409 → name globally taken. Distinct, actionable error.
  if (createRes.status === 409) {
    const detail = await safeText(createRes);
    throw new KosError(
      "KOS_APS_003_BUCKET_TAKEN",
      `APS bucket key "${bucketKey}" is already taken globally (HTTP 409). Bucket keys must be unique across ALL of Autodesk — set APS_BUCKET_KEY to something more specific (e.g. "kos-buildflow-bim-<random>"). APS said: ${detail}`,
      409,
    );
  }

  const detail = await safeText(createRes);
  throw new KosError(
    "KOS_APS_003",
    `Failed to create APS bucket "${bucketKey}" (policy=${policy}): HTTP ${createRes.status} — ${detail}`,
    502,
  );
}

/**
 * List objects in the APS bucket (paginated). Diagnostic helper for
 * inspecting bucket state — not used by the ingestion path itself.
 */
export async function listApsBucketObjects(
  bucketKey: string = KOS_APS_BUCKET_KEY,
  options: { limit?: number; startAt?: string } = {},
): Promise<ApsBucketObject[]> {
  const token = await getApsAccessToken(["bucket:read", "data:read"]);
  const all: ApsBucketObject[] = [];
  let startAt = options.startAt;
  const pageLimit = Math.min(Math.max(options.limit ?? 100, 1), 100);

  // Walk pages until APS stops returning a `next` cursor (or we've pulled
  // `options.limit` total when an explicit cap was given).
  for (;;) {
    const params = new URLSearchParams({ limit: String(pageLimit) });
    if (startAt) params.set("startAt", startAt);

    const res = await fetchWithRetry(
      `${KOS_APS_BASE_URL}/oss/v2/buckets/${encodeURIComponent(
        bucketKey,
      )}/objects?${params.toString()}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      },
      { label: `APS list objects (${bucketKey})`, exhaustedCode: "KOS_APS_003" },
    );

    if (res.status === 404) {
      throw new KosError(
        "KOS_APS_003",
        `APS bucket "${bucketKey}" not found while listing objects — run ensureApsBucketExists first.`,
        404,
      );
    }
    if (!res.ok) {
      const detail = await safeText(res);
      throw new KosError(
        "KOS_APS_003",
        `Failed to list APS bucket "${bucketKey}" objects: HTTP ${res.status} — ${detail}`,
        502,
      );
    }

    const json = (await res.json()) as {
      items?: ApsBucketObject[];
      next?: string;
    };
    if (json.items?.length) all.push(...json.items);

    if (options.limit && all.length >= options.limit) {
      return all.slice(0, options.limit);
    }

    // APS returns `next` as a full URL with a startAt query param.
    const next = json.next;
    if (!next) break;
    try {
      startAt = new URL(next).searchParams.get("startAt") ?? undefined;
    } catch {
      startAt = undefined;
    }
    if (!startAt) break;
  }

  return all;
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 500) || "(empty body)";
  } catch {
    return "(body unreadable)";
  }
}
