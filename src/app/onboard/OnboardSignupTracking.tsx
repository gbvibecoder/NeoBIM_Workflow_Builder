"use client";

import { useEffect } from "react";
import {
  META_CURRENCY,
  META_EVENT_VALUE,
  trackAdsConversion,
  trackCompleteRegistration,
} from "@/lib/meta-pixel";
import { pushToDataLayer } from "@/lib/gtm";
import { getOauthSignupEventId } from "@/lib/oauth-signup-event-id";

const SESSION_FLAG = "pending_google_signup_conversion";
const COOKIE_NAME = "bf_signup_just_created";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : null;
}

function clearCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

interface OnboardSignupUser {
  id: string;
  email: string | null | undefined;
  name: string | null | undefined;
}

/**
 * Fires conversion events for OAuth signups, deferred from /register's Google
 * CTA to /onboard so the browser pixel only counts the same population the
 * server CAPI counts (genuinely new user rows). Firing at click-time would
 * count consent-screen cancellations and returning-user sign-ins, which is
 * exactly what produced the 332-event CompleteRegistration gap.
 *
 * Double gate:
 *  - sessionStorage flag set by /register's Google CTA — proves origin was
 *    the signup page, not /login.
 *  - Cookie set by Auth.js events.createUser — proves the PrismaAdapter
 *    actually inserted a new user row (never set for returning users).
 *
 * Both flags are cleared on read; safe against refresh / back-nav / new tab.
 *
 * Meta Pixel uses eventID `signup_oauth_${user.id}` — MUST byte-for-byte
 * equal the server-side CAPI event_id at `src/lib/auth.ts` events.createUser
 * or browser↔server dedup silently breaks. Single source of truth is
 * `src/lib/oauth-signup-event-id.ts`.
 */

/** Pure side-effect — exported for direct unit testing (vitest env: 'node'
 *  cannot mount React, so the effect body is testable via this function). */
export function runOnboardSignupTracking(user: OnboardSignupUser): void {
  if (typeof window === "undefined") return;

  const pending = window.sessionStorage.getItem(SESSION_FLAG);
  const justCreated = readCookie(COOKIE_NAME);

  window.sessionStorage.removeItem(SESSION_FLAG);
  clearCookie(COOKIE_NAME);

  if (pending !== "1" || justCreated !== "1") return;

  // Meta Pixel — primary conversion event, dedups against server CAPI fire
  // at `src/lib/auth.ts` events.createUser using the same event_id.
  trackCompleteRegistration(
    {
      content_name: "google_signup",
      value: META_EVENT_VALUE.REGISTRATION,
      currency: META_CURRENCY,
      ...(user.email && { user_email: user.email }),
      ...(user.name && { user_name: user.name }),
    },
    { eventID: getOauthSignupEventId(user.id) },
  );

  // GTM dataLayer push — mirrors the credentials path's `sign_up_complete`
  // event so GA4 signup attribution sees the OAuth path too.
  pushToDataLayer("sign_up_complete", { method: "google" });

  // Google Ads conversion — env-gated until marketing provides the label.
  const label = process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL;
  if (label) trackAdsConversion(label);
}

interface OnboardSignupTrackingProps {
  userId: string;
  userEmail: string | null;
  userName: string | null;
}

export function OnboardSignupTracking({
  userId,
  userEmail,
  userName,
}: OnboardSignupTrackingProps) {
  useEffect(() => {
    runOnboardSignupTracking({ id: userId, email: userEmail, name: userName });
    // Empty deps: fire-once on mount. Flag clearing inside
    // runOnboardSignupTracking is the durable guard against re-mount replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
