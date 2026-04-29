/**
 * Brief-to-Renders environment variable validation.
 *
 * Called lazily on first job creation (Phase 3 onward). Throws a
 * descriptive error listing ALL missing vars so the operator can fix
 * them in one pass rather than chasing them one at a time.
 *
 * Mirrors VIP's `validateVipEnvVars` shape so the operational pattern is
 * identical across pipelines.
 *
 * Phase 1 ships the validator but does not invoke it — the upload-brief
 * route only needs R2 credentials, which are checked separately by
 * `isR2Configured()`. Phase 2's spec-extract worker will be the first
 * caller.
 */

const REQUIRED_BRIEF_RENDERS_ENV_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "NEXT_PUBLIC_APP_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

let validated = false;

/**
 * Validates that all env vars required by the Brief-to-Renders pipeline
 * are set. Throws with all missing vars in one error. Caches — runs once
 * per process.
 */
export function validateBriefRendersEnvVars(): void {
  if (validated) return;

  const missing: string[] = [];
  for (const key of REQUIRED_BRIEF_RENDERS_ENV_VARS) {
    if (!process.env[key]) missing.push(key);
  }

  if (missing.length > 0) {
    throw new Error(
      `Brief-to-Renders pipeline misconfigured: missing required env var(s): ${missing.join(", ")}. ` +
        `Set them in your environment or disable PIPELINE_BRIEF_RENDERS.`,
    );
  }

  validated = true;
}

/** Reset the cached validation flag. Test-only. */
export function _resetBriefRendersEnvCheckCache(): void {
  validated = false;
}
