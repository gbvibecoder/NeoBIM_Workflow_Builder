"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

export function LightHero() {
  const { t } = useLocale();

  return (
    <section
      aria-label="Hero"
      style={{
        minHeight: "72vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "160px 24px 64px",
        maxWidth: 1200,
        margin: "0 auto",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle radial glow — warm cream, editorial depth */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background:
            "radial-gradient(ellipse 80% 60% at 50% 45%, rgba(255, 248, 235, 0.55) 0%, rgba(255, 248, 235, 0.25) 30%, rgba(250, 250, 247, 0) 70%)",
        }}
      />
      <div className="light-reveal" style={{ position: "relative", zIndex: 1 }}>
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
          {t("light.heroLabel")}
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
          {t("light.heroLine1")}{" "}
          <em style={{ fontStyle: "italic" }}>{t("light.heroLine1Em")}</em>{" "}
          {t("light.heroLine2")}
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: 18,
            fontWeight: 400,
            lineHeight: 1.6,
            color: "var(--light-soft)",
            fontFamily: "var(--font-dm-sans), sans-serif",
            maxWidth: 520,
            margin: "24px auto 0",
          }}
        >
          {t("light.heroSubtitle")}
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
            {t("landing.getStartedFree")}
          </Link>

          {/* Ghost CTA */}
          <Link
            href="/demo"
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
            {t("light.tryDemo")}
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
          {[
            t("light.trustFreeTier"),
            t("landing.trustNoCreditCard"),
            t("landing.trustCancelAnytime"),
          ].map((signal) => (
            <span
              key={signal}
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
              {signal}
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          section[aria-label="Hero"] {
            padding-top: 120px !important;
          }
        }
        @media (max-width: 768px) {
          section[aria-label="Hero"] {
            padding-top: 100px !important;
            min-height: auto !important;
          }
          section[aria-label="Hero"] h1 {
            font-size: clamp(2rem, 7vw, 2.5rem) !important;
          }
          section[aria-label="Hero"] p:nth-of-type(2) {
            font-size: 16px !important;
          }
        }
        @media (max-width: 480px) {
          section[aria-label="Hero"] {
            padding: 100px 16px 48px !important;
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
