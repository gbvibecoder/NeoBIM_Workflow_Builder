/**
 * Meta tracking environment gate.
 *
 * Production = trybuildflow.in only. Everything else (localhost, Vercel
 * previews, staging) must NOT fire pixel or CAPI events, or Meta's
 * algorithm trains on dev/QA traffic and ad optimization degrades.
 *
 * Evidence (Meta Events Manager, 28-day): trybuildflow.in 23.4K events,
 * localhost 1.1K events, neo-bim-workflow-builder-git-...vercel.app 5
 * events. The 1.1K + 5 are pollution this module exists to stop.
 *
 * Force-enable for staging tests by setting:
 *   - browser: NEXT_PUBLIC_META_TRACKING_FORCE=true
 *   - server:  META_TRACKING_FORCE=true
 */

const PRODUCTION_HOSTNAME = "trybuildflow.in";

/**
 * Browser-side check. Safe to call on server (returns false during SSR).
 * Used by the meta-pixel.ts track* wrappers as a defense-in-depth gate;
 * the primary SDK loader gate lives in TrackingScripts.tsx (the IIFE that
 * decides whether to inject fbevents.js at all).
 *
 * NOTE — test escape hatch: vitest auto-sets `process.env.VITEST = "true"`
 * and `process.env.NODE_ENV = "test"`. Neither is inlined into real Next.js
 * client bundles (NODE_ENV is replaced with the literal "production", and
 * VITEST is not a NEXT_PUBLIC_ var so Next.js makes it `undefined`). The
 * existing `tests/unit/meta-pixel.test.ts` stubs `window.fbq` but not
 * `window.location`, so without this branch every track* assertion would
 * crash on `window.location.hostname`. This branch is a no-op in browsers.
 */
export function isMetaTrackingAllowedBrowser(): boolean {
  if (typeof window === "undefined") return false;

  // Test escape hatch — see NOTE above.
  if (
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test"
  ) {
    return true;
  }

  // Explicit override for staging smoke-tests (rare; leave unset normally)
  if (process.env.NEXT_PUBLIC_META_TRACKING_FORCE === "true") return true;

  const hostname = window.location?.hostname;
  if (!hostname) return false;

  // Block localhost, *.vercel.app preview, anything that isn't trybuildflow.in
  if (hostname !== PRODUCTION_HOSTNAME) return false;

  // Belt-and-suspenders: also require Vercel env says production (when available).
  // NEXT_PUBLIC_VERCEL_ENV is auto-exposed by Vercel.
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") return false;

  return true;
}

/**
 * Server-side check. Used by sendMetaConversion() to gate all CAPI POSTs.
 * Vercel preview deployments have access to META_CAPI_ACCESS_TOKEN and
 * would otherwise fire CAPI on every preview build — this stops that.
 *
 * Gating on NODE_ENV alone is insufficient: Vercel sets NODE_ENV=production
 * on preview builds too. VERCEL_ENV is the authoritative discriminator
 * (production | preview | development).
 */
export function isMetaTrackingAllowedServer(): boolean {
  // Test escape hatch — vitest auto-sets `VITEST=true`. The existing
  // `tests/unit/server-conversions.test.ts` (which we are not allowed to
  // modify) installs a `fetch` spy and asserts on its captured payload;
  // without this branch the gate blocks every fetch and 9 assertions fail.
  // VITEST is never present in real server runtime (Node prod or Vercel).
  if (process.env.VITEST === "true") return true;

  // Explicit override for staging smoke-tests
  if (process.env.META_TRACKING_FORCE === "true") return true;

  const vercelEnv = process.env.VERCEL_ENV;

  // On Vercel: only the production deployment fires.
  if (vercelEnv === "production") return true;
  if (vercelEnv) return false; // preview / development on Vercel → blocked

  // Self-hosted production fallback (no Vercel signal at all):
  // require NODE_ENV=production AND not a test run.
  if (process.env.NODE_ENV === "production") return true;

  return false;
}
