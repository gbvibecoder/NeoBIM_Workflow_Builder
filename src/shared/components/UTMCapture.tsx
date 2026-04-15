"use client";

import { useEffect } from "react";
import { captureUTMParams } from "@/lib/utm";

/**
 * Single mount-point client component for:
 *   1. UTM param capture (once per visit)
 *   2. SPA page_view tracking on every in-app navigation
 *
 * Both pieces are folded into one file because Next 16 + React 19 has a
 * known root-layout client-reference serialization issue: any NEW
 * client-component import at that position throws
 * "Element type is invalid. Received a promise that resolves to: undefined".
 * UTMCapture was already mounted and working, so we extend it in place.
 *
 * Page view tracking uses native browser history events (no next/navigation
 * hooks) — same pattern as GTM's built-in History Change trigger.
 */
export function UTMCapture() {
  useEffect(() => {
    // ── 1. UTM param capture (original behaviour) ──────────────────
    captureUTMParams();

    // ── 2. Route-change page_view tracker ──────────────────────────
    if (typeof window === "undefined") return;

    const fire = () => {
      const path = window.location.pathname + window.location.search;
      const url = window.location.origin + path;
      window.gtag?.("event", "page_view", {
        page_path: path,
        page_location: url,
        page_title: document.title,
      });
      window.fbq?.("track", "PageView");
    };

    const w = window as unknown as { __routeAnalyticsPatched?: boolean };
    if (!w.__routeAnalyticsPatched) {
      w.__routeAnalyticsPatched = true;
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function (...args) {
        const res = origPush.apply(this, args);
        window.dispatchEvent(new Event("buildflow:navigation"));
        return res;
      };
      history.replaceState = function (...args) {
        const res = origReplace.apply(this, args);
        window.dispatchEvent(new Event("buildflow:navigation"));
        return res;
      };
    }

    window.addEventListener("popstate", fire);
    window.addEventListener("buildflow:navigation", fire);

    return () => {
      window.removeEventListener("popstate", fire);
      window.removeEventListener("buildflow:navigation", fire);
    };
  }, []);

  return null;
}
