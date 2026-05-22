/**
 * POST /api/kos/bd/login — BD console sign-in.
 *
 * Tenant-scoped. The bcrypt verification step and the "user not
 * found" branch return the SAME error code (KOS_BD_010) on purpose
 * so an attacker can't enumerate valid BD emails per tenant.
 *
 * Side effects:
 *   • Inserts a fresh KosBdSession row.
 *   • Bumps KosBdUser.lastLoginAt.
 *   • Writes a KosAuditLog row with action="BD_LOGIN".
 *   • Sets the `kos_bd_session` cookie (HttpOnly, SameSite=Lax,
 *     Secure in prod, 30-day Max-Age).
 *
 * Rate-limit: 5 attempts per 15 minutes per IP. Tracks IP, not
 * email — keeps the response cost flat regardless of which email
 * was tried.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit";
import { KosError, formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import {
  buildKosBdSessionCookieHeader,
  createKosBdSession,
  KOS_BD_SESSION_TTL_DAYS,
  verifyKosBdPassword,
} from "@/features/kos/lib/kos-bd-auth";

export const dynamic = "force-dynamic";

const BODY_SCHEMA = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenantOrThrow(req);

    const ip = getClientIp(req);
    const rl = await checkEndpointRateLimit(ip, "kos-bd-login", 5, "15 m");
    if (!rl.success) {
      throw new KosError(
        "KOS_BD_012",
        "Too many BD login attempts from this IP — try again in a few minutes.",
        429,
      );
    }

    let body: z.infer<typeof BODY_SCHEMA>;
    try {
      body = BODY_SCHEMA.parse(await req.json());
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Invalid JSON body for BD login.";
      throw new KosError("KOS_VAL_001", msg, 400);
    }

    const normalizedEmail = body.email.trim().toLowerCase();

    const bdUser = await prisma.kosBdUser.findUnique({
      where: {
        tenantId_email: { tenantId: tenant.id, email: normalizedEmail },
      },
    });

    // Generic credentials error (KOS_BD_010) covers both "no such user"
    // and "wrong password" so an attacker can't tell which one tripped.
    const passwordOk = bdUser
      ? await verifyKosBdPassword(body.password, bdUser.passwordHash)
      : false;

    if (!bdUser || !passwordOk) {
      throw new KosError(
        "KOS_BD_010",
        "Invalid email or password.",
        401,
      );
    }

    if (!bdUser.active) {
      throw new KosError(
        "KOS_BD_011",
        "Account inactive — contact your tenant administrator.",
        403,
      );
    }

    const userAgent = req.headers.get("user-agent");
    const { token } = await createKosBdSession(bdUser.id, ip, userAgent);

    await prisma.kosBdUser.update({
      where: { id: bdUser.id },
      data: { lastLoginAt: new Date() },
    });

    // Audit log — fire-and-forget would also be acceptable; the
    // insert is cheap and we want the row before the response is
    // sent so the audit trail is consistent with the user's
    // perception of "logged in".
    await prisma.kosAuditLog.create({
      data: {
        tenantId: tenant.id,
        actorType: "BD",
        actorId: bdUser.id,
        action: "BD_LOGIN",
        details: { userAgent: userAgent ?? null },
        ipAddress: ip,
      },
    });

    const cookieHeader = buildKosBdSessionCookieHeader({
      value: token,
      maxAgeSeconds: KOS_BD_SESSION_TTL_DAYS * 24 * 60 * 60,
    });

    return NextResponse.json(
      {
        ok: true,
        user: {
          id: bdUser.id,
          email: bdUser.email,
          name: bdUser.name,
          role: bdUser.role,
        },
      },
      {
        status: 200,
        headers: { "Set-Cookie": cookieHeader },
      },
    );
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
