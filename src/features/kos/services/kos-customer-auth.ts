/**
 * KOS customer (web-chat) authentication.
 *
 * Mirrors the structure of `kos-bd-auth.ts` but for the customer-
 * facing surface (anonymous-first; OTP/phone identity claim lands
 * in Phase 4).
 *
 * Token shape: 32-byte random, base64url-encoded — pure entropy, no
 * userId prefix. Validation iterates every active session whose
 * tokenHash bcrypt-matches the cookie. This is O(N) over active
 * sessions; acceptable for the Phase 3A dev surface (<= a few
 * hundred anonymous guests in the cumulative 30-day window) and
 * documented as a known scale gap.
 */

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import type { KosCustomer } from "@prisma/client";

import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import {
  KOS_CUSTOMER_SESSION_COOKIE,
  KOS_CUSTOMER_SESSION_TTL_MS,
} from "@/features/kos/lib/kos-constants";

const BCRYPT_COST = 12;
const MAX_ACTIVE_SESSIONS_PER_VALIDATE = 1000;

// ─── Token generation + hashing ───────────────────────────────────────

/** 32-byte cryptographic random, base64url-encoded. */
export function generateKosCustomerSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

async function hashCustomerSessionToken(token: string): Promise<string> {
  return bcrypt.hash(token, BCRYPT_COST);
}

// ─── Request helpers ──────────────────────────────────────────────────

function readCookie(req: Request | NextRequest, name: string): string | null {
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

function clientIp(req: Request | NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? null;
}

// ─── Session CRUD ─────────────────────────────────────────────────────

/**
 * Insert a fresh KosCustomerSession row for this customer. Returns
 * the raw cookie value (the caller writes it on the response) plus
 * the row id + expiry.
 */
export async function createKosCustomerSession(
  customerId: string,
  request: Request | NextRequest,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  if (!customerId) {
    throw new KosError(
      "KOS_CHAT_004",
      "createKosCustomerSession requires a non-empty customerId.",
      500,
    );
  }
  const token = generateKosCustomerSessionToken();
  const tokenHash = await hashCustomerSessionToken(token);
  const expiresAt = new Date(Date.now() + KOS_CUSTOMER_SESSION_TTL_MS);

  const userAgent = request.headers.get("user-agent");
  const ipAddress = clientIp(request);

  const row = await prisma.kosCustomerSession.create({
    data: {
      customerId,
      tokenHash,
      expiresAt,
      userAgent: userAgent ?? null,
      ipAddress,
    },
    select: { id: true, expiresAt: true },
  });

  return { token, sessionId: row.id, expiresAt: row.expiresAt };
}

/**
 * Validate a raw cookie token. Returns the owning KosCustomer or
 * null. Iterates active (non-expired) sessions and bcrypt-compares
 * each — O(N) over active sessions but bounded by
 * MAX_ACTIVE_SESSIONS_PER_VALIDATE to keep latency predictable.
 *
 * On hit, bumps `lastUsedAt` on the session row and `lastSeenAt` on
 * the customer.
 */
export async function validateKosCustomerSessionToken(
  token: string,
): Promise<KosCustomer | null> {
  if (!token || typeof token !== "string" || token.length < 16) return null;

  const now = new Date();
  const sessions = await prisma.kosCustomerSession.findMany({
    where: { expiresAt: { gt: now } },
    include: { customer: true },
    orderBy: { createdAt: "desc" },
    take: MAX_ACTIVE_SESSIONS_PER_VALIDATE,
  });

  if (sessions.length === MAX_ACTIVE_SESSIONS_PER_VALIDATE) {
    console.warn(
      `[kos-customer-auth] validate hit MAX_ACTIVE_SESSIONS cap (${MAX_ACTIVE_SESSIONS_PER_VALIDATE}). ` +
        "Add a sha256 index column when this becomes a hot path.",
    );
  }

  for (const session of sessions) {
    let matched = false;
    try {
      matched = await bcrypt.compare(token, session.tokenHash);
    } catch {
      matched = false;
    }
    if (matched) {
      const stamp = new Date();
      await Promise.all([
        prisma.kosCustomerSession.update({
          where: { id: session.id },
          data: { lastUsedAt: stamp },
        }),
        prisma.kosCustomer.update({
          where: { id: session.customer.id },
          data: { lastSeenAt: stamp },
        }),
      ]);
      return session.customer;
    }
  }

  return null;
}

/**
 * Resolve the customer for a request. Returns null if the cookie is
 * missing or invalid, OR if the bound customer belongs to a
 * different tenant than the request resolved to.
 */
export async function getKosCustomerFromRequest(
  request: Request | NextRequest,
  tenantId: string,
): Promise<KosCustomer | null> {
  const token = readCookie(request, KOS_CUSTOMER_SESSION_COOKIE);
  if (!token) return null;
  const customer = await validateKosCustomerSessionToken(token);
  if (!customer) return null;
  if (customer.tenantId !== tenantId) return null;
  return customer;
}

/** Throws KOS_CHAT_001 (401) if no valid customer session is present. */
export async function requireKosCustomer(
  request: Request | NextRequest,
  tenantId: string,
): Promise<KosCustomer> {
  const customer = await getKosCustomerFromRequest(request, tenantId);
  if (!customer) {
    throw new KosError(
      "KOS_CHAT_001",
      "Customer session required — start a session via POST /api/kos/customer/session/start before chatting.",
      401,
    );
  }
  return customer;
}

// ─── Anonymous bootstrap ──────────────────────────────────────────────

/**
 * Phone is the canonical KosCustomer identity in the schema (composite
 * unique [tenantId, phone]) but Phase 3A spins up anonymous guests
 * BEFORE OTP. We mint a synthetic per-row sentinel phone of the
 * form `anon:<cuid>` to satisfy the unique constraint without
 * inventing a fake E.164 number. The Phase 4 OTP claim will UPDATE
 * the row to the real phone and flip isAnonymous to false.
 */
function generateAnonymousPhonePlaceholder(): string {
  // 16 bytes is enough to never collide and short enough to keep
  // analytics queries readable.
  return `anon:${crypto.randomBytes(8).toString("base64url")}`;
}

function generateGuestDisplayName(): string {
  // 6-char base32-ish suffix from a 4-byte random; "Guest-2A8B7K".
  const tail = crypto
    .randomBytes(4)
    .toString("base64url")
    .replace(/[^A-Z0-9]/gi, "")
    .slice(0, 6)
    .toUpperCase();
  return `Guest-${tail || "ANON"}`;
}

/**
 * Create a new anonymous KosCustomer + KosCustomerSession in a single
 * transaction. Returns the customer and the raw cookie token so the
 * caller (POST /session/start) can set Set-Cookie.
 *
 * `firstSeenChannel` is hard-coded to WEB here — Phase 3A is web-
 * chat only; WhatsApp lands in Week 5.
 */
export async function createAnonymousCustomer(
  tenantId: string,
  request: Request | NextRequest,
): Promise<{ customer: KosCustomer; token: string; expiresAt: Date }> {
  if (!tenantId) {
    throw new KosError(
      "KOS_CHAT_005",
      "createAnonymousCustomer requires a non-empty tenantId.",
      500,
    );
  }

  // Up to 3 retries on the tiny chance of a phone-placeholder
  // collision (8 bytes of randomness; collision odds ~ 0 in dev).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const customer = await prisma.kosCustomer.create({
        data: {
          tenantId,
          phone: generateAnonymousPhonePlaceholder(),
          displayName: generateGuestDisplayName(),
          firstSeenChannel: "WEB",
          isAnonymous: true,
        },
      });
      const session = await createKosCustomerSession(customer.id, request);
      return {
        customer,
        token: session.token,
        expiresAt: session.expiresAt,
      };
    } catch (err) {
      // P2002 unique-constraint violation; retry with a fresh
      // placeholder phone. Any other error bubbles.
      if (
        err &&
        typeof err === "object" &&
        (err as { code?: string }).code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new KosError(
    "KOS_CHAT_006",
    "Failed to create anonymous customer after 3 attempts (phone placeholder collisions). This should be statistically impossible — investigate the random source.",
    500,
  );
}

// ─── Cookie header builder ────────────────────────────────────────────

export function buildKosCustomerSessionCookieHeader(opts: {
  value: string;
  maxAgeSeconds: number;
}): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return [
    `${KOS_CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(opts.value)}`,
    "Path=/",
    `Max-Age=${opts.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ") + secure;
}
