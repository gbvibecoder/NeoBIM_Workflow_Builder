"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ScrollReveal } from "./ScrollReveal";
import { trackCTAClick } from "./LightTrackingEvents";
import type { TranslationKey } from "@/lib/i18n";

const CHECKS: TranslationKey[] = [
  "light.bottomCta.check1",
  "light.bottomCta.check2",
  "light.bottomCta.check3",
];

export function LightBottomCTA() {
  const { t } = useLocale();

  return (
    <section
      aria-label="Call to action"
      style={{
        position: "relative",
        overflow: "hidden",
        padding: "var(--light-section-pad) 24px",
        background: "var(--light-bg)",
      }}
    >
      {/* Dot grid with radial fade mask — mirrors hero exactly */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          backgroundImage:
            "radial-gradient(circle, rgba(26, 31, 46, 0.18) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          backgroundPosition: "0 0",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 65% at 50% 50%, black 30%, transparent 80%)",
          maskImage:
            "radial-gradient(ellipse 70% 65% at 50% 50%, black 30%, transparent 80%)",
        }}
      />

      <ScrollReveal
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 720,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        {/* Mono label — same treatment as hero eyebrow */}
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--light-soft)",
            fontFamily: "var(--font-jetbrains), monospace",
            margin: "0 0 16px",
          }}
        >
          {t("light.bottomCta.label")}
        </p>

        {/* H2 — Instrument Serif with italic emphasis on "Today." */}
        <h2
          style={{
            fontSize: "clamp(1.8rem, 3.5vw, 2.5rem)",
            fontWeight: 400,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--light-ink)",
            fontFamily: "var(--font-instrument), serif",
            margin: "0 0 12px",
          }}
        >
          From brief to building.{" "}
          <em style={{ fontStyle: "italic" }}>Today.</em>
        </h2>

        {/* Subhead — matches hero subhead styling */}
        <p
          style={{
            fontSize: 18,
            fontWeight: 400,
            lineHeight: 1.6,
            color: "var(--light-soft)",
            fontFamily: "var(--font-dm-sans), sans-serif",
            margin: "0 0 40px",
          }}
        >
          {t("light.bottomCta.subhead")}
        </p>

        {/* CTA pair — identical to hero CTAs */}
        <div
          className="light-bottom-ctas"
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/register"
            onClick={() => trackCTAClick("Get Started Free", "bottom")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: 48,
              padding: "0 24px",
              borderRadius: 8,
              background: "var(--light-accent)",
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              textDecoration: "none",
              fontFamily: "var(--font-dm-sans), sans-serif",
              border: "none",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#3A5640";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "var(--light-accent)";
            }}
          >
            {t("light.heroPrimaryCTA")}
          </Link>
          <Link
            href="/book-demo"
            onClick={() => trackCTAClick("Book a Demo", "bottom_secondary")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: 48,
              padding: "0 24px",
              borderRadius: 8,
              background: "transparent",
              color: "var(--light-accent)",
              fontSize: 16,
              fontWeight: 600,
              textDecoration: "none",
              fontFamily: "var(--font-dm-sans), sans-serif",
              border: "1px solid var(--light-accent)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "rgba(74, 107, 77, 0.06)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            {t("light.heroSecondaryCTA")}
          </Link>
        </div>

        {/* Checkmarks — same style as hero trust strip */}
        <div
          style={{
            marginTop: 24,
            display: "flex",
            gap: 16,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {CHECKS.map((key) => (
            <span
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 13,
                fontWeight: 400,
                color: "var(--light-soft)",
                fontFamily: "var(--font-dm-sans), sans-serif",
              }}
            >
              <Check
                size={14}
                style={{ color: "var(--light-accent)", flexShrink: 0 }}
              />
              {t(key)}
            </span>
          ))}
        </div>
      </ScrollReveal>

      <style>{`
        @media (max-width: 480px) {
          section[aria-label="Call to action"] {
            padding: var(--light-section-pad) 16px !important;
          }
          .light-bottom-ctas {
            flex-direction: column !important;
            gap: 8px !important;
          }
          .light-bottom-ctas a {
            width: 100% !important;
          }
        }
      `}</style>
    </section>
  );
}
