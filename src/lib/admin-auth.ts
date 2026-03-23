import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// ─── Constants ───────────────────────────────────────────────────────────────
export const ADMIN_COOKIE_NAME = "bf_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

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

/** Validate admin credentials against DB. Returns admin account or null. */
export async function validateAdminCredentials(
  username: string,
  password: string,
): Promise<{ id: string; username: string; displayName: string; role: string; sessionToken: string } | null> {
  await ensureDefaultAdmin();

  const admin = await prisma.adminAccount.findUnique({
    where: { username },
    select: { id: true, username: true, displayName: true, role: true, passwordHash: true, isActive: true },
  });

  if (!admin || !admin.isActive) return null;

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) return null;

  // Generate a cryptographically secure session token
  const rawToken = crypto.randomBytes(32).toString("hex");

  // Store a bcrypt hash of the token in the DB (never store plaintext)
  const tokenHash = await bcrypt.hash(rawToken, 10);
  await prisma.adminAccount.update({
    where: { id: admin.id },
    data: { sessionToken: tokenHash, lastLoginAt: new Date() },
  });

  // Return the raw token — this goes into the cookie
  return { id: admin.id, username: admin.username, displayName: admin.displayName, role: admin.role, sessionToken: rawToken };
}

/** Build Set-Cookie header value for admin session */
export function getAdminSessionCookie(adminId: string, sessionToken: string): string {
  const value = `${adminId}:${sessionToken}`;
  const securePart = process.env.NODE_ENV === "production" ? "; secure" : "";
  return `${ADMIN_COOKIE_NAME}=${value}; path=/; max-age=${SESSION_MAX_AGE}; samesite=strict; httponly${securePart}`;
}

/** Parse cookie value into adminId and sessionToken */
export function parseAdminCookie(cookieValue: string): { adminId: string; sessionToken: string } | null {
  const colonIdx = cookieValue.indexOf(":");
  if (colonIdx === -1) return null;
  const adminId = cookieValue.slice(0, colonIdx);
  const sessionToken = cookieValue.slice(colonIdx + 1);
  if (!adminId || !sessionToken) return null;
  return { adminId, sessionToken };
}

/** Validate a session token against the DB (compares raw token vs stored hash) */
export async function validateAdminSession(
  cookieValue: string,
): Promise<{ id: string; username: string; displayName: string; role: string } | null> {
  const parsed = parseAdminCookie(cookieValue);
  if (!parsed) {
    return null;
  }

  const admin = await prisma.adminAccount.findUnique({
    where: { id: parsed.adminId },
    select: { id: true, username: true, displayName: true, role: true, sessionToken: true, isActive: true },
  });

  if (!admin || !admin.isActive || !admin.sessionToken) return null;

  // Compare raw token from cookie against the bcrypt hash in DB
  const tokenValid = await bcrypt.compare(parsed.sessionToken, admin.sessionToken);
  if (!tokenValid) return null;

  return { id: admin.id, username: admin.username, displayName: admin.displayName, role: admin.role };
}

/** Check if a cookie string contains an admin session (client-side check) */
export function isAdminAuthenticated(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.includes(`${ADMIN_COOKIE_NAME}=`);
}
