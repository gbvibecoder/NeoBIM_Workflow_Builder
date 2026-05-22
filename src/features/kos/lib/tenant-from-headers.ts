/**
 * Resolve the active tenant inside a Server Component / page from the
 * request headers (no `NextRequest` in hand). Mirrors the resolution
 * order used by `(kos)/layout.tsx` and `requireTenantOrThrow`:
 *   1. `x-kos-tenant-slug` header injected by middleware (prod path).
 *   2. Dev-only override header.
 *   3. Direct Host-header parse.
 *
 * Returns the Tenant row or null. Server-only (imports `next/headers`).
 */

import { headers } from "next/headers";
import type { Tenant } from "@prisma/client";

import {
  KOS_TENANT_HEADER,
  KOS_TENANT_OVERRIDE_HEADER,
  resolveTenantSlugFromHost,
} from "@/features/kos/lib/tenant-host";
import { getTenantBySlug } from "@/features/kos/lib/tenant-resolver";

export async function getTenantFromRequestHeaders(): Promise<Tenant | null> {
  const h = await headers();
  let slug: string | null = h.get(KOS_TENANT_HEADER);
  if (!slug && process.env.NODE_ENV !== "production") {
    slug = h.get(KOS_TENANT_OVERRIDE_HEADER);
  }
  if (!slug) {
    slug = resolveTenantSlugFromHost(h.get("host"));
  }
  if (!slug) return null;
  return getTenantBySlug(slug);
}
