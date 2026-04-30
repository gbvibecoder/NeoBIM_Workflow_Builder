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

  const granted = value === "accepted";

  // Google Consent Mode v2 — GTM, GA4, and Google Ads listen for this
  window.gtag?.("consent", "update", {
    analytics_storage: granted ? "granted" : "denied",
    ad_storage: granted ? "granted" : "denied",
    ad_user_data: granted ? "granted" : "denied",
    ad_personalization: granted ? "granted" : "denied",
  });

  // Meta Pixel privacy — toggle Limited Data Use instead of revoking the
  // pixel entirely. `consent revoke` would hard-block every event and
  // make Meta's pixel verifier report "A pixel wasn't detected"; LDU keeps
  // events flowing while signaling reduced data processing rights. Accept
  // clears LDU (full data use); reject keeps LDU on.
  window.fbq?.("dataProcessingOptions", granted ? [] : ["LDU"], 0, 0);

  window.dispatchEvent(new CustomEvent("cookie-consent-change", { detail: value }));
}

export function hasTrackingConsent(): boolean {
  return getTrackingConsent() === "accepted";
}
