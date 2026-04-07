/**
 * Next.js instrumentation hook.
 * Runs ONCE per server worker startup (not per request).
 *
 * We use it to validate environment variables on Node.js boot so that any
 * deployment misconfiguration surfaces immediately at startup, not deep
 * inside an API route hours later.
 *
 * Edge runtime is intentionally skipped — env validation happens on the
 * Node.js server, where the app's full set of features run.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./src/lib/env");
    validateEnv();
  }
}
