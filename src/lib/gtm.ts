/**
 * Google Tag Manager dataLayer utilities.
 *
 * Pushes structured events to window.dataLayer so GTM triggers can fire.
 * Safe to call before GTM loads — events queue in the array and replay
 * once the GTM container initializes.
 *
 * Uses GA4 recommended event names so GTM's built-in GA4 event tag
 * recognizes them automatically (no custom mapping needed).
 */

export function pushToDataLayer(
  event: string,
  params?: Record<string, string | number | boolean | undefined>
) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];

  const data: Record<string, unknown> = { event };
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) data[key] = value;
    }
  }
  window.dataLayer.push(data);
}
