/**
 * UTM parameter tracking — captures campaign attribution from URL query params
 * and persists them in sessionStorage for the duration of the visit.
 */

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
type UTMKey = typeof UTM_KEYS[number];

export interface UTMParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

const STORAGE_KEY = "buildflow-utm";

/**
 * Parse UTM params from current URL and store in sessionStorage.
 * Call this once on page load (e.g., in a client component or layout effect).
 * Only captures if at least one UTM param is present in the URL.
 */
export function captureUTMParams(): UTMParams | null {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const params: UTMParams = {};
  let hasAny = false;

  for (const key of UTM_KEYS) {
    const value = url.searchParams.get(key);
    if (value) {
      params[key] = value;
      hasAny = true;
    }
  }

  if (hasAny) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch {
      // sessionStorage unavailable (private browsing, etc.)
    }
    return params;
  }

  return null;
}

/**
 * Get stored UTM params (from sessionStorage).
 * Returns null if no UTM params were captured this session.
 */
export function getUTMParams(): UTMParams | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

/**
 * Get UTM params as flat key-value object for analytics event properties.
 * Filters out undefined values.
 */
export function getUTMProperties(): Record<string, string> {
  const params = getUTMParams();
  if (!params) return {};

  const props: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value) props[key] = value;
  }
  return props;
}

/**
 * Clear stored UTM params (e.g., after conversion event).
 */
export function clearUTMParams(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
