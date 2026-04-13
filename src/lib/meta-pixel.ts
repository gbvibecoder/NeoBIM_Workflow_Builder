/** Meta Pixel (Facebook Pixel) helper utilities */

import { pushToDataLayer } from "./gtm";

const META_PIXEL_ID = "2072969213494487";

declare global {
  interface Window {
    fbq: (
      action: "init" | "track" | "trackCustom",
      eventOrId: string,
      params?: Record<string, string | number | boolean>
    ) => void;
    _fbq: typeof window.fbq;
  }
}

function fbq(
  action: "track" | "trackCustom",
  event: string,
  params?: Record<string, string | number | boolean>
) {
  if (typeof window !== "undefined" && window.fbq) {
    window.fbq(action, event, params ?? {});
  }
}

/** Track a lead generation event (form submissions, workflow requests) */
export function trackLead(params?: Record<string, string | number | boolean>) {
  fbq("track", "Lead", params);
  pushToDataLayer("generate_lead", params);
}

/** Track a completed registration */
export function trackCompleteRegistration(params?: Record<string, string | number | boolean>) {
  fbq("track", "CompleteRegistration", params);
  pushToDataLayer("sign_up", params);
}

/** Track a contact form submission */
export function trackContact(params?: Record<string, string | number | boolean>) {
  fbq("track", "Contact", params);
  pushToDataLayer("contact_form", params);
}

/** Track a content view (e.g., viewing a specific workflow or page) */
export function trackViewContent(params?: Record<string, string | number | boolean>) {
  fbq("track", "ViewContent", params);
  pushToDataLayer("view_item", params);
}

/** Track a register page view */
export function trackRegisterPageView() {
  fbq("track", "ViewRegisterPage");
  pushToDataLayer("view_register_page");
}

/** Track a successful purchase/subscription */
export function trackPurchase(params?: Record<string, string | number | boolean>) {
  fbq("track", "Purchase", params);
  pushToDataLayer("purchase", params);
}

export { META_PIXEL_ID };
