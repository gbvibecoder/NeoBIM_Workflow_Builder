/** Meta Pixel (Facebook Pixel) helper utilities */

import { pushToDataLayer } from "./gtm";
import { isMetaTrackingAllowedBrowser } from "./tracking-env";

const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || "2072969213494487";

/**
 * Standard Meta event values — keep browser and server (`server-conversions.ts`)
 * in sync. Currency unified on EUR for ad-platform reporting; per-plan
 * Purchase amounts live in `plan-pricing.ts` (`getPlanValueEUR`).
 *
 * LEAD / REGISTRATION / CONTACT are flat €1 — these aren't revenue, just
 * signals, but Meta requires a numeric `value` + `currency` on every fire
 * (otherwise the "Send valid price and currency information" diagnostic
 * flags 100% of those events).
 */
export const META_EVENT_VALUE = {
  LEAD: 1,
  REGISTRATION: 1,
  CONTACT: 1,
} as const;
export const META_CURRENCY = "EUR" as const;

type FbqParams = Record<string, string | number | boolean | undefined>;
type FbqOptions = { eventID?: string };

/**
 * Enrich pixel params with default value+currency so a caller that forgets
 * to pass them cannot reintroduce Meta's "missing value/currency" diagnostic.
 * Caller-supplied keys win — the spread order is defaults-first.
 *
 * `signalKey` is used for events with a fixed flat value (Lead, Registration,
 * Contact). For revenue events (Purchase, InitiateCheckout) where `value`
 * varies per plan, pass `null` so only `currency` is defaulted.
 */
function withDefaults(
  params: FbqParams | undefined,
  signalKey: keyof typeof META_EVENT_VALUE | null
): FbqParams {
  const defaults: FbqParams = { currency: META_CURRENCY };
  if (signalKey) defaults.value = META_EVENT_VALUE[signalKey];
  return { ...defaults, ...(params ?? {}) };
}

declare global {
  interface Window {
    fbq: {
      (action: "init", pixelId: string, params?: FbqParams): void;
      (action: "track" | "trackCustom", event: string, params?: FbqParams, options?: FbqOptions): void;
      (action: "consent", state: "grant" | "revoke"): void;
      (action: "dataProcessingOptions", options: string[], country?: number, state?: number): void;
    };
    _fbq: typeof window.fbq;
  }
}

function fbq(
  action: "track" | "trackCustom",
  event: string,
  params?: FbqParams,
  options?: FbqOptions
) {
  if (typeof window !== "undefined" && window.fbq) {
    if (options?.eventID) {
      window.fbq(action, event, params ?? {}, options);
    } else {
      window.fbq(action, event, params ?? {});
    }
  }
}

/** Track a lead generation event (form submissions, workflow requests) */
export function trackLead(params?: FbqParams, options?: FbqOptions) {
  if (!isMetaTrackingAllowedBrowser()) return;
  const enriched = withDefaults(params, "LEAD");
  fbq("track", "Lead", enriched, options);
  pushToDataLayer("generate_lead", enriched);
}

/** Track a completed registration (requires eventID for server-side dedup) */
export function trackCompleteRegistration(params?: FbqParams, options?: FbqOptions) {
  if (!isMetaTrackingAllowedBrowser()) return;
  const enriched = withDefaults(params, "REGISTRATION");
  fbq("track", "CompleteRegistration", enriched, options);
  pushToDataLayer("sign_up", { ...enriched, ...(options?.eventID && { event_id: options.eventID }) });
}

/** Track a contact form submission */
export function trackContact(params?: FbqParams, options?: FbqOptions) {
  if (!isMetaTrackingAllowedBrowser()) return;
  const enriched = withDefaults(params, "CONTACT");
  fbq("track", "Contact", enriched, options);
  pushToDataLayer("contact_form", enriched);
}

/** Track a content view (e.g., viewing a specific workflow or page) */
export function trackViewContent(params?: FbqParams, options?: FbqOptions) {
  if (!isMetaTrackingAllowedBrowser()) return;
  fbq("track", "ViewContent", params, options);
  pushToDataLayer("view_item", params);
}

/** Track a register page view */
export function trackRegisterPageView() {
  if (!isMetaTrackingAllowedBrowser()) return;
  fbq("track", "ViewRegisterPage");
  pushToDataLayer("view_register_page");
}

/** Track a successful purchase/subscription (requires eventID for server-side dedup).
 *  Value is variable per plan (see `getPlanValueEUR`) and must come from the
 *  caller; only currency is defaulted here. */
export function trackPurchase(params?: FbqParams, options?: FbqOptions) {
  if (!isMetaTrackingAllowedBrowser()) return;
  const enriched = withDefaults(params, null);
  fbq("track", "Purchase", enriched, options);
  pushToDataLayer("purchase", { ...enriched, ...(options?.eventID && { event_id: options.eventID }) });
}

/** Track intent-to-purchase — fires when user clicks a paid-plan CTA.
 *  Same value-is-caller's-responsibility rule as `trackPurchase`. */
export function trackInitiateCheckout(params?: FbqParams, options?: FbqOptions) {
  if (!isMetaTrackingAllowedBrowser()) return;
  const enriched = withDefaults(params, null);
  fbq("track", "InitiateCheckout", enriched, options);
  pushToDataLayer("begin_checkout", enriched);
}

/** Track a returning-user login. Not a Meta standard event — uses trackCustom. */
export function trackLogin(params?: FbqParams) {
  if (!isMetaTrackingAllowedBrowser()) return;
  fbq("trackCustom", "Login", params);
  pushToDataLayer("login", params);
}

/**
 * Fire a Google Ads conversion. Requires the conversion label from the Ads UI
 * (format: AW-XXXXXXXXXX/abc123XYZ). Pass via env var NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL
 * or NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL so marketing can rotate without code changes.
 */
export function trackAdsConversion(sendTo: string, params?: FbqParams) {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", "conversion", { send_to: sendTo, ...params });
}

/**
 * Read Meta browser identifiers (`_fbp` + `_fbc`) from `document.cookie`.
 * `_fbp` is set by the pixel on PageView; `_fbc` is set when a user lands
 * with a `?fbclid=…` URL parameter from a Meta ad. Forwarding them to the
 * server CAPI payload is how Meta deduplicates browser↔server event pairs
 * and resolves identity. Returns `{}` on SSR or when neither cookie exists.
 */
export function getMetaBrowserIds(): { fbp?: string; fbc?: string } {
  if (typeof document === "undefined") return {};
  const match = (name: string) => {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : undefined;
  };
  return { fbp: match("_fbp"), fbc: match("_fbc") };
}

export { META_PIXEL_ID };
