/**
 * POST /api/kos/bd/logout — Revoke the current BD session.
 *
 * Always returns 200 even if the cookie is missing or invalid — the
 * goal is "the user has no usable session after this call", and any
 * variation in error response would let an unauthenticated probe
 * detect whether a session was active.
 */

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { getClientIp } from "@/lib/rate-limit";
import {
  buildKosBdSessionCookieHeader,
  getKosBdUserFromRequest,
  KOS_BD_SESSION_COOKIE_NAME,
  revokeKosBdSession,
} from "@/features/kos/lib/kos-bd-auth";

export const dynamic = "force-dynamic";

function readCookie(req: NextRequest, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenantOrThrow(req);

    // Resolve the BD user BEFORE revoking, so we can write a precise
    // audit entry. If the cookie is missing/invalid this is null and
    // we skip the audit.
    const bdUser = await getKosBdUserFromRequest(req).catch(() => null);

    const token = readCookie(req, KOS_BD_SESSION_COOKIE_NAME);
    if (token) {
      await revokeKosBdSession(token);
    }

    if (bdUser) {
      await prisma.kosAuditLog.create({
        data: {
          tenantId: tenant.id,
          actorType: "BD",
          actorId: bdUser.id,
          action: "BD_LOGOUT",
          ipAddress: getClientIp(req),
        },
      });
    }

    const clearCookie = buildKosBdSessionCookieHeader({
      value: "",
      maxAgeSeconds: 0,
    });

    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { "Set-Cookie": clearCookie } },
    );
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
