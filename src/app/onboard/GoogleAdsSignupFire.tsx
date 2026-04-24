"use client";

import { useEffect } from "react";
import { trackAdsConversion } from "@/lib/meta-pixel";
import { pushToDataLayer } from "@/lib/gtm";

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

/**
 * Fires the Google Ads signup conversion for OAuth signups — deferred from
 * /register until /onboard so cancellations and returning-user sign-ins
 * don't inflate the conversion count.
 *
 * Double-gate:
 *  - sessionStorage flag set by /register's "Continue with Google" handler
 *    (proves the user originated from the signup CTA, not /login)
 *  - cookie set by Auth.js events.createUser (proves the PrismaAdapter
 *    actually created a new user row — not a returning Google user)
 *
 * Both flags are always cleared after read to prevent replay on refresh
 * or back-navigation. Env-gated on NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL
 * so the component is a no-op until marketing provides the label.
 */
export function GoogleAdsSignupFire() {
  useEffect(() => {
    const pending = sessionStorage.getItem(SESSION_FLAG);
    const justCreated = readCookie(COOKIE_NAME);

    sessionStorage.removeItem(SESSION_FLAG);
    clearCookie(COOKIE_NAME);

    if (pending !== "1" || justCreated !== "1") return;

    pushToDataLayer("sign_up_complete", { method: "google" });

    const label = process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL;
    if (label) trackAdsConversion(label);
  }, []);

  return null;
}
