/**
 * VIP Pipeline environment variable validation.
 *
 * Called lazily on first VIP job creation (POST /api/vip-jobs).
 * Throws a descriptive error listing ALL missing vars so the
 * operator can fix them in one pass rather than chasing them one-by-one.
 */

const REQUIRED_VIP_ENV_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "QSTASH_TOKEN",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

const RECOMMENDED_VIP_ENV_VARS = [
  "GOOGLE_AI_API_KEY",
] as const;

let validated = false;

/**
 * Validates that all env vars required by the VIP pipeline are set.
 * Throws on missing required vars. Warns on missing recommended vars.
 * Caches result — only runs once per process.
 */
export function validateVipEnvVars(): void {
  if (validated) return;

  const missing: string[] = [];
  for (const key of REQUIRED_VIP_ENV_VARS) {
    if (!process.env[key]) missing.push(key);
  }

  if (missing.length > 0) {
    throw new Error(
      `VIP pipeline misconfigured: missing required env var(s): ${missing.join(", ")}. ` +
      `Set them in your environment or disable PIPELINE_VIP_JOBS.`,
    );
  }

  for (const key of RECOMMENDED_VIP_ENV_VARS) {
    if (!process.env[key]) {
      console.warn(`[VIP] Recommended env var ${key} is not set — Imagen provider will be unavailable`);
    }
  }

  validated = true;
}
