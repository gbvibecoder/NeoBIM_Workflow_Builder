/**
 * Brief-to-Renders canary rollout — allowlist-based access control.
 *
 * Mirrors the VIP canary pattern (`src/features/floor-plan/lib/vip-pipeline/canary.ts`)
 * so every pipeline in this codebase has the same single-flag kill switch.
 *
 * Pure function. No DB calls. Only reads env vars.
 *
 * Master switch:
 *   PIPELINE_BRIEF_RENDERS=true       → feature is potentially visible
 *   PIPELINE_BRIEF_RENDERS unset/false → feature is invisible to everyone
 *
 * Access hierarchy when the master switch is on:
 *   1. BRIEF_RENDERS_ADMIN_OVERRIDE_EMAILS  — always sees the feature
 *   2. BRIEF_RENDERS_BETA_EMAILS            — canary cohort
 *   3. Everyone else                        — no access
 *
 * Phase 6 wires this into:
 *   • the dashboard page server component (404 unknown users)
 *   • the sidebar nav (hide entry from non-canary users)
 *   • the templates page (hide promo card from non-canary users)
 * Existing read sites: `/api/config/feature-flags`, all
 * `/api/brief-renders/**` routes (returns 403 on miss).
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
  if (!_betaEmails) _betaEmails = parseEmailList(process.env.BRIEF_RENDERS_BETA_EMAILS);
  return _betaEmails;
}

function getAdminEmails(): Set<string> {
  if (!_adminEmails) _adminEmails = parseEmailList(process.env.BRIEF_RENDERS_ADMIN_OVERRIDE_EMAILS);
  return _adminEmails;
}

/** Check if user's email is in the brief-renders beta allowlist. */
export function isUserInBriefRendersBeta(email: string | null | undefined): boolean {
  if (!email) return false;
  return getBetaEmails().has(email.toLowerCase());
}

/** Check if user's email is in the admin override list. */
export function isBriefRendersAdminOverride(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().has(email.toLowerCase());
}

/** Master gate — true only if PIPELINE_BRIEF_RENDERS is explicitly "true". */
export function isBriefRendersMasterEnabled(): boolean {
  return process.env.PIPELINE_BRIEF_RENDERS === "true";
}

/**
 * Should this user see Brief-to-Renders?
 *
 * Pure function — no DB calls, no side effects, safe to call from any
 * runtime (edge, node, browser via `/api/config/feature-flags`).
 */
export function shouldUserSeeBriefRenders(
  email: string | null | undefined,
  _userId: string,
): boolean {
  // Master switch must be on
  if (!isBriefRendersMasterEnabled()) return false;

  // Admin override — always sees the feature when master switch on
  if (isBriefRendersAdminOverride(email)) return true;

  // Beta allowlist
  if (isUserInBriefRendersBeta(email)) return true;

  // Everyone else — invisible
  return false;
}

/** Reset cached email lists. Test-only. */
export function _resetBriefRendersCanaryCache(): void {
  _betaEmails = null;
  _adminEmails = null;
}
