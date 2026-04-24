import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// ─── Constants ───────────────────────────────────────────────────────────────
export const ADMIN_COOKIE_NAME = "bf_admin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const COOKIE_VERSION = "v2";

// ─── Environment-based Admin Seeding ─────────────────────────────────────────
//
// To set up the initial admin account, configure these environment variables:
//
//   ADMIN_SETUP_USERNAME="your_admin_username"
//   ADMIN_SETUP_PASSWORD="YourSecurePassword123"
//
// On first launch (when no admin accounts exist), the system will create
// a SUPER_ADMIN account using these credentials. After setup, you may
// remove ADMIN_SETUP_PASSWORD from the environment for safety.
//
// If these env vars are not set and no admin account exists, admin login
// will be unavailable until they are configured.
// ─────────────────────────────────────────────────────────────────────────────

/** Ensure at least one admin account exists. Seeds from env vars if none found. */
export async function ensureDefaultAdmin(): Promise<void> {
  const count = await prisma.adminAccount.count();
  if (count === 0) {
    const username = process.env.ADMIN_SETUP_USERNAME;
    const password = process.env.ADMIN_SETUP_PASSWORD;

    if (!username || !password) {
      console.warn(
        "[admin-auth] No admin accounts exist and ADMIN_SETUP_USERNAME / ADMIN_SETUP_PASSWORD are not set. " +
        "Admin login is unavailable until these environment variables are configured."
      );
      return;
    }

    if (password.length < 10) {
      console.error("[admin-auth] ADMIN_SETUP_PASSWORD must be at least 10 characters. Skipping admin seed.");
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    await prisma.adminAccount.create({
      data: {
        username,
        passwordHash: hash,
        displayName: "Super Admin",
        role: "SUPER_ADMIN",
      },
    });
    console.info(`[admin-auth] Seeded initial admin account: ${username}`);
  }
}

// ─── HMAC-signed session cookies ─────────────────────────────────────────────
//
// Admin sessions are stateless: the cookie carries {adminId, issuedAt} signed
// with NEXTAUTH_SECRET. The DB is not consulted for session validity — only to
// confirm the admin still exists and is active. This allows multiple admins
// (or one admin on multiple machines) to be logged in concurrently without
// overwriting each other, which is the bug the v1 (DB-stored token) scheme had.
// ─────────────────────────────────────────────────────────────────────────────

function getSigningSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("[admin-auth] NEXTAUTH_SECRET is required (>=16 chars) to sign admin sessions");
  }
  return secret;
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", getSigningSecret()).update(payload).digest("base64url");
}

/** Produce a signed cookie value for the given admin id. */
export function signAdminSessionCookie(adminId: string): string {
  const issuedAt = Date.now();
  const payload = `${COOKIE_VERSION}.${adminId}.${issuedAt}`;
  return `${payload}.${hmac(payload)}`;
}

/** Verify cookie signature + expiry. Returns adminId or null. */
function verifyAdminSessionCookie(cookieValue: string): { adminId: string } | null {
  const parts = cookieValue.split(".");
  if (parts.length !== 4) return null;
  const [version, adminId, issuedAtStr, sig] = parts;
  if (version !== COOKIE_VERSION || !adminId || !issuedAtStr || !sig) return null;

  const expected = hmac(`${version}.${adminId}.${issuedAtStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return null;
  const ageSeconds = (Date.now() - issuedAt) / 1000;
  if (ageSeconds < 0 || ageSeconds > SESSION_MAX_AGE_SECONDS) return null;

  return { adminId };
}

/** Validate admin credentials against DB. Returns admin info + signed cookie value, or null. */
export async function validateAdminCredentials(
  username: string,
  password: string,
): Promise<{ id: string; username: string; displayName: string; role: string; sessionCookie: string } | null> {
  await ensureDefaultAdmin();

  const admin = await prisma.adminAccount.findUnique({
    where: { username },
    select: { id: true, username: true, displayName: true, role: true, passwordHash: true, isActive: true },
  });

  if (!admin || !admin.isActive) return null;

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) return null;

  await prisma.adminAccount.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  return {
    id: admin.id,
    username: admin.username,
    displayName: admin.displayName,
    role: admin.role,
    sessionCookie: signAdminSessionCookie(admin.id),
  };
}

/** Build Set-Cookie header value for admin session. */
export function getAdminSessionCookie(sessionCookie: string): string {
  const securePart = process.env.NODE_ENV === "production" ? "; secure" : "";
  return `${ADMIN_COOKIE_NAME}=${sessionCookie}; path=/; max-age=${SESSION_MAX_AGE_SECONDS}; samesite=strict; httponly${securePart}`;
}

/** Validate a session cookie: check signature, expiry, and that admin is still active. */
export async function validateAdminSession(
  cookieValue: string,
): Promise<{ id: string; username: string; displayName: string; role: string } | null> {
  const verified = verifyAdminSessionCookie(cookieValue);
  if (!verified) return null;

  const admin = await prisma.adminAccount.findUnique({
    where: { id: verified.adminId },
    select: { id: true, username: true, displayName: true, role: true, isActive: true },
  });

  if (!admin || !admin.isActive) return null;

  return { id: admin.id, username: admin.username, displayName: admin.displayName, role: admin.role };
}

/** Check if a cookie string contains an admin session (client-side presence check only). */
export function isAdminAuthenticated(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.includes(`${ADMIN_COOKIE_NAME}=`);
}
