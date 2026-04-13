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

/**
 * SHA-256 hash a string for Google Enhanced Conversions.
 * Uses SubtleCrypto (available in all modern browsers).
 * Returns lowercase hex digest matching Google's spec.
 */
export async function sha256Hash(value: string): Promise<string> {
  if (typeof window === "undefined") return "";
  const normalized = value.trim().toLowerCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Push user data for Google Enhanced Conversions.
 * Hashes email/phone with SHA-256 and pushes to dataLayer
 * so GTM's Enhanced Conversions tag can pick them up.
 */
export async function pushEnhancedConversionData(userData: {
  email?: string;
  phone?: string;
  firstName?: string;
}) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];

  const enhanced: Record<string, string> = {};
  if (userData.email) enhanced.sha256_email_address = await sha256Hash(userData.email);
  if (userData.phone) enhanced.sha256_phone_number = await sha256Hash(userData.phone.replace(/\D/g, ""));
  if (userData.firstName) enhanced.address = JSON.stringify({ sha256_first_name: await sha256Hash(userData.firstName) });

  window.dataLayer.push({ enhanced_conversion_data: enhanced });
}
