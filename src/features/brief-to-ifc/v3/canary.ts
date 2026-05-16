/**
 * Brief-to-IFC v3 canary gate.
 *
 * Single master switch (`BRIEF_TO_IFC_V3_ENABLED`) plus an admin-email
 * override list (`BRIEF_TO_IFC_V3_ADMIN_EMAILS`) — same shape as the
 * Phase 2 brief-to-ifc-v2 canary so the rollout discipline is uniform.
 * v3 is OFF by default; the existing Phase 1 sync + Phase 2 queued
 * paths remain the production code path until Rutik flips this.
 *
 * Surfaced to the client via `GET /api/config/feature-flags` and gated
 * on every v3 API route (POST /api/brief-to-ifc/v3/*).
 */

/** Master switch — `BRIEF_TO_IFC_V3_ENABLED=true` (strict equality). */
export function isBriefToIfcV3MasterEnabled(): boolean {
  return process.env.BRIEF_TO_IFC_V3_ENABLED === "true";
}

/** True when `email` is in the comma-separated `BRIEF_TO_IFC_V3_ADMIN_EMAILS`. */
export function isBriefToIfcV3AdminOverride(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  const raw = process.env.BRIEF_TO_IFC_V3_ADMIN_EMAILS ?? "";
  const allow = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.toLowerCase());
}

/** The decision function — `true` ⇒ this user gets the v3 agent loop. */
export function shouldUseBriefToIfcV3(
  email: string | null | undefined,
): boolean {
  return (
    isBriefToIfcV3MasterEnabled() || isBriefToIfcV3AdminOverride(email)
  );
}
