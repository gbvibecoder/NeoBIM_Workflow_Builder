"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, MessageSquare, FileText, X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

const BETA_BANNER_VERSION = "v1";
const STORAGE_KEY = `betaBanner.dismissed.${BETA_BANNER_VERSION}`;

export function BetaBanner() {
  const { t } = useLocale();
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  if (!mounted || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px clamp(12px, 3vw, 20px)",
        background:
          "linear-gradient(90deg, rgba(0,245,255,0.08) 0%, rgba(108,92,231,0.06) 100%)",
        borderBottom: "1px solid rgba(0,245,255,0.18)",
        color: "var(--text-primary)",
        fontSize: 12.5,
        lineHeight: 1.4,
        flexShrink: 0,
      }}
    >
      <Sparkles
        size={14}
        style={{ color: "var(--interactive)", flexShrink: 0 }}
        aria-hidden="true"
      />

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
        <strong style={{ fontWeight: 600, color: "var(--text-primary)" }}>
          {t("banner.betaTitle")}
        </strong>
        <span style={{ color: "var(--text-secondary)" }}>
          {t("banner.betaMessage")}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <Link
          href="/dashboard/feedback"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(0,245,255,0.1)",
            border: "1px solid rgba(0,245,255,0.25)",
            color: "var(--interactive)",
            fontWeight: 600,
            fontSize: 11.5,
            textDecoration: "none",
            whiteSpace: "nowrap",
            transition: "background 120ms ease, border-color 120ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0,245,255,0.18)";
            e.currentTarget.style.borderColor = "rgba(0,245,255,0.4)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(0,245,255,0.1)";
            e.currentTarget.style.borderColor = "rgba(0,245,255,0.25)";
          }}
        >
          <MessageSquare size={11} aria-hidden="true" />
          {t("banner.betaFeedback")}
        </Link>

        <Link
          href="/blog"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 6,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "var(--text-secondary)",
            fontWeight: 600,
            fontSize: 11.5,
            textDecoration: "none",
            whiteSpace: "nowrap",
            transition: "border-color 120ms ease, color 120ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)";
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
        >
          <FileText size={11} aria-hidden="true" />
          {t("banner.betaChangelog")}
        </Link>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("banner.betaDismiss")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "transparent",
            border: "1px solid transparent",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            transition: "background 120ms ease, color 120ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-tertiary)";
          }}
          onFocus={(e) => {
            e.currentTarget.style.outline = "2px solid var(--border-focus)";
            e.currentTarget.style.outlineOffset = "2px";
          }}
          onBlur={(e) => {
            e.currentTarget.style.outline = "none";
          }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
