/**
 * KOS — health smoke test (Week 1 acceptance route).
 *
 * Hitting this route proves the entire Week 1 chain works end-to-end:
 *   1. middleware → host parse → header injection (or override header)
 *   2. requireTenantOrThrow → DB lookup → cache populate
 *   3. tenant.s3Config → env var resolution sanity check
 *
 * Test invocations (any of these should return the same JSON shape):
 *   • Production:  GET https://kalzen.trybuildflow.in/api/kos/health
 *   • Local Host:  curl -H "Host: kalzen.trybuildflow.in" http://localhost:3000/api/kos/health
 *   • Local hdr:   curl -H "x-kos-tenant-slug-override: kalzen" http://localhost:3000/api/kos/health
 *
 * Expected response:
 *   {
 *     "ok": true,
 *     "tenant": { "slug": "kalzen", "name": "Kalzen Realty" },
 *     "db": "connected",
 *     "s3": "configured" | "missing",
 *     "timestamp": "2026-..."
 *   }
 *
 * The `s3` check intentionally does NOT round-trip to AWS — it only
 * verifies that the env var named in `tenant.s3Config.accessKeyRef`
 * resolves to a non-empty value. That keeps the health check cheap
 * and side-effect-free (no AWS API calls, no log noise) while still
 * surfacing the most common misconfiguration.
 */

import { NextResponse } from "next/server";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { formatKosErrorResponse } from "@/features/kos/lib/kos-errors";

interface S3ConfigShape {
  accessKeyRef?: string;
  secretKeyRef?: string;
}

function checkS3Configured(s3Config: unknown): "configured" | "missing" {
  if (!s3Config || typeof s3Config !== "object") return "missing";
  const cfg = s3Config as S3ConfigShape;
  if (!cfg.accessKeyRef || !cfg.secretKeyRef) return "missing";
  const access = process.env[cfg.accessKeyRef];
  const secret = process.env[cfg.secretKeyRef];
  return access && secret ? "configured" : "missing";
}

export async function GET(req: Request) {
  try {
    const tenant = await requireTenantOrThrow(req);

    return NextResponse.json({
      ok: true,
      tenant: { slug: tenant.slug, name: tenant.name },
      db: "connected",
      s3: checkS3Configured(tenant.s3Config),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
