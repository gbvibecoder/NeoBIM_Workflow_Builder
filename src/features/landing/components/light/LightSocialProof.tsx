"use client";

import { useLocale } from "@/hooks/useLocale";
import { ScrollReveal } from "./ScrollReveal";
import type { TranslationKey } from "@/lib/i18n";

const STATS: { numberKey: TranslationKey; labelKey: TranslationKey }[] = [
  {
    numberKey: "light.proof.stat1Number",
    labelKey: "light.proof.stat1Label",
  },
  {
    numberKey: "light.proof.stat2Number",
    labelKey: "light.proof.stat2Label",
  },
  {
    numberKey: "light.proof.stat3Number",
    labelKey: "light.proof.stat3Label",
  },
];

export function LightSocialProof() {
  const { t } = useLocale();

  return (
    <section
      aria-label="Social proof"
      style={{
        padding: "var(--light-section-pad) 24px",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      {/* Visually-hidden h2 for heading hierarchy (section has no visible heading) */}
      <h2 className="light-sr-only">{t("light.proof.label")}</h2>

      {/* Mono label — matches "HOW IT WORKS" / "AUTOMATE BIM WORKFLOWS" */}
      <ScrollReveal style={{ textAlign: "center" }}>
        <p
          aria-hidden="true"
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--light-soft)",
            fontFamily: "var(--font-jetbrains), monospace",
            margin: "0 0 32px",
          }}
        >
          {t("light.proof.label")}
        </p>
      </ScrollReveal>

      {/* Stat row — pure typography, no cards/borders/pills */}
      <ScrollReveal
        stagger
        className="light-proof-row"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "baseline",
          gap: 0,
        }}
      >
        {STATS.map((stat, i) => (
          <div
            key={stat.numberKey}
            className="light-proof-stat"
            style={{
              flex: "1 1 0",
              textAlign: "center",
              padding: "0 24px",
              borderRight:
                i < STATS.length - 1
                  ? "1px solid var(--light-border)"
                  : "none",
            }}
          >
            {/* Big number — Instrument Serif italic, editorial voice */}
            <p
              style={{
                fontSize: "clamp(1.6rem, 2.6vw, 2.1rem)",
                fontWeight: 400,
                fontStyle: "italic",
                color: "var(--light-ink)",
                fontFamily: "var(--font-instrument), serif",
                letterSpacing: "-0.02em",
                lineHeight: 1.15,
                margin: "0 0 8px",
                whiteSpace: "nowrap",
              }}
            >
              {t(stat.numberKey)}
            </p>
            {/* Subtitle — DM Sans, tertiary */}
            <p
              style={{
                fontSize: 13,
                fontWeight: 400,
                color: "var(--light-soft)",
                fontFamily: "var(--font-dm-sans), sans-serif",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {t(stat.labelKey)}
            </p>
          </div>
        ))}
      </ScrollReveal>

      <style>{`
        @media (max-width: 640px) {
          .light-proof-row {
            flex-direction: column !important;
            gap: 32px !important;
          }
          .light-proof-stat {
            border-right: none !important;
            padding: 0 !important;
          }
          .light-proof-stat p:first-child {
            font-size: clamp(1.4rem, 5vw, 1.8rem) !important;
          }
        }
      `}</style>
    </section>
  );
}
