/**
 * Pure host → tenant-slug parser.
 *
 * Split out from `tenant-resolver.ts` because the resolver imports
 * Prisma (Node-only) and `middleware.ts` runs in the edge runtime
 * where Prisma cannot load. This file has zero runtime imports — safe
 * to import from edge code.
 *
 * Mirrors the split pattern used by `src/lib/auth.config.ts` (edge-safe)
 * vs `src/lib/auth.ts` (Node-only with Prisma adapter).
 */

const APEX_HOSTS = new Set([
  "trybuildflow.in",
  "www.trybuildflow.in",
]);

/**
 * Parse a Host header into a tenant slug, or null.
 *
 * Rules:
 *   - `kalzen.trybuildflow.in`        → "kalzen"
 *   - `kalzen.trybuildflow.in:3000`   → "kalzen"   (port stripped)
 *   - `trybuildflow.in` / `www.…`     → null       (apex, not a tenant)
 *   - `kalzen.localhost`              → "kalzen"   (dev only — gated on NODE_ENV)
 *   - `localhost`, `127.0.0.1`, IPs   → null       (use override header in dev)
 *   - anything else                   → null
 *
 * The slug regex `[a-z0-9-]` is intentionally tight — any subdomain
 * that does not match the slug pattern returns null instead of being
 * interpreted as a (non-existent) tenant, so typos can't accidentally
 * route into `/kos/...`.
 */
export function resolveTenantSlugFromHost(
  host: string | null | undefined,
): string | null {
  if (!host) return null;

  const hostname = host.split(":")[0]?.trim().toLowerCase();
  if (!hostname) return null;

  if (APEX_HOSTS.has(hostname)) return null;

  const match = hostname.match(/^([a-z0-9-]+)\.trybuildflow\.in$/);
  if (match) return match[1];

  // Dev convenience: <slug>.localhost — RFC 6761 reserves .localhost
  // for loopback resolution, so this branch can only match traffic
  // originating on the developer's own machine via /etc/hosts.
  // Production builds (NODE_ENV === "production") never take this path.
  if (process.env.NODE_ENV !== "production") {
    const localMatch = hostname.match(/^([a-z0-9-]+)\.localhost$/);
    if (localMatch) return localMatch[1];
  }

  return null;
}

export const KOS_TENANT_HEADER = "x-kos-tenant-slug";
export const KOS_TENANT_OVERRIDE_HEADER = "x-kos-tenant-slug-override";
