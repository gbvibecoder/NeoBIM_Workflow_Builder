/**
 * Canary gate for the Brief-to-IFC v2 queued pipeline (Phase 2).
 *
 * A single master switch plus an admin-email override list — deliberately
 * simpler than the multi-signal `brief-renders` canary because there is no
 * per-user beta cohort here, just an on/off rollout flag:
 *
 *   • `BRIEF_TO_IFC_V2_QUEUE_ENABLED=true`  — master switch.
 *   • `BRIEF_TO_IFC_V2_ADMIN_EMAILS`        — comma-separated emails that
 *     get the queued path even while the master switch is off (prod smoke
 *     testing).
 *
 * When the gate is OFF the canvas runs wf-13 through the synchronous
 * Phase 1 node-loop (`/api/execute-node`) exactly as before — the two
 * paths are parallel-alive, so flipping the flag off is a zero-deploy
 * rollback. The same boolean is surfaced to the client via
 * `GET /api/config/feature-flags` so `useExecution` knows which path to
 * take.
 */

/** Master switch — `BRIEF_TO_IFC_V2_QUEUE_ENABLED=true`. */
export function isBriefToIfcV2QueueMasterEnabled(): boolean {
  return process.env.BRIEF_TO_IFC_V2_QUEUE_ENABLED === "true";
}

/** True when `email` is in the `BRIEF_TO_IFC_V2_ADMIN_EMAILS` allowlist. */
export function isBriefToIfcV2AdminOverride(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  const raw = process.env.BRIEF_TO_IFC_V2_ADMIN_EMAILS ?? "";
  const allow = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.toLowerCase());
}

/**
 * The single decision function — `true` ⇒ this user gets the queued
 * pipeline. Used by every server gate (job-creation, status, worker is
 * QStash-authed so it does not gate) and mirrored to the client flag.
 */
export function shouldUseBriefToIfcV2Queue(
  email: string | null | undefined,
): boolean {
  return isBriefToIfcV2QueueMasterEnabled() || isBriefToIfcV2AdminOverride(email);
}
