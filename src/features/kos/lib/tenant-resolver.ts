/**
 * KOS tenant resolver.
 *
 * Three responsibilities:
 *   1. `resolveTenantSlugFromHost(host)` — pure host → slug parser used by
 *      both `middleware.ts` (to inject the `x-kos-tenant-slug` header) and
 *      `requireTenantOrThrow` (as a fallback when middleware did not run,
 *      e.g. direct curl tests).
 *   2. `getTenantBySlug(slug)` — DB lookup with a small in-process LRU
 *      cache. Mirrors the role-cache pattern in `src/lib/auth.ts` —
 *      bounded Map, oldest 20% evicted on overflow, single TTL.
 *   3. `requireTenantOrThrow(req)` — the chokepoint EVERY `/api/kos/*`
 *      route MUST call before any DB query. Reads the
 *      `x-kos-tenant-slug` header (set by middleware) or falls back to
 *      parsing the Host header directly, then resolves the tenant row.
 *      Throws `KosError("KOS_TENANT_001", ..., 400)` if missing/unknown.
 *
 * IMPORTANT: this file imports `prisma` and the Tenant type, which means
 * it MUST NOT be imported from edge-runtime code (middleware). The
 * middleware only needs the pure `resolveTenantSlugFromHost` function,
 * so import that path explicitly from middleware:
 *   import { resolveTenantSlugFromHost } from "@/features/kos/lib/tenant-resolver";
 * That's fine because the function has no DB / Node-only side effects;
 * tree-shaking trims the rest.
 */

import type { NextRequest } from "next/server";
import type { Tenant } from "@prisma/client";
import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import {
  KOS_TENANT_HEADER,
  KOS_TENANT_OVERRIDE_HEADER,
  resolveTenantSlugFromHost,
} from "@/features/kos/lib/tenant-host";

// Re-export so non-edge callers can keep importing from one place.
export { resolveTenantSlugFromHost } from "@/features/kos/lib/tenant-host";

// ─── Tenant cache ─────────────────────────────────────────────────────
//
// Mirrors the role-cache pattern in `src/lib/auth.ts` exactly:
//   - bounded Map (insertion order = age)
//   - on overflow, drop the oldest 20% to amortise eviction cost
//   - single TTL (60s for tenants — slower-moving than user roles)
//
// Multi-tenant correctness: cache misses go to DB; a freshly updated
// tenant row becomes visible within at most TTL seconds in any given
// lambda. Cross-lambda staleness is bounded the same way.

const TENANT_CACHE_TTL_MS = 60_000; // 60 seconds
const TENANT_CACHE_MAX_SIZE = 50;
const TENANT_CACHE_EVICT_RATIO = 0.2;

interface CachedTenant {
  tenant: Tenant | null; // null is cached too, to avoid retry storms on unknown slugs
  cachedAt: number;
}

const tenantCache = new Map<string, CachedTenant>();

function tenantCacheSet(slug: string, tenant: Tenant | null): void {
  tenantCache.set(slug, { tenant, cachedAt: Date.now() });
  if (tenantCache.size > TENANT_CACHE_MAX_SIZE) {
    const deleteCount = Math.max(
      1,
      Math.floor(TENANT_CACHE_MAX_SIZE * TENANT_CACHE_EVICT_RATIO),
    );
    let deleted = 0;
    for (const key of tenantCache.keys()) {
      if (deleted >= deleteCount) break;
      tenantCache.delete(key);
      deleted++;
    }
  }
}

/**
 * Invalidate a single slug's cache entry so the next lookup re-reads
 * the DB. Call this from any code path that updates a Tenant row
 * (branding edits, config rotation, etc.). Serverless is per-instance
 * so this only clears the local lambda's cache — combined with the 60s
 * TTL the staleness window stays bounded.
 */
export function invalidateTenantCache(slug: string): void {
  tenantCache.delete(slug);
}

/**
 * Look up a Tenant row by slug. Cache-hits return synchronously; misses
 * go to Neon and populate the cache. Returns null for unknown slugs
 * (negative caching is intentional — protects against repeated lookups
 * for typos / scanners hitting unknown subdomains).
 */
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const now = Date.now();
  const cached = tenantCache.get(slug);
  if (cached && now - cached.cachedAt < TENANT_CACHE_TTL_MS) {
    return cached.tenant;
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  tenantCacheSet(slug, tenant);
  return tenant;
}

// ─── Tenant required-on-request guard ─────────────────────────────────

/**
 * Resolve the Tenant for a KOS request, or throw a KosError.
 *
 * Resolution order:
 *   1. `x-kos-tenant-slug` header (injected by middleware on hosts that
 *      match a tenant subdomain). This is the production path.
 *   2. Dev-only `x-kos-tenant-slug-override` header (NODE_ENV !== "production"),
 *      so curl tests can pretend to be on `kalzen.trybuildflow.in`
 *      without rewriting Host.
 *   3. Direct Host-header parse — covers the case where the middleware
 *      did not run (e.g. matcher excludes the path).
 *
 * EVERY `/api/kos/*` route MUST call this before touching the DB. It is
 * the single chokepoint that enforces multi-tenant isolation; without
 * it, a query against a KOS table is effectively cross-tenant by
 * default. Treat this as the equivalent of `await auth()` for KOS.
 */
export async function requireTenantOrThrow(
  req: Request | NextRequest,
): Promise<Tenant> {
  const headers = req.headers;
  const isProd = process.env.NODE_ENV === "production";

  let slug: string | null = headers.get(KOS_TENANT_HEADER);

  if (!slug && !isProd) {
    slug = headers.get(KOS_TENANT_OVERRIDE_HEADER);
  }

  if (!slug) {
    slug = resolveTenantSlugFromHost(headers.get("host"));
  }

  if (!slug) {
    throw new KosError(
      "KOS_TENANT_001",
      `Tenant not resolved — no "${KOS_TENANT_HEADER}" header, no dev override, and Host "${headers.get("host") ?? "(missing)"}" does not match a tenant subdomain pattern (expected "<slug>.trybuildflow.in"). If you're testing locally, set the header "${KOS_TENANT_OVERRIDE_HEADER}: kalzen".`,
      400,
    );
  }

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    throw new KosError(
      "KOS_TENANT_002",
      `Tenant slug "${slug}" did not match any row in the Tenant table. Either the slug is wrong or the tenant has not been seeded (run \`npm run seed:kos\` for the Kalzen row).`,
      404,
    );
  }

  return tenant;
}
