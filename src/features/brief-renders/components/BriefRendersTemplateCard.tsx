/**
 * BriefRendersTemplateCard — promo card for the templates page.
 *
 * Renders only when the canary feature flag is on
 * (`useFeatureFlags().briefRendersEnabled`). Non-eligible users see
 * nothing — there's no flash of "Beta" UI followed by a hidden link.
 *
 * Designed to slot into the templates page below the hero stats bar
 * without disturbing the existing layout. Plain CSS + inline styles so
 * the styling matches the templates page's hand-rolled vocabulary
 * rather than introducing a Tailwind island in the middle of it.
 */

"use client";

import Link from "next/link";

import { useFeatureFlags } from "@/hooks/useFeatureFlags";

export function BriefRendersTemplateCard() {
  const { briefRendersEnabled } = useFeatureFlags();
  if (!briefRendersEnabled) return null;

  return (
    <div
      style={{
        margin: "32px 48px 0",
        padding: 20,
        borderRadius: 16,
        background:
          "linear-gradient(135deg, rgba(184,115,51,0.08) 0%, rgba(6,182,212,0.06) 100%)",
        border: "1px solid rgba(184,115,51,0.18)",
        display: "flex",
        alignItems: "center",
        gap: 24,
        flexWrap: "wrap",
      }}
      data-testid="brief-renders-template-card"
    >
      <div style={{ flex: "1 1 320px", minWidth: 260 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "rgba(184,115,51,0.9)",
              fontFamily: "var(--font-jetbrains), monospace",
            }}
          >
            New · Beta
          </span>
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#F0F2F8",
            marginBottom: 4,
          }}
        >
          Brief → Renders
        </div>
        <div
          style={{
            fontSize: 13,
            color: "rgba(160,170,200,0.7)",
            lineHeight: 1.55,
            maxWidth: 460,
          }}
        >
          Upload an architectural brief (PDF or DOCX). We extract the spec
          for your review, then render twelve photoreal interior shots and
          an editorial PDF — no canvas dragging required.
        </div>
      </div>

      <Link
        href="/dashboard/brief-renders"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 18px",
          borderRadius: 10,
          background: "linear-gradient(135deg, #B87333 0%, #8B5A24 100%)",
          color: "#fff",
          textDecoration: "none",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.2px",
          flexShrink: 0,
        }}
      >
        Try it now →
      </Link>
    </div>
  );
}
