/**
 * Validate environment variables on app startup.
 * Logs warnings/errors but does not throw — allows the app to start
 * in degraded mode for development environments.
 */
export function validateEnv() {
  const required = ["DATABASE_URL", "AUTH_SECRET"];
  const recommended = [
    "OPENAI_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ];

  const missing = required.filter((key) => !process.env[key]);
  const missingRecommended = recommended.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`[ENV] CRITICAL — Missing required env vars: ${missing.join(", ")}`);
  }
  if (missingRecommended.length > 0) {
    console.warn(`[ENV] WARNING — Missing recommended env vars: ${missingRecommended.join(", ")}`);
  }
}

// Auto-run on module import (server-side only)
if (typeof window === "undefined") {
  validateEnv();
}
