/**
 * GET /api/kos/customer/me — current customer identity or 401.
 *
 * Used by the chat client (Phase 3B) to discover whether the user
 * already has a session and what to call them in the UI.
 */

import { NextResponse, type NextRequest } from "next/server";

import { formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosCustomer } from "@/features/kos/services/kos-customer-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenantOrThrow(req);
    const customer = await requireKosCustomer(req, tenant.id);
    return NextResponse.json({
      id: customer.id,
      displayName: customer.displayName ?? customer.name ?? null,
      isAnonymous: customer.isAnonymous,
      tenantSlug: tenant.slug,
    });
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
