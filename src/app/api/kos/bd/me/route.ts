/**
 * GET /api/kos/bd/me — Current BD user identity.
 *
 * Returns the safe-to-expose subset of the KosBdUser row plus the
 * resolved tenant slug. Never returns passwordHash. Used by the
 * BD layout shell to discover the signed-in user without re-doing
 * the validation chain.
 */

import { NextResponse, type NextRequest } from "next/server";

import { formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosBdUser } from "@/features/kos/lib/kos-bd-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenantOrThrow(req);
    const bdUser = await requireKosBdUser(req);

    return NextResponse.json({
      id: bdUser.id,
      email: bdUser.email,
      name: bdUser.name,
      role: bdUser.role,
      tenantSlug: tenant.slug,
    });
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
