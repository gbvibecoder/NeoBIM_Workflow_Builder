// ─── Admin Authentication (Hardcoded for Beta) ───────────────────────────
// Simple cookie-based auth for admin dashboard
// NOT production-grade — for internal use only during beta

const ADMIN_CREDENTIALS = {
  username: "buildflow_admin",
  password: "Admin@123",
} as const;

const ADMIN_COOKIE_NAME = "bf_admin_session";
const ADMIN_SESSION_TOKEN = "bf_admin_authenticated_2026";

export function validateAdminCredentials(username: string, password: string): boolean {
  return username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password;
}

export function getAdminSessionCookie(): string {
  return `${ADMIN_COOKIE_NAME}=${ADMIN_SESSION_TOKEN}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=strict`;
}

export function isAdminAuthenticated(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.includes(`${ADMIN_COOKIE_NAME}=${ADMIN_SESSION_TOKEN}`);
}

export { ADMIN_COOKIE_NAME, ADMIN_SESSION_TOKEN };
