/**
 * Brief-to-Renders feature gate — public release with kill switch.
 *
 * Pure function. No DB calls. Only reads env vars.
 *
 * Master switch (kill switch only):
 *   PIPELINE_BRIEF_RENDERS unset / any value other than "false" → ENABLED
 *   PIPELINE_BRIEF_RENDERS="false"                              → DISABLED
 *
 * Default behaviour: visible to every signed-in user. The allowlist
 * cohort gating (`BRIEF_RENDERS_BETA_EMAILS`,
 * `BRIEF_RENDERS_ADMIN_OVERRIDE_EMAILS`) was retired when the feature
 * went GA. The two helpers `isUserInBriefRendersBeta` and
 * `isBriefRendersAdminOverride` are still exported because the same env
 * vars can be re-introduced as a re-gate without code churn — but they
 * are no longer consulted by `shouldUserSeeBriefRenders`.
 *
 * Read sites: dashboard page (`/dashboard/brief-renders`), sidebar nav,
 * templates promo card, `/api/config/feature-flags`, every
 * `/api/brief-renders/**` route.
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

/**
 * Master gate — kill-switch semantics. Returns true unless
 * PIPELINE_BRIEF_RENDERS is explicitly the string "false".
 * Default-on so the feature is live without any env config; flip to
 * "false" for an instant production-wide disable.
 */
export function isBriefRendersMasterEnabled(): boolean {
  return process.env.PIPELINE_BRIEF_RENDERS !== "false";
}

/**
 * Should this user see Brief-to-Renders?
 *
 * Public surface as of GA: every authenticated caller passes through.
 * Per-route auth checks (session?.user?.id) remain the gate against
 * unauthenticated access — this function only governs whether the
 * feature itself is enabled.
 *
 * Pure function — no DB calls, no side effects, safe to call from any
 * runtime (edge, node, browser via `/api/config/feature-flags`).
 */
export function shouldUserSeeBriefRenders(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _email: string | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userId: string,
): boolean {
  return isBriefRendersMasterEnabled();
}

/** Reset cached email lists. Test-only. */
export function _resetBriefRendersCanaryCache(): void {
  _betaEmails = null;
  _adminEmails = null;
}
