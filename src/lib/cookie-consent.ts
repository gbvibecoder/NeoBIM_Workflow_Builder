/** Cookie consent utility — controls whether tracking scripts load */

const CONSENT_KEY = "buildflow-cookie-consent";

export type ConsentValue = "accepted" | "rejected" | null;

export function getTrackingConsent(): ConsentValue {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CONSENT_KEY) as ConsentValue;
}

export function setTrackingConsent(value: "accepted" | "rejected") {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONSENT_KEY, value);
  window.dispatchEvent(new CustomEvent("cookie-consent-change", { detail: value }));
}

export function hasTrackingConsent(): boolean {
  return getTrackingConsent() === "accepted";
}
