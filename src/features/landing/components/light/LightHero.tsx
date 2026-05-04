"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { LightHeroPipeline } from "./LightHeroPipeline";
import { trackCTAClick } from "./LightTrackingEvents";
import type { TranslationKey } from "@/lib/i18n";

const TRUST_KEYS: TranslationKey[] = [
  "light.heroTrust1",
  "light.heroTrust2",
  "light.heroTrust3",
];

export function LightHero() {
  const { t } = useLocale();

  return (
    <section
      aria-label="Hero"
      style={{
        position: "relative",
        overflow: "hidden",
        minHeight: "72vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
      }}
    >
      {/* Dot grid with radial fade mask — full viewport width */}
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

      {/* Content — constrained width, above decorative layers */}
      <div
        className="light-reveal"
        style={{
          position: "relative",
          zIndex: 1,
          textAlign: "center",
          maxWidth: 1200,
          width: "100%",
          padding: "clamp(48px, 8vh, 96px) 24px var(--light-section-pad)",
          margin: "0 auto",
        }}
      >
        {/* Mono label */}
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--light-soft)",
            fontFamily: "var(--font-jetbrains), monospace",
            margin: 0,
          }}
        >
          {t("light.heroEyebrow")}
        </p>

        {/* h1 — editorial headline with italic emphasis */}
        <h1
          style={{
            fontSize: "clamp(2.5rem, 5vw, 4rem)",
            fontWeight: 400,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: "var(--light-ink)",
            fontFamily: "var(--font-instrument), serif",
            margin: "8px auto 0",
            maxWidth: 900,
          }}
        >
          {t("light.heroHeadline1")}
          <br />
          {t("light.heroHeadline2")}{" "}
          <em style={{ fontStyle: "italic" }}>{t("light.heroHeadlineEm")}</em>
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: 18,
            fontWeight: 400,
            lineHeight: 1.6,
            color: "var(--light-soft)",
            fontFamily: "var(--font-dm-sans), sans-serif",
            maxWidth: 640,
            margin: "24px auto 0",
          }}
        >
          {t("light.heroSubhead")}
        </p>

        {/* CTA pair */}
        <div
          className="light-hero-ctas"
          style={{
            marginTop: 40,
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {/* Primary CTA */}
          <Link
            href="/register"
            onClick={() => trackCTAClick("Get Started Free", "hero_primary")}
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
        </div>

        {/* Trust signals */}
        <div
          className="light-hero-trust"
          style={{
            marginTop: 24,
            display: "flex",
            gap: 16,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {TRUST_KEYS.map((key) => (
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
      </div>

      {/* Animated pipeline visual — hidden on mobile */}
      <LightHeroPipeline />

      <style>{`
        @media (max-width: 768px) {
          section[aria-label="Hero"] {
            min-height: auto !important;
          }
          section[aria-label="Hero"] .light-reveal {
            padding-top: 32px !important;
          }
          section[aria-label="Hero"] h1 {
            font-size: clamp(2rem, 7vw, 2.5rem) !important;
          }
        }
        @media (max-width: 480px) {
          section[aria-label="Hero"] .light-reveal {
            padding: 32px 16px 48px !important;
          }
          .light-hero-ctas {
            flex-direction: column !important;
            gap: 8px !important;
          }
          .light-hero-ctas a {
            width: 100% !important;
          }
        }
      `}</style>
    </section>
  );
}
