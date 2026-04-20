/**
 * VIP Canary Rollout — allowlist-based access control.
 *
 * Pure function. No DB calls. Only reads env vars.
 * Master switch: PIPELINE_VIP_JOBS must be "true" for anyone to see VIP.
 *
 * Access hierarchy:
 *   1. Master switch off → nobody
 *   2. Admin override email → yes (testing in production)
 *   3. Beta allowlist email → yes (canary users)
 *   4. Everyone else → no (PIPELINE_REF unchanged)
 */

function parseEmailList(envVar: string | undefined): Set<string> {
  if (!envVar) return new Set();
  return new Set(
    envVar
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

let _betaEmails: Set<string> | null = null;
let _adminEmails: Set<string> | null = null;

function getBetaEmails(): Set<string> {
  if (!_betaEmails) _betaEmails = parseEmailList(process.env.VIP_BETA_EMAILS);
  return _betaEmails;
}

function getAdminEmails(): Set<string> {
  if (!_adminEmails) _adminEmails = parseEmailList(process.env.VIP_ADMIN_OVERRIDE_EMAILS);
  return _adminEmails;
}

/** Check if user's email is in the VIP beta allowlist. */
export function isUserInVipBeta(email: string | null | undefined): boolean {
  if (!email) return false;
  return getBetaEmails().has(email.toLowerCase());
}

/** Check if user's email is in the admin override list. */
export function isAdminOverride(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().has(email.toLowerCase());
}

/**
 * Should this user see VIP? Master gate + allowlist check.
 * Pure function — no DB calls, no side effects.
 */
export function shouldUserSeeVip(
  email: string | null | undefined,
  _userId: string,
): boolean {
  // Master switch must be on
  if (process.env.PIPELINE_VIP_JOBS !== "true") return false;

  // Admin override — always sees VIP when master switch on
  if (isAdminOverride(email)) return true;

  // Beta allowlist
  if (isUserInVipBeta(email)) return true;

  // Everyone else — PIPELINE_REF unchanged
  return false;
}

/** Reset cached email lists (for testing). */
export function _resetCanaryCache(): void {
  _betaEmails = null;
  _adminEmails = null;
}
