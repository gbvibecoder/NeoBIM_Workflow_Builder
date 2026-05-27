/**
 * POST /api/kos/customer/session/start
 *
 * Public endpoint — it CREATES auth, doesn't require it. Three
 * outcomes:
 *   1. Valid kos_customer_session cookie already present → reuse.
 *   2. Cookie missing or invalid → mint a new anonymous KosCustomer
 *      + KosCustomerSession; set the cookie on the response.
 *   3. Tenant cannot be resolved → KOS_TENANT_001 (400).
 *
 * Side effect: always writes a CUSTOMER_SESSION_START audit row
 * regardless of new-vs-reuse — that's the "session was activated
 * this request" signal downstream analytics will key off.
 */

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { KosError, formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import {
  buildKosCustomerSessionCookieHeader,
  createAnonymousCustomer,
  getKosCustomerFromRequest,
} from "@/features/kos/services/kos-customer-auth";
import {
  KOS_AUDIT,
  KOS_CUSTOMER_SESSION_TTL_DAYS,
} from "@/features/kos/lib/kos-constants";

export const dynamic = "force-dynamic";

function ipFromRequest(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip") ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenantOrThrow(req);

    // Cookie-first: if a valid session already exists, reuse the
    // customer + don't set a new cookie.
    const existing = await getKosCustomerFromRequest(req, tenant.id);
    if (existing) {
      await prisma.kosAuditLog.create({
        data: {
          tenantId: tenant.id,
          actorType: "CUSTOMER",
          actorId: existing.id,
          action: KOS_AUDIT.CUSTOMER_SESSION_START,
          details: { reused: true },
          ipAddress: ipFromRequest(req),
        },
      });
      return NextResponse.json({
        customer: serializeCustomer(existing),
        reused: true,
      });
    }

    // Mint a fresh anonymous customer + session.
    const { customer, token, expiresAt } = await createAnonymousCustomer(
      tenant.id,
      req,
    );

    await prisma.kosAuditLog.create({
      data: {
        tenantId: tenant.id,
        actorType: "CUSTOMER",
        actorId: customer.id,
        action: KOS_AUDIT.CUSTOMER_SESSION_START,
        details: { reused: false, displayName: customer.displayName },
        ipAddress: ipFromRequest(req),
      },
    });

    const cookieHeader = buildKosCustomerSessionCookieHeader({
      value: token,
      maxAgeSeconds: KOS_CUSTOMER_SESSION_TTL_DAYS * 24 * 60 * 60,
    });

    return NextResponse.json(
      {
        customer: serializeCustomer(customer),
        reused: false,
        expiresAt: expiresAt.toISOString(),
      },
      {
        status: 201,
        headers: { "Set-Cookie": cookieHeader },
      },
    );
  } catch (err) {
    if (err instanceof KosError) return formatKosErrorResponse(err);
    return formatKosErrorResponse(err);
  }
}

function serializeCustomer(c: {
  id: string;
  tenantId: string;
  displayName: string | null;
  name: string | null;
  isAnonymous: boolean | null;
  createdAt: Date;
  currentConversationId?: string | null;
}) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    displayName: c.displayName ?? c.name ?? null,
    isAnonymous: c.isAnonymous ?? true,
    createdAt: c.createdAt.toISOString(),
    // 5I PR 4b1 — locator pointer so the chat UI knows which
    // conversation to hydrate on mount. Null until the customer
    // sends their first message (orchestrator updates it then).
    currentConversationId: c.currentConversationId ?? null,
  };
}
