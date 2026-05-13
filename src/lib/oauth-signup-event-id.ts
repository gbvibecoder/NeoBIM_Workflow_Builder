/**
 * Deterministic event_id for OAuth signup CAPI / Pixel dedup.
 *
 * Used by BOTH the browser fire (`src/app/onboard/OnboardSignupTracking.tsx`)
 * and the server fire (`src/lib/auth.ts` events.createUser). Both must emit
 * the literal same string, byte-for-byte, or Meta cannot dedup the pair.
 *
 * Isomorphic (no Node / browser deps) so it imports cleanly into both
 * server modules and "use client" components.
 */
export function getOauthSignupEventId(userId: string): string {
  return `signup_oauth_${userId}`;
}
