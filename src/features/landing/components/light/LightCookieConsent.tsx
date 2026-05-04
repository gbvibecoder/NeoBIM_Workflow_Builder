"use client";

import { useState, useEffect } from "react";
import { getTrackingConsent, setTrackingConsent } from "@/lib/cookie-consent";
import { useLocale } from "@/hooks";

/**
 * Light-themed cookie consent banner for /light.
 *
 * Suppression approach: On mount, this component finds the dark
 * CookieConsent banner from the root layout (identified by its unique
 * background color #16162A) and hides it via display:none. This avoids
 * modifying the shared CookieConsent.tsx or the root layout.
 *
 * Uses the exact same localStorage key and consent API as the dark
 * variant — cookie state is shared across themes.
 */
export function LightCookieConsent() {
  const { t } = useLocale();
  const [show, setShow] = useState(false);

  // Suppress the dark cookie banner from root layout
  useEffect(() => {
    const hideDarkBanner = () => {
      const fixed = document.querySelectorAll<HTMLElement>(
        'div[style*="position: fixed"]',
      );
      for (const el of fixed) {
        if (
          el.style.background === "rgb(22, 22, 42)" ||
          el.style.background === "#16162A"
        ) {
          el.style.display = "none";
        }
      }
    };

    // Run immediately and watch for late-mounting (dark banner has 1.5s delay)
    hideDarkBanner();
    const timer = setTimeout(hideDarkBanner, 1600);
    const observer = new MutationObserver(hideDarkBanner);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // Show/hide logic — mirrors dark CookieConsent exactly
  useEffect(() => {
    const stored = getTrackingConsent();
    if (stored === null) {
      const timer = setTimeout(() => setShow(true), 1500);
      return () => clearTimeout(timer);
    }
    setTrackingConsent(stored);
  }, []);

  if (!show) return null;

  const handleAccept = () => {
    setTrackingConsent("accepted");
    setShow(false);
  };

  const handleReject = () => {
    setTrackingConsent("rejected");
    setShow(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: 24,
        right: 24,
        maxWidth: 480,
        zIndex: 9999,
        background: "#FFFFFF",
        border: "1px solid rgba(0, 0, 0, 0.10)",
        borderRadius: 16,
        padding: "16px 20px",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.08)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        fontFamily: "var(--font-dm-sans), sans-serif",
        animation: "lightSlideUp 0.3s ease-out",
      }}
    >
      <p
        style={{
          flex: 1,
          color: "#1A1A14",
          fontSize: 13,
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {t("cookie.message")}{" "}
        <a
          href="/privacy"
          style={{ color: "var(--light-accent)", textDecoration: "underline" }}
        >
          {t("cookie.privacyPolicy")}
        </a>
      </p>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          onClick={handleReject}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            background: "transparent",
            border: "1px solid rgba(0, 0, 0, 0.15)",
            color: "#1A1A14",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("cookie.reject")}
        </button>
        <button
          onClick={handleAccept}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            background: "#2F4F2A",
            border: "none",
            color: "white",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("cookie.accept")}
        </button>
      </div>
      <style>{`
        @keyframes lightSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
