/** Meta Pixel (Facebook Pixel) helper utilities */

import { pushToDataLayer } from "./gtm";

const META_PIXEL_ID = "2072969213494487";

type FbqAction = "init" | "track" | "trackCustom" | "consent";
type FbqParams = Record<string, string | number | boolean | undefined>;
type FbqOptions = { eventID?: string };

declare global {
  interface Window {
    fbq: (
      action: FbqAction,
      eventOrId: string,
      params?: FbqParams,
      options?: FbqOptions
    ) => void;
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
  fbq("track", "Lead", params, options);
  pushToDataLayer("generate_lead", params);
}

/** Track a completed registration (requires eventID for server-side dedup) */
export function trackCompleteRegistration(params?: FbqParams, options?: FbqOptions) {
  fbq("track", "CompleteRegistration", params, options);
  pushToDataLayer("sign_up", { ...params, ...(options?.eventID && { event_id: options.eventID }) });
}

/** Track a contact form submission */
export function trackContact(params?: FbqParams, options?: FbqOptions) {
  fbq("track", "Contact", params, options);
  pushToDataLayer("contact_form", params);
}

/** Track a content view (e.g., viewing a specific workflow or page) */
export function trackViewContent(params?: FbqParams, options?: FbqOptions) {
  fbq("track", "ViewContent", params, options);
  pushToDataLayer("view_item", params);
}

/** Track a register page view */
export function trackRegisterPageView() {
  fbq("track", "ViewRegisterPage");
  pushToDataLayer("view_register_page");
}

/** Track a successful purchase/subscription (requires eventID for server-side dedup) */
export function trackPurchase(params?: FbqParams, options?: FbqOptions) {
  fbq("track", "Purchase", params, options);
  pushToDataLayer("purchase", { ...params, ...(options?.eventID && { event_id: options.eventID }) });
}

/** Track intent-to-purchase — fires when user clicks a paid-plan CTA. */
export function trackInitiateCheckout(params?: FbqParams, options?: FbqOptions) {
  fbq("track", "InitiateCheckout", params, options);
  pushToDataLayer("begin_checkout", params);
}

/** Track a returning-user login. Not a Meta standard event — uses trackCustom. */
export function trackLogin(params?: FbqParams) {
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

export { META_PIXEL_ID };
