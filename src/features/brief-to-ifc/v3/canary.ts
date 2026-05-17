/**
 * Brief-to-IFC v3 canary gate.
 *
 * v3 is the ONLY IFC pipeline as of 2026-05-17 (v2 retired). The flag
 * defaults to ENABLED — set `BRIEF_TO_IFC_V3_ENABLED=false` to disable.
 * The admin-email override list (`BRIEF_TO_IFC_V3_ADMIN_EMAILS`) still
 * exists so we can offer v3 to a specific user even if the master is
 * explicitly disabled during an incident.
 *
 * Surfaced to the client via `GET /api/config/feature-flags` and gated
 * on every v3 API route (POST /api/brief-to-ifc/v3/*).
 */

/** Master switch — defaults to TRUE. Set `BRIEF_TO_IFC_V3_ENABLED=false`
 *  to take v3 down (the only IFC pipeline; expect everyone to lose IFC
 *  generation if you do this). */
export function isBriefToIfcV3MasterEnabled(): boolean {
  return process.env.BRIEF_TO_IFC_V3_ENABLED !== "false";
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
