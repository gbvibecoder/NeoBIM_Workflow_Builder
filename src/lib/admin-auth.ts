import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// ─── Constants ───────────────────────────────────────────────────────────────
export const ADMIN_COOKIE_NAME = "bf_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Default credentials used to seed the first admin account if none exist
const LEGACY_USERNAME = "buildflow_admin";
const LEGACY_PASSWORD = "Admin@123";

// ─── DB-backed Admin Auth ────────────────────────────────────────────────────

/** Ensure at least one admin account exists. Seeds default super admin if none found. */
export async function ensureDefaultAdmin(): Promise<void> {
  const count = await prisma.adminAccount.count();
  if (count === 0) {
    const hash = await bcrypt.hash(LEGACY_PASSWORD, 12);
    await prisma.adminAccount.create({
      data: {
        username: LEGACY_USERNAME,
        passwordHash: hash,
        displayName: "Super Admin",
        role: "SUPER_ADMIN",
      },
    });
  }
}

/** Validate admin credentials against DB. Returns admin account or null. */
export async function validateAdminCredentials(
  username: string,
  password: string,
): Promise<{ id: string; username: string; displayName: string; role: string } | null> {
  await ensureDefaultAdmin();

  const admin = await prisma.adminAccount.findUnique({
    where: { username },
    select: { id: true, username: true, displayName: true, role: true, passwordHash: true, isActive: true },
  });

  if (!admin || !admin.isActive) return null;

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) return null;

  // Generate session token and store it
  const sessionToken = crypto.randomUUID();
  await prisma.adminAccount.update({
    where: { id: admin.id },
    data: { sessionToken, lastLoginAt: new Date() },
  });

  return { id: admin.id, username: admin.username, displayName: admin.displayName, role: admin.role };
}

/** Build Set-Cookie header value for admin session */
export function getAdminSessionCookie(adminId: string, sessionToken: string): string {
  const value = `${adminId}:${sessionToken}`;
  const securePart = process.env.NODE_ENV === "production" ? "; secure" : "";
  return `${ADMIN_COOKIE_NAME}=${value}; path=/; max-age=${SESSION_MAX_AGE}; samesite=strict; httponly${securePart}`;
}

/** Parse cookie value into adminId and sessionToken */
export function parseAdminCookie(cookieValue: string): { adminId: string; sessionToken: string } | null {
  const parts = cookieValue.split(":");
  if (parts.length !== 2) return null;
  return { adminId: parts[0], sessionToken: parts[1] };
}

/** Validate a session token against the DB */
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

  if (!admin || !admin.isActive || admin.sessionToken !== parsed.sessionToken) return null;
  return { id: admin.id, username: admin.username, displayName: admin.displayName, role: admin.role };
}

/** Check if a cookie string contains an admin session (client-side check) */
export function isAdminAuthenticated(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.includes(`${ADMIN_COOKIE_NAME}=`);
}
