"use client";

import { useEffect, useRef } from "react";

// ── Guarded fire helpers ────────────────────────────────────────────────────

function fireFbq(
  action: "track" | "trackCustom",
  event: string,
  params?: Record<string, string | number>,
) {
  if (typeof window !== "undefined" && window.fbq) {
    window.fbq(action, event, params);
  }
}

function fireGtag(event: string, params?: Record<string, string | number>) {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", event, params);
  }
}

// ── Public helpers (importable by other /light components) ──────────────────

export function trackCTAClick(ctaLabel: string, position: string) {
  fireFbq("track", "InitiateCheckout", {
    content_name: ctaLabel,
    position,
  });
  fireGtag("cta_click", { cta_label: ctaLabel, position });
}

export function trackReferralClick(params: {
  authenticated: boolean;
  position: string;
}) {
  fireFbq("trackCustom", "ReferralCTAClick", {
    authenticated: params.authenticated ? "yes" : "no",
    position: params.position,
  });
  fireGtag("referral_cta_click", {
    authenticated: params.authenticated ? "yes" : "no",
    position: params.position,
  });
}

export function trackUseCaseClick(usecase: string) {
  fireFbq("track", "InitiateCheckout", {
    content_name: usecase,
    content_category: "usecase",
  });
  fireGtag("usecase_click", { usecase });
}

// ── Scroll depth tracker (fires once per threshold per session) ─────────────

function useScrollDepth() {
  const firedRef = useRef(new Set<number>());

  useEffect(() => {
    const thresholds = [25, 50, 75, 100];

    const handler = () => {
      const scrollTop = window.scrollY;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      const percent = Math.round((scrollTop / docHeight) * 100);

      for (const t of thresholds) {
        if (percent >= t && !firedRef.current.has(t)) {
          firedRef.current.add(t);
          fireFbq("trackCustom", "ScrollDepth", {
            depth: t,
            page: "LightLanding",
          });
          fireGtag("scroll_depth", {
            percent_scrolled: t,
            page: "light",
          });
        }
      }
    };

    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);
}

// ── Mount-once component ────────────────────────────────────────────────────

export function LightTrackingEvents() {
  // ViewContent on mount
  useEffect(() => {
    fireFbq("track", "ViewContent", {
      content_name: "LightLanding",
      content_category: "marketing",
    });
    fireGtag("view_landing", { page: "light" });
  }, []);

  // Scroll depth
  useScrollDepth();

  return null;
}
