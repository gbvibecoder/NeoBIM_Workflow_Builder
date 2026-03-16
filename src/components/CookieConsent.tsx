"use client";

import { useState, useEffect } from "react";
import { getTrackingConsent, setTrackingConsent } from "@/lib/cookie-consent";

export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (getTrackingConsent() === null) {
      // Small delay so banner doesn't flash on page load
      const timer = setTimeout(() => setShow(true), 1500);
      return () => clearTimeout(timer);
    }
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
        background: "#16162A",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: "16px 20px",
        boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        fontFamily: "var(--font-dm-sans), sans-serif",
        animation: "slideUp 0.3s ease-out",
      }}
    >
      <p style={{ flex: 1, color: "#C0C0D0", fontSize: 13, lineHeight: 1.5, margin: 0 }}>
        We use cookies for analytics and to improve your experience.{" "}
        <a href="/privacy" style={{ color: "#4F8AFF", textDecoration: "underline" }}>
          Privacy Policy
        </a>
      </p>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          onClick={handleReject}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#7C7C96",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reject
        </button>
        <button
          onClick={handleAccept}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            background: "#4F8AFF",
            border: "none",
            color: "white",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Accept
        </button>
      </div>
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
