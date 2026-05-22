/**
 * KOS BD console authentication.
 *
 * Mirrors the spirit of `src/lib/admin-auth.ts` (bcrypt password,
 * bcrypt session-token hashing, lastLoginAt tracking) but with two
 * deliberate divergences:
 *
 *   1. DB-stored sessions (one row per active sign-in) instead of
 *      admin-auth's HMAC stateless cookie. BD users need multi-device
 *      access + per-device revoke, which a stateless cookie cannot
 *      offer without separate revocation infrastructure.
 *
 *   2. Token format is `${bdUserId}.${base64url(randomBytes(32))}` so
 *      the validation lookup can scope to that user's small set of
 *      active sessions (typically 1-5). Without the userId prefix,
 *      validating a cookie would mean bcrypt-comparing against every
 *      active KosBdSession row in the tenant — O(N) bcrypts at 12
 *      rounds each. With the prefix it stays O(per-user-sessions).
 *
 *      A leaked cookie still cannot impersonate the user without the
 *      random suffix (the userId by itself is not a credential), and
 *      a leaked DB row alone cannot either — the cookie carries the
 *      raw token; the DB stores only its bcrypt hash.
 *
 * Multi-tenancy: every BD lookup scopes by `tenantId` (read from
 * `requireTenantOrThrow`). A BD user belonging to tenant A cannot
 * sign in under tenant B's host even if they swap cookies, because
 * we re-check the bdUser.tenantId against the resolved tenant on
 * every `getKosBdUserFromRequest` call.
 */

// NOTE: this module reads `prisma`, hashes passwords, and reads
// cookies — all server-only by construction. We avoid `import
// "server-only"` because that package isn't in this repo's deps;
// Next.js's per-segment server/client boundary catches mis-imports.

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import type { KosBdUser, KosBdRole } from "@prisma/client";

import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";

// ─── Constants ────────────────────────────────────────────────────────

export const KOS_BD_SESSION_COOKIE_NAME = "kos_bd_session";
export const KOS_BD_SESSION_TTL_DAYS = 30;

const BCRYPT_COST = 12;

// ─── Password hashing ─────────────────────────────────────────────────

export async function hashKosBdPassword(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length < 8) {
    throw new KosError(
      "KOS_BD_020",
      `BD password must be at least 8 characters; got ${plaintext?.length ?? 0}.`,
      400,
    );
  }
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

export async function verifyKosBdPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

// ─── Session token helpers ────────────────────────────────────────────

/**
 * Generate an opaque session token of the form
 *   `${bdUserId}.${base64url(randomBytes(32))}`.
 *
 * The userId prefix scopes the bcrypt verification step to that
 * user's small set of active sessions; the random suffix is the
 * actual entropy that the bcrypt hash protects.
 */
export function generateKosBdSessionToken(bdUserId: string): string {
  if (!bdUserId) {
    throw new KosError(
      "KOS_BD_021",
      "Cannot generate session token without a bdUserId.",
      500,
    );
  }
  const random = crypto.randomBytes(32).toString("base64url");
  return `${bdUserId}.${random}`;
}

/** Parse the bdUserId out of a token; returns null on malformed input. */
function parseBdUserIdFromToken(token: string | null | undefined): string | null {
  if (!token || typeof token !== "string") return null;
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0 || dotIndex >= token.length - 1) return null;
  return token.slice(0, dotIndex);
}

export async function hashKosBdSessionToken(token: string): Promise<string> {
  return bcrypt.hash(token, BCRYPT_COST);
}

// ─── Session CRUD ─────────────────────────────────────────────────────

/**
 * Create a new KosBdSession row for `bdUserId` and return the raw
 * token (for the caller to set as a cookie) plus the expiry.
 *
 * The raw token is never returned again after this call — only its
 * bcrypt hash is stored.
 */
export async function createKosBdSession(
  bdUserId: string,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateKosBdSessionToken(bdUserId);
  const tokenHash = await hashKosBdSessionToken(token);
  const expiresAt = new Date(
    Date.now() + KOS_BD_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.kosBdSession.create({
    data: {
      bdUserId,
      tokenHash,
      expiresAt,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * Validate a raw session token. Returns the owning KosBdUser on
 * success, or null if the token is malformed, expired, revoked, or
 * doesn't match any active session.
 *
 * Does NOT enforce tenant scope — the caller (typically
 * `getKosBdUserFromRequest`) re-checks `bdUser.tenantId` against the
 * resolved tenant. Splitting these concerns keeps this function pure
 * "does this token map to a live user" and callable from any context.
 */
export async function validateKosBdSessionToken(
  token: string,
): Promise<KosBdUser | null> {
  const bdUserId = parseBdUserIdFromToken(token);
  if (!bdUserId) return null;

  const now = new Date();
  const sessions = await prisma.kosBdSession.findMany({
    where: {
      bdUserId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    include: { bdUser: true },
    orderBy: { createdAt: "desc" },
    // Soft cap — a single user with >50 active sessions is suspicious
    // and we should not pay an unbounded bcrypt cost in any case.
    take: 50,
  });

  for (const session of sessions) {
    const match = await bcrypt.compare(token, session.tokenHash);
    if (match) {
      if (!session.bdUser.active) return null;
      return session.bdUser;
    }
  }

  return null;
}

/** Mark a session as revoked. Idempotent — already-revoked tokens no-op. */
export async function revokeKosBdSession(token: string): Promise<void> {
  const bdUserId = parseBdUserIdFromToken(token);
  if (!bdUserId) return;

  const sessions = await prisma.kosBdSession.findMany({
    where: { bdUserId, revokedAt: null },
    select: { id: true, tokenHash: true },
    take: 50,
  });

  for (const session of sessions) {
    const match = await bcrypt.compare(token, session.tokenHash);
    if (match) {
      await prisma.kosBdSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      return;
    }
  }
}

// ─── Request-level helpers ────────────────────────────────────────────

function readCookieFromRequest(
  req: Request | NextRequest,
  name: string,
): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  // RFC 6265 cookie parsing — split on `;`, trim, key=value.
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Resolve the active BD user for a request, or null if no valid
 * session cookie is present. Enforces tenant scope: a session token
 * whose bdUser belongs to a different tenant than the resolved
 * request tenant is treated as invalid (returns null).
 */
export async function getKosBdUserFromRequest(
  req: Request | NextRequest,
): Promise<KosBdUser | null> {
  const token = readCookieFromRequest(req, KOS_BD_SESSION_COOKIE_NAME);
  if (!token) return null;

  const bdUser = await validateKosBdSessionToken(token);
  if (!bdUser) return null;

  // Cross-tenant guard. If `requireTenantOrThrow` cannot resolve a
  // tenant for this request, the auth check itself fails — surface
  // null rather than letting the caller silently get a BD user from
  // some other tenant.
  let tenantId: string;
  try {
    const tenant = await requireTenantOrThrow(req);
    tenantId = tenant.id;
  } catch {
    return null;
  }

  if (bdUser.tenantId !== tenantId) return null;
  return bdUser;
}

/** Throws KOS_BD_001 (401) if no BD user is authenticated. */
export async function requireKosBdUser(
  req: Request | NextRequest,
): Promise<KosBdUser> {
  const bdUser = await getKosBdUserFromRequest(req);
  if (!bdUser) {
    throw new KosError(
      "KOS_BD_001",
      "BD authentication required — sign in at /bd/login.",
      401,
    );
  }
  return bdUser;
}

/**
 * Require an authenticated BD user whose role is in `allowedRoles`.
 * Throws KOS_BD_001 (401) if not authenticated; KOS_BD_002 (403) if
 * authenticated but the role is insufficient.
 */
export async function requireKosBdRole(
  req: Request | NextRequest,
  allowedRoles: KosBdRole[],
): Promise<KosBdUser> {
  const bdUser = await requireKosBdUser(req);
  if (!allowedRoles.includes(bdUser.role)) {
    throw new KosError(
      "KOS_BD_002",
      `Insufficient role — this action requires one of: ${allowedRoles.join(", ")}. Your role: ${bdUser.role}.`,
      403,
    );
  }
  return bdUser;
}

// ─── Cookie header helpers ────────────────────────────────────────────

interface BuildCookieOptions {
  /** Cookie value. Pass empty string to clear the cookie. */
  value: string;
  /** Max-Age in seconds. Pass 0 to clear. */
  maxAgeSeconds: number;
}

export function buildKosBdSessionCookieHeader(opts: BuildCookieOptions): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const parts = [
    `${KOS_BD_SESSION_COOKIE_NAME}=${encodeURIComponent(opts.value)}`,
    "Path=/",
    `Max-Age=${opts.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  return parts.join("; ") + secure;
}
