/** Meta Pixel (Facebook Pixel) helper utilities */

const META_PIXEL_ID = "1281139750552588";

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
}

/** Track a completed registration */
export function trackCompleteRegistration(params?: Record<string, string | number | boolean>) {
  fbq("track", "CompleteRegistration", params);
}

/** Track a contact form submission */
export function trackContact(params?: Record<string, string | number | boolean>) {
  fbq("track", "Contact", params);
}

/** Track a content view (e.g., viewing a specific workflow or page) */
export function trackViewContent(params?: Record<string, string | number | boolean>) {
  fbq("track", "ViewContent", params);
}

export { META_PIXEL_ID };
